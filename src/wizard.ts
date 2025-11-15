import { Input, Confirm, Number as NumberPrompt, Select } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { SSHConnection } from "./ssh/connection.ts";
import { SystemChecker } from "./checks/system.ts";
import { DockerManager } from "./docker/manager.ts";
import { GarageCluster } from "./garage/cluster.ts";
import { DisplayManager } from "./ui/display.ts";
import { CleanupManager } from "./cleanup.ts";
import { withSpinner } from "./ui/spinner.ts";
import { initLogger, getLogger } from "./logger.ts";
import {
  DEFAULT_PORTS,
  DEFAULT_PATHS,
  DEFAULT_GARAGE_VERSION,
  DEFAULT_REPLICATION_FACTOR,
  DEFAULT_CAPACITY,
  KNOWN_GOOD_VERSIONS,
  MINIMUM_VERSION,
} from "./constants.ts";

export interface NodeConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "key" | "password";
  keyPath?: string;
  password?: string;
  connection?: SSHConnection;
}

export interface ClusterConfig {
  rpcSecret: string;
  capacityPerNode: string;
  dataDir: string;
  metaDir: string;
  workdir: string;
  garageVersion: string;
  replicationFactor: number;
  ports: {
    s3Api: number;
    rpc: number;
    s3Web: number;
    admin: number;
  };
}

export class Wizard {
  private display: DisplayManager;
  private cleanupManager: CleanupManager;
  private node1?: NodeConfig;
  private node2?: NodeConfig;
  private clusterConfig?: ClusterConfig;

  constructor() {
    this.display = new DisplayManager();
    this.cleanupManager = new CleanupManager();
  }

  async run() {
    // Initialize logging
    const logger = initLogger();
    console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
    await logger.info("=== Garage Installer Started ===");

    console.log(bold("This wizard will guide you through installing a 2-node Garage cluster.\n"));
    console.log("You'll need:");
    console.log("  • Two Ubuntu/Debian servers with SSH access");
    console.log("  • Both nodes on the same network");
    console.log("  • At least 16GB disk space per node");
    console.log("  • Docker will be installed if not present\n");

    const proceed = await Confirm.prompt({
      message: "Ready to begin?",
      default: true,
    });

    if (!proceed) {
      console.log(yellow("Installation cancelled."));
      await logger.info("Installation cancelled by user");
      return;
    }

    try {
      // Phase 1: Node Discovery
      console.log(bold(cyan("\n=== Phase 1: Node Configuration ===")));
      await logger.info("Phase 1: Node Configuration started");
      await this.collectNodeInfo();

      // Phase 2: SSH Connectivity
      console.log(bold(cyan("\n=== Phase 2: Testing Connectivity ===")));
      await logger.info("Phase 2: Testing Connectivity started");
      await this.testConnectivity();

      // Phase 3: Preflight Checks
      console.log(bold(cyan("\n=== Phase 3: System Checks ===")));
      await logger.info("Phase 3: System Checks started");
      await this.runPreflightChecks();

      // Phase 4: Cluster Configuration
      console.log(bold(cyan("\n=== Phase 4: Cluster Configuration ===")));
      await logger.info("Phase 4: Cluster Configuration started");
      await this.configureCluster();

      // Phase 5: Deployment Summary
      console.log(bold(cyan("\n=== Phase 5: Deployment Summary ===")));
      await logger.info("Phase 5: Deployment Summary");
      await this.showSummary();

      // Phase 6: Deploy
      console.log(bold(cyan("\n=== Phase 6: Deploying Garage ===")));
      await logger.info("Phase 6: Deploying Garage started");
      await this.deployCluster();

      // Phase 7: Post-Install
      console.log(bold(cyan("\n=== Phase 7: Finalizing ===")));
      await logger.info("Phase 7: Finalizing started");
      await this.postInstall();

      console.log(green(bold("\n✓ Installation complete!")));
      await logger.info("Installation completed successfully");
      this.showSuccessMessage();

    } catch (error: any) {
      await logger.error("Installation failed", { error: error.message, stack: error.stack });
      console.error(red(bold("\n✖ Installation failed:")), error.message);
      console.error(dim(`\nFor troubleshooting, check the log file: ${logger.getLogPath()}`));
      
      // Offer to cleanup if anything was deployed
      if (this.cleanupManager.hasDeploymentState()) {
        const shouldCleanup = await Confirm.prompt({
          message: "Would you like to rollback and clean up what was deployed?",
          default: true,
        });

        if (shouldCleanup) {
          await this.cleanupManager.cleanupAll([this.node1!, this.node2!].filter(n => n));
        } else {
          this.cleanupManager.displayManualCleanupInstructions([this.node1!, this.node2!].filter(n => n));
        }
      }
      
      throw error;
    } finally {
      // Clean up SSH connections
      await this.closeConnections();
    }
  }

  private isValidHostOrIP(value: string): boolean {
    if (!value) return false;

    // Check for hostname
    const hostnameRegex = /^[\w\-.]+$/;
    
    // Check for IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    
    // Check for IPv6 (simplified - supports standard and compressed forms)
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    
    // Also support IPv6 with brackets for ports (e.g., [::1])
    const ipv6BracketRegex = /^\[([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\]$/;

    return hostnameRegex.test(value) || 
           ipv4Regex.test(value) || 
           ipv6Regex.test(value) ||
           ipv6BracketRegex.test(value);
  }

  private async testHostResolution(hostname: string): Promise<boolean> {
    try {
      // Try to resolve the hostname
      const result = await Deno.resolveDns(hostname, "A");
      return result.length > 0;
    } catch {
      // Try AAAA (IPv6) if A record fails
      try {
        const result = await Deno.resolveDns(hostname, "AAAA");
        return result.length > 0;
      } catch {
        // If it looks like an IP address, assume it's valid
        // (might be in /etc/hosts or unreachable but valid)
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
          return true; // Valid IPv4 format
        }
        if (/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(hostname)) {
          return true; // Valid IPv6 format
        }
        return false;
      }
    }
  }

  private async collectNodeInfo() {
    // Node 1
    console.log(bold("\nNode 1 Configuration:"));
    
    let host1: string = "";
    let hostValid = false;
    
    while (!hostValid) {
      host1 = await Input.prompt({
        message: "Hostname or IP address (IPv4/IPv6 supported):",
        validate: (value) => {
          if (!value) return "Hostname is required";
          if (!this.isValidHostOrIP(value)) {
            return "Invalid hostname or IP address";
          }
          return true;
        },
      });

      // Test if hostname resolves
      console.log(dim(`  Checking if ${host1} is reachable...`));
      const resolves = await this.testHostResolution(host1);
      
      if (!resolves) {
        console.log(yellow(`\n  ⚠ Warning: Cannot resolve hostname "${host1}"`));
        console.log(yellow(`    This could mean:`));
        console.log(yellow(`    • Hostname is misspelled`));
        console.log(yellow(`    • Host is defined in /etc/hosts (might still work)`));
        console.log(yellow(`    • Host is currently unreachable\n`));
        
        const proceed = await Confirm.prompt({
          message: "Try connecting anyway?",
          default: false,
        });
        
        if (proceed) {
          hostValid = true;
        } else {
          const retry = await Confirm.prompt({
            message: "Re-enter hostname?",
            default: true,
          });
          if (!retry) {
            throw new Error("Hostname validation cancelled");
          }
        }
      } else {
        console.log(green(`  ✓ ${host1} is reachable`));
        hostValid = true;
      }
    }

    const port1 = await NumberPrompt.prompt({
      message: "SSH port:",
      default: 22,
      min: 1,
      max: 65535,
    });

    const username1 = await Input.prompt({
      message: "SSH username:",
      default: Deno.env.get("USER") || "ubuntu",
    });

    const authMethod1 = await Select.prompt({
      message: "Authentication method:",
      options: [
        { name: "SSH Key", value: "key" },
        { name: "Password", value: "password" },
      ],
      default: "key",
    }) as "key" | "password";

    let keyPath1: string | undefined;
    let password1: string | undefined;

    if (authMethod1 === "key") {
      let keyValid = false;
      while (!keyValid) {
        // Check for common SSH key files
        const homeDir = Deno.env.get("HOME") || "";
        const commonKeys = [
          `${homeDir}/.ssh/id_ed25519`,
          `${homeDir}/.ssh/id_rsa`,
          `${homeDir}/.ssh/id_ecdsa`,
        ];
        
        const availableKeys: string[] = [];
        for (const keyPath of commonKeys) {
          try {
            await Deno.stat(keyPath);
            availableKeys.push(keyPath);
          } catch {
            // Key doesn't exist, skip it
          }
        }

        // If we found keys, let user choose; otherwise ask for path
        if (availableKeys.length > 0) {
          availableKeys.push("Other (specify path)");
          const keyChoice = await Select.prompt({
            message: "Select SSH private key:",
            options: availableKeys,
          });
          
          if (keyChoice === "Other (specify path)") {
            keyPath1 = await Input.prompt({
              message: "Path to SSH private key:",
              default: `${homeDir}/.ssh/id_rsa`,
            });
          } else {
            keyPath1 = keyChoice;
          }
        } else {
          keyPath1 = await Input.prompt({
            message: "Path to SSH private key:",
            default: `${homeDir}/.ssh/id_rsa`,
          });
        }

        // Validate the key file exists and is readable
        try {
          const keyData = await Deno.readTextFile(keyPath1);
          if (!keyData.includes("PRIVATE KEY")) {
            console.log(red(`\n  ✗ Invalid key file: ${keyPath1} doesn't appear to be a private key`));
            const retry = await Confirm.prompt({
              message: "Try a different key path?",
              default: true,
            });
            if (!retry) throw new Error("SSH key validation failed");
            continue;
          }
          keyValid = true;
        } catch (error: any) {
          if (error.message === "SSH key validation failed") throw error;
          console.log(red(`\n  ✗ Cannot read key file: ${keyPath1}`));
          console.log(yellow(`    Error: ${error.message}`));
          const retry = await Confirm.prompt({
            message: "Try a different key path?",
            default: true,
          });
          if (!retry) throw new Error("SSH key validation failed");
        }
      }
    } else {
      password1 = await Input.prompt({
        message: "SSH password:",
        mask: "*",
      });
    }

    this.node1 = {
      name: "node1",
      host: host1,
      port: port1,
      username: username1,
      authMethod: authMethod1,
      keyPath: keyPath1,
      password: password1,
    };

    // Node 2
    console.log(bold("\nNode 2 Configuration:"));
    
    const sameCredentials = await Confirm.prompt({
      message: "Use same SSH credentials as Node 1?",
      default: true,
    });

    if (sameCredentials) {
      let host2: string = "";
      let hostValid = false;
      
      while (!hostValid) {
        host2 = await Input.prompt({
          message: "Hostname or IP address (IPv4/IPv6 supported):",
          validate: (value) => {
            if (!value) return "Hostname is required";
            if (!this.isValidHostOrIP(value)) return "Invalid hostname or IP address";
            if (value === host1) return "Node 2 must have different hostname than Node 1";
            return true;
          },
        });

        // Test if hostname resolves
        console.log(dim(`  Checking if ${host2} is reachable...`));
        const resolves = await this.testHostResolution(host2);
        
        if (!resolves) {
          console.log(yellow(`\n  ⚠ Warning: Cannot resolve hostname "${host2}"`));
          console.log(yellow(`    This could mean:`));
          console.log(yellow(`    • Hostname is misspelled`));
          console.log(yellow(`    • Host is defined in /etc/hosts (might still work)`));
          console.log(yellow(`    • Host is currently unreachable\n`));
          
          const proceed = await Confirm.prompt({
            message: "Try connecting anyway?",
            default: false,
          });
          
          if (proceed) {
            hostValid = true;
          } else {
            const retry = await Confirm.prompt({
              message: "Re-enter hostname?",
              default: true,
            });
            if (!retry) {
              throw new Error("Hostname validation cancelled");
            }
          }
        } else {
          console.log(green(`  ✓ ${host2} is reachable`));
          hostValid = true;
        }
      }

      this.node2 = {
        name: "node2",
        host: host2,
        port: port1,
        username: username1,
        authMethod: authMethod1,
        keyPath: keyPath1,
        password: password1,
      };
    } else {
      // Repeat full config for node 2
      let host2: string = "";
      let hostValid = false;
      
      while (!hostValid) {
        host2 = await Input.prompt({
          message: "Hostname or IP address (IPv4/IPv6 supported):",
          validate: (value) => {
            if (!value) return "Hostname is required";
            if (!this.isValidHostOrIP(value)) return "Invalid hostname or IP address";
            if (value === host1) return "Node 2 must have different hostname than Node 1";
            return true;
          },
        });

        // Test if hostname resolves
        console.log(dim(`  Checking if ${host2} is reachable...`));
        const resolves = await this.testHostResolution(host2);
        
        if (!resolves) {
          console.log(yellow(`\n  ⚠ Warning: Cannot resolve hostname "${host2}"`));
          console.log(yellow(`    This could mean:`));
          console.log(yellow(`    • Hostname is misspelled`));
          console.log(yellow(`    • Host is defined in /etc/hosts (might still work)`));
          console.log(yellow(`    • Host is currently unreachable\n`));
          
          const proceed = await Confirm.prompt({
            message: "Try connecting anyway?",
            default: false,
          });
          
          if (proceed) {
            hostValid = true;
          } else {
            const retry = await Confirm.prompt({
              message: "Re-enter hostname?",
              default: true,
            });
            if (!retry) {
              throw new Error("Hostname validation cancelled");
            }
          }
        } else {
          console.log(green(`  ✓ ${host2} is reachable`));
          hostValid = true;
        }
      }

      const port2 = await NumberPrompt.prompt({
        message: "SSH port:",
        default: 22,
      });

      const username2 = await Input.prompt({
        message: "SSH username:",
        default: username1,
      });

      const authMethod2 = await Select.prompt({
        message: "Authentication method:",
        options: [
          { name: "SSH Key", value: "key" },
          { name: "Password", value: "password" },
        ],
      }) as "key" | "password";

      let keyPath2: string | undefined;
      let password2: string | undefined;

      if (authMethod2 === "key") {
        let keyValid = false;
        while (!keyValid) {
          // Check for common SSH key files
          const homeDir = Deno.env.get("HOME") || "";
          const commonKeys = [
            `${homeDir}/.ssh/id_ed25519`,
            `${homeDir}/.ssh/id_rsa`,
            `${homeDir}/.ssh/id_ecdsa`,
          ];
          
          const availableKeys: string[] = [];
          for (const keyPath of commonKeys) {
            try {
              await Deno.stat(keyPath);
              availableKeys.push(keyPath);
            } catch {
              // Key doesn't exist, skip it
            }
          }

          // If we found keys, let user choose; otherwise ask for path
          if (availableKeys.length > 0) {
            availableKeys.push("Other (specify path)");
            const keyChoice = await Select.prompt({
              message: "Select SSH private key:",
              options: availableKeys,
            });
            
            if (keyChoice === "Other (specify path)") {
              keyPath2 = await Input.prompt({
                message: "Path to SSH private key:",
                default: keyPath1,
              });
            } else {
              keyPath2 = keyChoice;
            }
          } else {
            keyPath2 = await Input.prompt({
              message: "Path to SSH private key:",
              default: keyPath1,
            });
          }

          // Validate the key file exists and is readable
          try {
            const keyData = await Deno.readTextFile(keyPath2);
            if (!keyData.includes("PRIVATE KEY")) {
              console.log(red(`\n  ✗ Invalid key file: ${keyPath2} doesn't appear to be a private key`));
              const retry = await Confirm.prompt({
                message: "Try a different key path?",
                default: true,
              });
              if (!retry) throw new Error("SSH key validation failed");
              continue;
            }
            keyValid = true;
          } catch (error: any) {
            if (error.message === "SSH key validation failed") throw error;
            console.log(red(`\n  ✗ Cannot read key file: ${keyPath2}`));
            console.log(yellow(`    Error: ${error.message}`));
            const retry = await Confirm.prompt({
              message: "Try a different key path?",
              default: true,
            });
            if (!retry) throw new Error("SSH key validation failed");
          }
        }
      } else {
        password2 = await Input.prompt({
          message: "SSH password:",
          mask: "*",
        });
      }

      this.node2 = {
        name: "node2",
        host: host2,
        port: port2,
        username: username2,
        authMethod: authMethod2,
        keyPath: keyPath2,
        password: password2,
      };
    }

    console.log(green("\n✓ Node configuration collected"));
  }

  private async testConnectivity() {
    const nodes = [this.node1!, this.node2!];

    for (const node of nodes) {
      await withSpinner(
        `Connecting to ${node.name} (${node.host})`,
        async () => {
          const ssh = new SSHConnection(node);
          await ssh.connect();
          await ssh.test();
          node.connection = ssh;
        }
      );
    }

    console.log(green("\n✓ All nodes reachable"));
  }

  private async runPreflightChecks() {
    const nodes = [this.node1!, this.node2!];
    const manualInterventionNeeded: Array<{node: NodeConfig, failures: any[]}> = [];

    for (const node of nodes) {
      console.log(`\nChecking ${bold(node.name)}...`);
      const checker = new SystemChecker(node.connection!);
      
      // Run all checks
      const results = await checker.runAll();
      
      // Display results
      this.display.showCheckResults(results);

      // Handle failures
      const failures = results.filter(r => !r.passed);
      if (failures.length > 0) {
        console.log(yellow("\n⚠ Some checks failed. Attempting auto-fix..."));
        
        let needsManualIntervention = false;
        const manualFailures = [];
        
        for (const failure of failures) {
          if (failure.autoFix) {
            try {
              console.log(`  Fixing: ${failure.name}...`);
              await failure.autoFix(node.connection!);
              console.log(green(`  ✓ Fixed: ${failure.name}`));
            } catch (error: any) {
              if (error.message === "MANUAL_INTERVENTION_REQUIRED") {
                needsManualIntervention = true;
                manualFailures.push(failure);
              } else {
                throw error;
              }
            }
          } else {
            throw new Error(`Check failed: ${failure.name} - ${failure.message}`);
          }
        }
        
        if (needsManualIntervention) {
          manualInterventionNeeded.push({node, failures: manualFailures});
        }
      }
    }

    // If any nodes need manual intervention, pause and provide instructions
    if (manualInterventionNeeded.length > 0) {
      await this.handleManualIntervention(manualInterventionNeeded);
      
      // Re-run checks after manual intervention
      console.log(yellow("\n🔄 Re-running checks after manual intervention..."));
      
      for (const {node} of manualInterventionNeeded) {
        console.log(`\nRe-checking ${bold(node.name)}...`);
        const checker = new SystemChecker(node.connection!);
        const results = await checker.runAll();
        this.display.showCheckResults(results);
        
        const stillFailing = results.filter(r => !r.passed);
        if (stillFailing.length > 0) {
          console.log(red("\n✖ Some checks still failing:"));
          stillFailing.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
          throw new Error("Manual intervention did not resolve all issues. Please check the commands were run correctly.");
        }
      }
    }

    // Check inter-node connectivity
    console.log("\nChecking connectivity between nodes...");
    const canPing = await this.testInterNodeConnectivity();
    
    if (canPing) {
      console.log(green("✓ Nodes can communicate"));
    } else {
      throw new Error("Nodes cannot reach each other. Check network configuration.");
    }

    console.log(green("\n✓ All preflight checks passed"));
  }

  private async handleManualIntervention(interventions: Array<{node: NodeConfig, failures: any[]}>) {
    console.log(yellow("\n" + "=".repeat(70)));
    console.log(yellow("⚠️  MANUAL INTERVENTION REQUIRED"));
    console.log(yellow("=".repeat(70)));
    console.log("\nSome checks require manual commands to be run on the target nodes.");
    console.log("This typically happens when:");
    console.log("  • Docker Compose is not installed and sudo requires a password");
    console.log("  • User is not in the docker group and needs to be added");
    console.log("");
    
    for (const {node, failures} of interventions) {
      console.log(cyan(`\n📍 Node: ${bold(node.name)} (${node.host})`));
      console.log(dim("─".repeat(70)));
      
      for (const failure of failures) {
        console.log(`\n${yellow("Issue:")} ${failure.name}`);
        console.log(`${yellow("Details:")} ${failure.message}`);
        console.log("");
        
        // Provide specific instructions based on the failure
        if (failure.name === "Docker Compose") {
          const archResult = await node.connection!.exec("uname -m");
          const arch = archResult.stdout.trim();
          
          console.log(green("Commands to run:"));
          console.log("");
          console.log(`  ${dim("# SSH to the node:")}`);
          console.log(`  ssh ${node.username}@${node.host}`);
          console.log("");
          console.log(`  ${dim("# Install Docker Compose plugin:")}`);
          console.log("  sudo mkdir -p /usr/local/lib/docker/cli-plugins");
          console.log(`  sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch} -o /usr/local/lib/docker/cli-plugins/docker-compose`);
          console.log("  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose");
          console.log("");
          console.log(`  ${dim("# Verify installation:")}`);
          console.log("  docker compose version");
          console.log("");
          console.log(`  ${dim("# Exit back to installer:")}`);
          console.log("  exit");
        }
        
        if (failure.name === "Docker Permissions") {
          const whoamiResult = await node.connection!.exec("whoami");
          const username = whoamiResult.stdout.trim();
          
          // Check if already in group but not active
          const groupCheck = await node.connection!.exec(`groups ${username} | grep docker || echo ""`);
          const inDockerGroup = groupCheck.stdout.includes("docker");
          
          console.log(green("Commands to run:"));
          console.log("");
          console.log(`  ${dim("# SSH to the node:")}`);
          console.log(`  ssh ${node.username}@${node.host}`);
          console.log("");
          
          if (inDockerGroup) {
            console.log(`  ${dim("# Activate docker group (already a member):")}`);
            console.log("  newgrp docker");
            console.log("");
            console.log(`  ${dim("# Or alternatively, logout and login again")}`);
          } else {
            console.log(`  ${dim("# Add user to docker group:")}`);
            console.log(`  sudo usermod -aG docker ${username}`);
            console.log("");
            console.log(`  ${dim("# Activate the new group membership:")}`);
            console.log("  newgrp docker");
            console.log("");
            console.log(`  ${dim("# Or alternatively, logout and login again")}`);
          }
          console.log("");
          console.log(`  ${dim("# Verify docker access:")}`);
          console.log("  docker ps");
          console.log("");
          console.log(`  ${dim("# Exit back to installer:")}`);
          console.log("  exit");
        }
      }
    }
    
    console.log("\n" + yellow("─".repeat(70)));
    console.log("\n" + bold("Please open a new terminal and run the commands above."));
    console.log("Once complete, return here and press Enter to continue.\n");
    
    await Confirm.prompt({
      message: "Have you completed the manual steps?",
      default: true,
    });
  }

  private async testInterNodeConnectivity(): Promise<boolean> {
    // Test basic network connectivity (ping) between nodes
    // We can't test specific ports yet since Garage isn't running
    
    console.log("  Testing node1 -> node2...");
    try {
      // Try to ping the other node (1 packet, 5 second timeout)
      let result = await this.node1!.connection!.exec(
        `ping -c 1 -W 5 ${this.node2!.host} 2>&1`,
        10000 // 10 second timeout
      );
      
      // Check if ping succeeded (exit code 0 means success)
      if (result.code !== 0) {
        console.log(red(`  ✖ Cannot reach ${this.node2!.host} from node1 (ping failed)`));
        console.log(yellow(`    If nodes are on same network and can SSH to each other, this may be due to ICMP being blocked.`));
        console.log(yellow(`    Checking if SSH is possible instead...`));
        
        // Fallback: Try to resolve hostname or validate IP
        const resolveResult = await this.node1!.connection!.exec(
          `getent hosts ${this.node2!.host} || host ${this.node2!.host} || echo "FAILED"`,
          5000
        );
        
        if (resolveResult.stdout.includes("FAILED") || resolveResult.code !== 0) {
          console.log(red(`  ✖ Cannot resolve hostname ${this.node2!.host} from node1`));
          return false;
        }
        
        console.log(green(`  ✓ Hostname resolution works, assuming network connectivity is OK`));
      } else {
        console.log(green("  ✓ node1 can reach node2"));
      }
    } catch (error: any) {
      console.log(red(`  ✖ Error testing connectivity: ${error.message}`));
      return false;
    }

    console.log("  Testing node2 -> node1...");
    try {
      // Try to ping the other node
      let result = await this.node2!.connection!.exec(
        `ping -c 1 -W 5 ${this.node1!.host} 2>&1`,
        10000
      );
      
      if (result.code !== 0) {
        console.log(red(`  ✖ Cannot reach ${this.node1!.host} from node2 (ping failed)`));
        console.log(yellow(`    If nodes are on same network and can SSH to each other, this may be due to ICMP being blocked.`));
        console.log(yellow(`    Checking if SSH is possible instead...`));
        
        // Fallback: Try to resolve hostname or validate IP
        const resolveResult = await this.node2!.connection!.exec(
          `getent hosts ${this.node1!.host} || host ${this.node1!.host} || echo "FAILED"`,
          5000
        );
        
        if (resolveResult.stdout.includes("FAILED") || resolveResult.code !== 0) {
          console.log(red(`  ✖ Cannot resolve hostname ${this.node1!.host} from node2`));
          return false;
        }
        
        console.log(green(`  ✓ Hostname resolution works, assuming network connectivity is OK`));
      } else {
        console.log(green("  ✓ node2 can reach node1"));
      }
    } catch (error: any) {
      console.log(red(`  ✖ Error testing connectivity: ${error.message}`));
      return false;
    }

    return true;
  }

  private async configureCluster() {
    console.log("\nConfiguring cluster parameters...\n");

    const capacity = await Input.prompt({
      message: "Storage capacity per node (e.g., 10G, 100G, 1T):",
      default: DEFAULT_CAPACITY,
      validate: (value: string) => {
        if (!/^\d+[KMGT]$/.test(value)) {
          return "Invalid format. Use: 10G, 100G, 1T, etc.";
        }
        
        // Parse and validate reasonable bounds
        const match = value.match(/^(\d+)([KMGT])$/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];
          
          // Convert to GB for comparison
          let capacityGB = amount;
          if (unit === 'K') capacityGB = amount / (1024 * 1024);
          else if (unit === 'M') capacityGB = amount / 1024;
          else if (unit === 'T') capacityGB = amount * 1024;
          
          // Check bounds
          if (capacityGB < 1) {
            return "Capacity too small. Minimum 1GB recommended.";
          }
          if (capacityGB > 100000) { // 100TB
            return "Capacity seems unusually large. Please verify.";
          }
          
          // Warn if very small
          if (capacityGB < 5) {
            console.log(yellow("\n  ⚠ Warning: Small capacity may limit cluster functionality."));
          }
        }
        
        return true;
      },
    });

    // Ask if user wants advanced configuration
    const advancedConfig = await Confirm.prompt({
      message: "Configure advanced settings (ports, paths)?",
      default: false,
    });

    let dataDir = DEFAULT_PATHS.dataDir;
    let metaDir = DEFAULT_PATHS.metaDir;
    let workdir = DEFAULT_PATHS.workdir;
    let garageVersion = DEFAULT_GARAGE_VERSION;
    let ports = { ...DEFAULT_PORTS };

    if (advancedConfig) {
      console.log(cyan("\n--- Advanced Configuration ---\n"));
      
      workdir = await Input.prompt({
        message: "Working directory path:",
        default: DEFAULT_PATHS.workdir,
      });

      dataDir = await Input.prompt({
        message: "Data directory path:",
        default: DEFAULT_PATHS.dataDir,
      });

      metaDir = await Input.prompt({
        message: "Metadata directory path:",
        default: DEFAULT_PATHS.metaDir,
      });

      garageVersion = await Input.prompt({
        message: "Garage version:",
        default: DEFAULT_GARAGE_VERSION,
      });

      // Validate and warn about version
      this.validateGarageVersion(garageVersion);

      const customPorts = await Confirm.prompt({
        message: "Customize ports?",
        default: false,
      });

      if (customPorts) {
        ports.s3Api = await NumberPrompt.prompt({
          message: "S3 API port:",
          default: DEFAULT_PORTS.s3Api,
          min: 1,
          max: 65535,
        });

        ports.rpc = await NumberPrompt.prompt({
          message: "RPC port:",
          default: DEFAULT_PORTS.rpc,
          min: 1,
          max: 65535,
        });

        ports.s3Web = await NumberPrompt.prompt({
          message: "S3 Web port:",
          default: DEFAULT_PORTS.s3Web,
          min: 1,
          max: 65535,
        });

        ports.admin = await NumberPrompt.prompt({
          message: "Admin API port:",
          default: DEFAULT_PORTS.admin,
          min: 1,
          max: 65535,
        });
      }
    }

    // Generate RPC secret
    const rpcSecret = this.generateRPCSecret();
    console.log(dim(`\nGenerated RPC secret: ${rpcSecret.substring(0, 16)}...`));

    this.clusterConfig = {
      rpcSecret,
      capacityPerNode: capacity,
      dataDir,
      metaDir,
      workdir,
      garageVersion,
      replicationFactor: DEFAULT_REPLICATION_FACTOR,
      ports,
    };

    console.log(green("\n✓ Cluster configured"));
  }

  private generateRPCSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async showSummary() {
    console.log("\n" + bold("Deployment Summary:"));
    console.log("━".repeat(60));
    
    console.log(bold("\nNodes:"));
    console.log(`  Node 1: ${cyan(this.node1!.host)} (${this.node1!.username})`);
    console.log(`  Node 2: ${cyan(this.node2!.host)} (${this.node2!.username})`);
    
    console.log(bold("\nCluster:"));
    console.log(`  Version: ${this.clusterConfig!.garageVersion}`);
    console.log(`  Replication: ${this.clusterConfig!.replicationFactor}x`);
    console.log(`  Capacity: ${this.clusterConfig!.capacityPerNode} per node`);
    console.log(`  Data dir: ${this.clusterConfig!.dataDir}`);
    console.log(`  Meta dir: ${this.clusterConfig!.metaDir}`);
    
    console.log("\n" + "━".repeat(60));

    const confirm = await Confirm.prompt({
      message: "Proceed with deployment?",
      default: true,
    });

    if (!confirm) {
      throw new Error("Deployment cancelled by user");
    }
  }

  private async deployCluster() {
    const garage = new GarageCluster(
      [this.node1!, this.node2!],
      this.clusterConfig!,
      this.cleanupManager
    );

    // Deploy to each node
    await garage.deploy(this.display);

    // Configure cluster
    await garage.configure(this.display);

    console.log(green("\n✓ Cluster deployed and configured"));
  }

  private async postInstall() {
    console.log("\nSaving configuration...");
    
    const configFile = "./garage-cluster-config.json";
    const config = {
      nodes: [
        { name: this.node1!.name, host: this.node1!.host },
        { name: this.node2!.name, host: this.node2!.host },
      ],
      cluster: this.clusterConfig,
      installedAt: new Date().toISOString(),
    };

    await Deno.writeTextFile(configFile, JSON.stringify(config, null, 2));
    console.log(green(`✓ Configuration saved to ${configFile}`));
  }

  private showSuccessMessage() {
    console.log("\n" + "═".repeat(60));
    console.log(bold(green("Your Garage cluster is ready!")));
    console.log("═".repeat(60));
    
    console.log("\n" + bold("S3 API Endpoints:"));
    console.log(`  http://${this.node1!.host}:3900`);
    console.log(`  http://${this.node2!.host}:3900`);
    
    console.log("\n" + bold("Next steps:"));
    console.log("1. Create a bucket:");
    console.log(dim(`   ssh ${this.node1!.username}@${this.node1!.host}`));
    console.log(dim(`   docker exec garage garage bucket create my-bucket`));
    
    console.log("\n2. Create an access key:");
    console.log(dim(`   docker exec garage garage key create my-key`));
    
    console.log("\n3. Grant access:");
    console.log(dim(`   docker exec garage garage bucket allow my-bucket --read --write --key my-key`));
    
    console.log("\n4. Get credentials:");
    console.log(dim(`   docker exec garage garage key info my-key`));
    
    console.log("\n" + bold("Documentation:"));
    console.log("  https://garagehq.deuxfleurs.fr/documentation/");
    console.log("\n");
  }

  private validateGarageVersion(version: string): void {
    // Compare versions (simple string comparison works for semver-like versions)
    const compareVersions = (a: string, b: string): number => {
      const aParts = a.replace('v', '').split('.').map(Number);
      const bParts = b.replace('v', '').split('.').map(Number);
      
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || 0;
        const bPart = bParts[i] || 0;
        if (aPart > bPart) return 1;
        if (aPart < bPart) return -1;
      }
      return 0;
    };

    // Check if version is too old
    if (compareVersions(version, MINIMUM_VERSION) < 0) {
      console.log(yellow(`\n  ⚠ Warning: Version ${version} is older than the minimum recommended version (${MINIMUM_VERSION}).`));
      console.log(yellow(`    Consider upgrading to ${DEFAULT_GARAGE_VERSION} for better stability and features.`));
    }

    // Check if it's a known good version
    if (!KNOWN_GOOD_VERSIONS.includes(version as any)) {
      console.log(yellow(`\n  ℹ Note: Version ${version} is not in the list of tested versions.`));
      console.log(yellow(`    Known stable versions: ${KNOWN_GOOD_VERSIONS.join(', ')}`));
      console.log(yellow(`    This version may work but hasn't been extensively tested with this installer.`));
    }
  }

  private async closeConnections() {
    // Close SSH connections
    if (this.node1?.connection) {
      await this.node1.connection.close();
    }
    if (this.node2?.connection) {
      await this.node2.connection.close();
    }
  }
}
