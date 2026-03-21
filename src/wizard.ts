import { Input, Confirm, Number as NumberPrompt, Select, Secret } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { SSHConnection } from "./ssh/connection.ts";
import { SystemChecker } from "./checks/system.ts";
import { DockerManager } from "./docker/manager.ts";
import { GarageCluster } from "./garage/cluster.ts";
import { GarageAdmin } from "./garage/admin.ts";
import { DisplayManager } from "./ui/display.ts";
import { CleanupManager } from "./cleanup.ts";
import { StateManager, type InstallationState } from "./state.ts";
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
  adminToken: string;
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
  private stateManager: StateManager;
  private node1?: NodeConfig;
  private node2?: NodeConfig;
  private clusterConfig?: ClusterConfig;
  private resumeMode: boolean = false;

  constructor() {
    this.display = new DisplayManager();
    this.cleanupManager = new CleanupManager();
    this.stateManager = new StateManager();
  }

  async run() {
    // Initialize logging
    const logger = initLogger();
    console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
    await logger.info("=== Garage Installer Started ===");

    // Check for existing state
    const hasExistingState = await this.stateManager.exists();
    if (hasExistingState) {
      await this.stateManager.load();
      const state = this.stateManager.getState();
      
      if (state && this.stateManager.isInProgress()) {
        console.log(yellow("⚠️  Found previous installation in progress"));
        const lastPhase = this.stateManager.getLastCompletedPhase();
        const nextPhase = this.stateManager.getNextPendingPhase();
        
        if (lastPhase) {
          console.log(`   Last completed: ${bold(lastPhase)}`);
        }
        if (nextPhase) {
          console.log(`   Next step: ${bold(nextPhase)}`);
        }
        console.log(`   Last updated: ${dim(new Date(state.lastUpdated).toLocaleString())}\n`);
        
        const action = await Select.prompt({
          message: "What would you like to do?",
          options: [
            { name: "Resume installation from last checkpoint", value: "resume" },
            { name: "Start fresh (clear previous state)", value: "fresh" },
            { name: "Cancel", value: "cancel" },
          ],
        });
        
        if (action === "cancel") {
          console.log("Installation cancelled.");
          await logger.info("Installation cancelled by user");
          return;
        }
        
        if (action === "resume") {
          this.resumeMode = true;
          await this.resumeInstallation(state);
          return;
        }
        
        // Fresh start - clear old state
        await this.stateManager.clear();
      }
    }
    
    // Initialize new state
    this.stateManager.initializeState();
    await this.stateManager.save();

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
      await this.stateManager.clear();
      return;
    }

    try {
      // Phase 1: Node Discovery
      console.log(bold(cyan("\n=== Phase 1: Node Configuration ===")));
      await logger.info("Phase 1: Node Configuration started");
      this.stateManager.updatePhase("nodeConfig", "in-progress");
      await this.stateManager.save();
      
      await this.collectNodeInfo();
      
      this.stateManager.updatePhase("nodeConfig", "completed");
      this.stateManager.updateNodes([this.node1!, this.node2!]);
      await this.stateManager.save();

      // Phase 2: SSH Connectivity
      console.log(bold(cyan("\n=== Phase 2: Testing Connectivity ===")));
      await logger.info("Phase 2: Testing Connectivity started");
      this.stateManager.updatePhase("connectivity", "in-progress");
      await this.stateManager.save();
      
      await this.testConnectivity();
      
      this.stateManager.updatePhase("connectivity", "completed");
      await this.stateManager.save();

      // Phase 3: Preflight Checks
      console.log(bold(cyan("\n=== Phase 3: System Checks ===")));
      await logger.info("Phase 3: System Checks started");
      this.stateManager.updatePhase("preflightChecks", "in-progress");
      await this.stateManager.save();
      
      await this.runPreflightChecks();
      
      this.stateManager.updatePhase("preflightChecks", "completed");
      await this.stateManager.save();

      // Phase 4: Cluster Configuration
      console.log(bold(cyan("\n=== Phase 4: Cluster Configuration ===")));
      await logger.info("Phase 4: Cluster Configuration started");
      this.stateManager.updatePhase("clusterConfig", "in-progress");
      await this.stateManager.save();
      
      await this.configureCluster();
      
      this.stateManager.updatePhase("clusterConfig", "completed");
      this.stateManager.updateCluster(this.clusterConfig!);
      await this.stateManager.save();

      // Phase 5: Deployment Summary
      console.log(bold(cyan("\n=== Phase 5: Deployment Summary ===")));
      await logger.info("Phase 5: Deployment Summary");
      await this.showSummary();

      // Phase 6: Deploy
      console.log(bold(cyan("\n=== Phase 6: Deploying Garage ===")));
      await logger.info("Phase 6: Deploying Garage started");
      this.stateManager.updatePhase("deployment", "in-progress");
      await this.stateManager.save();
      
      await this.deployCluster();
      
      this.stateManager.updatePhase("deployment", "completed");
      await this.stateManager.save();

      // Phase 6.5: Configure cluster
      this.stateManager.updatePhase("configuration", "in-progress");
      await this.stateManager.save();
      
      // (Configuration is part of deployCluster, just mark complete)
      this.stateManager.updatePhase("configuration", "completed");
      await this.stateManager.save();

      // Phase 7: Post-Install
      console.log(bold(cyan("\n=== Phase 7: Finalizing ===")));
      await logger.info("Phase 7: Finalizing started");
      this.stateManager.updatePhase("postInstall", "in-progress");
      await this.stateManager.save();
      
      await this.postInstall();
      
      this.stateManager.updatePhase("postInstall", "completed");
      await this.stateManager.save();

      console.log(green(bold("\n✓ Installation complete!")));
      await logger.info("Installation completed successfully");
      this.showSuccessMessage();
      
      // Clear state after successful installation
      await this.stateManager.clear();

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : "";
      await logger.error("Installation failed", { error: errorMsg, stack: errorStack });
      console.error(red(bold("\n✖ Installation failed:")), errorMsg);
      console.error(dim(`\nFor troubleshooting, check the log file: ${logger.getLogPath()}`));
      
      // Mark current phase as failed
      const nextPhase = this.stateManager.getNextPendingPhase();
      if (nextPhase) {
        this.stateManager.updatePhase(nextPhase, "failed");
        await this.stateManager.save();
      }
      
      console.log(yellow("\n💾 Installation state saved. You can resume later by running the installer again."));
      
      // Offer to cleanup if anything was deployed
      if (this.cleanupManager.hasDeploymentState()) {
        const shouldCleanup = await Confirm.prompt({
          message: "Would you like to rollback and clean up what was deployed?",
          default: true,
        });

        if (shouldCleanup) {
          await this.cleanupManager.cleanupAll([this.node1!, this.node2!].filter(n => n));
          await this.stateManager.clear();
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

  private async resumeInstallation(state: InstallationState) {
    const logger = getLogger();
    await logger.info("=== Resuming Garage Installation ===");

    console.log(bold("\nResuming installation from saved state...\n"));

    try {
      // Restore node configuration from state
      if (state.nodes && state.nodes.length >= 2) {
        this.node1 = {
          ...state.nodes[0],
          connection: undefined,
        };
        this.node2 = {
          ...state.nodes[1],
          connection: undefined,
        };
        
        // Prompt for passwords if using password auth (not saved in state)
        if (this.node1 && this.node1.authMethod === "password") {
          const password = await Secret.prompt({
            message: `Password for ${this.node1.username}@${this.node1.host}:`,
          });
          this.node1.password = password;
        }
        
        if (this.node2 && this.node2.authMethod === "password") {
          const password = await Secret.prompt({
            message: `Password for ${this.node2.username}@${this.node2.host}:`,
          });
          this.node2.password = password;
        }
      }

      // Restore cluster configuration
      if (state.cluster) {
        this.clusterConfig = state.cluster;
      }

      // Determine where to resume from
      const nextPhase = this.stateManager.getNextPendingPhase();
      
      if (!nextPhase) {
        console.log(green("✓ Installation already complete!"));
        return;
      }

      console.log(yellow(`Resuming from phase: ${bold(nextPhase)}\n`));

      // Reconnect to nodes if needed
      if (nextPhase !== "nodeConfig") {
        console.log("Reconnecting to nodes...");
        await this.testConnectivity();
      }

      // Resume from the appropriate phase
      if (nextPhase === "nodeConfig" || state.phases.nodeConfig !== "completed") {
        console.log(bold(cyan("\n=== Phase 1: Node Configuration ===")));
        this.stateManager.updatePhase("nodeConfig", "in-progress");
        await this.stateManager.save();
        await this.collectNodeInfo();
        this.stateManager.updatePhase("nodeConfig", "completed");
        this.stateManager.updateNodes([this.node1!, this.node2!]);
        await this.stateManager.save();
      }

      if (nextPhase === "connectivity" || (state.phases.nodeConfig === "completed" && state.phases.connectivity !== "completed")) {
        console.log(bold(cyan("\n=== Phase 2: Testing Connectivity ===")));
        this.stateManager.updatePhase("connectivity", "in-progress");
        await this.stateManager.save();
        await this.testConnectivity();
        this.stateManager.updatePhase("connectivity", "completed");
        await this.stateManager.save();
      }

      if (nextPhase === "preflightChecks" || (state.phases.connectivity === "completed" && state.phases.preflightChecks !== "completed")) {
        console.log(bold(cyan("\n=== Phase 3: System Checks ===")));
        this.stateManager.updatePhase("preflightChecks", "in-progress");
        await this.stateManager.save();
        await this.runPreflightChecks();
        this.stateManager.updatePhase("preflightChecks", "completed");
        await this.stateManager.save();
      }

      if (nextPhase === "clusterConfig" || (state.phases.preflightChecks === "completed" && state.phases.clusterConfig !== "completed")) {
        console.log(bold(cyan("\n=== Phase 4: Cluster Configuration ===")));
        this.stateManager.updatePhase("clusterConfig", "in-progress");
        await this.stateManager.save();
        await this.configureCluster();
        this.stateManager.updatePhase("clusterConfig", "completed");
        this.stateManager.updateCluster(this.clusterConfig!);
        await this.stateManager.save();
      }

      if (nextPhase === "deployment" || (state.phases.clusterConfig === "completed" && state.phases.deployment !== "completed")) {
        console.log(bold(cyan("\n=== Phase 5: Deployment Summary ===")));
        await this.showSummary();

        console.log(bold(cyan("\n=== Phase 6: Deploying Garage ===")));
        this.stateManager.updatePhase("deployment", "in-progress");
        await this.stateManager.save();
        await this.deployCluster();
        this.stateManager.updatePhase("deployment", "completed");
        this.stateManager.updatePhase("configuration", "completed");
        await this.stateManager.save();
      }

      if (nextPhase === "postInstall" || (state.phases.deployment === "completed" && state.phases.postInstall !== "completed")) {
        console.log(bold(cyan("\n=== Phase 7: Finalizing ===")));
        this.stateManager.updatePhase("postInstall", "in-progress");
        await this.stateManager.save();
        await this.postInstall();
        this.stateManager.updatePhase("postInstall", "completed");
        await this.stateManager.save();
      }

      console.log(green(bold("\n✓ Installation complete!")));
      await logger.info("Installation completed successfully (resumed)");
      this.showSuccessMessage();
      
      // Clear state after successful installation
      await this.stateManager.clear();

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : "";
      await logger.error("Installation failed during resume", { error: errorMsg, stack: errorStack });
      console.error(red(bold("\n✖ Installation failed:")), errorMsg);
      
      // Mark current phase as failed
      const nextPhase = this.stateManager.getNextPendingPhase();
      if (nextPhase) {
        this.stateManager.updatePhase(nextPhase, "failed");
        await this.stateManager.save();
      }
      
      console.log(yellow("\n💾 Installation state saved. You can resume later by running the installer again."));
      
      throw error;
    } finally {
      await this.closeConnections();
    }
  }

  async runUninstall() {
    // Initialize logging
    const logger = initLogger();
    console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
    await logger.info("=== Garage Uninstaller Started ===");

    console.log(bold("This will remove Garage from your nodes.\n"));
    console.log(yellow("⚠️  Warning: This will:"));
    console.log("  • Stop and remove Garage containers");
    console.log("  • Remove configuration files");
    console.log("  • Optionally remove data directories\n");

    const proceed = await Confirm.prompt({
      message: "Are you sure you want to uninstall?",
      default: false,
    });

    if (!proceed) {
      console.log("Uninstall cancelled.");
      await logger.info("Uninstall cancelled by user");
      return;
    }

    try {
      // Try to load node information from config file or saved state
      let usesSavedConfig = false;
      
      // First check for garage-cluster-config.json
      const configFile = "garage-cluster-config.json";
      try {
        const configContent = await Deno.readTextFile(configFile);
        const config = JSON.parse(configContent);
        
        if (config.nodes && config.nodes.length === 2) {
          console.log(green(`✓ Found ${configFile}`));
          console.log(`  • ${config.nodes[0].name} (${config.nodes[0].host})`);
          console.log(`  • ${config.nodes[1].name} (${config.nodes[1].host})\n`);
          
          const useSaved = await Confirm.prompt({
            message: "Use these nodes for uninstall?",
            default: true,
          });
          
          if (useSaved) {
            // Find available SSH key
            const homeDir = Deno.env.get("HOME") || "";
            const commonKeys = [
              `${homeDir}/.ssh/id_ed25519`,
              `${homeDir}/.ssh/id_rsa`,
              `${homeDir}/.ssh/id_ecdsa`,
            ];
            
            let foundKey = "";
            for (const keyPath of commonKeys) {
              try {
                await Deno.stat(keyPath);
                foundKey = keyPath;
                break;
              } catch {
                // Key doesn't exist, try next one
              }
            }
            
            if (!foundKey) {
              console.log(yellow("\n⚠ No SSH key found in ~/.ssh/"));
              console.log(dim("Please enter SSH credentials manually.\n"));
              // Fall through to manual collection
            } else {
              // Initialize node configurations from config file
              this.node1 = {
                name: config.nodes[0].name,
                host: config.nodes[0].host,
                port: 22,
                username: Deno.env.get("USER") || "ubuntu",
                authMethod: "key",
                keyPath: foundKey,
              };
              
              this.node2 = {
                name: config.nodes[1].name,
                host: config.nodes[1].host,
                port: 22,
                username: Deno.env.get("USER") || "ubuntu",
                authMethod: "key",
                keyPath: foundKey,
              };
              
              const keyName = foundKey.split('/').pop();
              console.log(bold(cyan("\n=== Connecting to Nodes ===")));
              console.log(dim(`Using default SSH settings (port 22, current user, ~/.ssh/${keyName})\n`));
              
              await this.testConnectivity();
              usesSavedConfig = true;
            }
          }
        }
      } catch {
        // Config file doesn't exist or is invalid, try state file
      }
      
      // If not using config file, try to load from saved state
      if (!usesSavedConfig && await this.stateManager.exists()) {
        await this.stateManager.load();
        const state = this.stateManager.getState();
        
        if (state && state.nodes && state.nodes.length === 2) {
          console.log(green("✓ Found saved installation state"));
          console.log(`  • ${state.nodes[0].name} (${state.nodes[0].host})`);
          console.log(`  • ${state.nodes[1].name} (${state.nodes[1].host})\n`);
          
          const useSaved = await Confirm.prompt({
            message: "Use these nodes for uninstall?",
            default: true,
          });
          
          if (useSaved) {
            // Restore node configurations (but need to prompt for passwords)
            this.node1 = { ...state.nodes[0] as NodeConfig };
            this.node2 = { ...state.nodes[1] as NodeConfig };
            
            console.log(bold(cyan("\n=== Connecting to Nodes ===")));
            
            // Prompt for passwords (not stored in state)
            this.node1.password = await Secret.prompt({
              message: `Password for ${this.node1.name} (${this.node1.username}@${this.node1.host}):`,
            });
            
            this.node2.password = await Secret.prompt({
              message: `Password for ${this.node2.name} (${this.node2.username}@${this.node2.host}):`,
            });
            
            await this.testConnectivity();
            usesSavedConfig = true;
          }
        }
      }
      
      // If not using saved config or state, collect node information manually
      if (!usesSavedConfig) {
        console.log(bold(cyan("\n=== Connecting to Nodes ===")));
        await this.collectNodeInfo();
        await this.testConnectivity();
      }

      // Confirm one more time with specific node details
      console.log(yellow("\nYou are about to uninstall Garage from:"));
      console.log(`  • ${this.node1!.name} (${this.node1!.host})`);
      console.log(`  • ${this.node2!.name} (${this.node2!.host})`);
      
      const finalConfirm = await Confirm.prompt({
        message: "Proceed with uninstallation?",
        default: false,
      });

      if (!finalConfirm) {
        console.log("Uninstall cancelled.");
        return;
      }

      // Ask about data directories
      const removeData = await Confirm.prompt({
        message: "Also remove data directories (this will delete all stored data)?",
        default: false,
      });

      // Perform uninstall
      console.log(bold(cyan("\n=== Uninstalling Garage ===")));
      await logger.info("Starting uninstall process");

      const nodes = [this.node1!, this.node2!];
      
      for (const node of nodes) {
        console.log(`\nUninstalling from ${bold(node.name)}...`);
        
        const docker = new DockerManager(node.connection!);

        // Stop and remove container
        console.log(dim("  Stopping container..."));
        await docker.stopContainer("garage");
        await docker.removeContainer("garage");
        console.log(green("  ✓ Container removed"));

        // Get workdir location
        const workdirResult = await node.connection!.exec("ls -d ~/garage 2>/dev/null || echo ''");
        const workdir = workdirResult.stdout.trim();

        // Remove workdir (contains docker-compose.yml and garage.toml)
        if (workdir) {
          console.log(dim("  Removing configuration..."));
          await node.connection!.exec(`rm -rf ${workdir}`);
          console.log(green("  ✓ Configuration removed"));
        }

        // Optionally remove data directories
        if (removeData) {
          console.log(dim("  Removing data directories..."));
          await node.connection!.exec("rm -rf ~/garage 2>/dev/null || true");
          console.log(green("  ✓ Data directories removed"));
        } else {
          console.log(yellow("  ℹ Data directories preserved at ~/garage/data and ~/garage/meta"));
        }

        console.log(green(`✓ ${node.name} uninstalled`));
      }

      console.log(green(bold("\n✓ Uninstallation complete!")));
      await logger.info("Uninstallation completed successfully");

      if (!removeData) {
        console.log(yellow("\nNote: Data directories were preserved."));
        console.log("To manually remove them later, run on each node:");
        console.log(dim("  rm -rf ~/garage/data ~/garage/meta"));
      }

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : "";
      await logger.error("Uninstallation failed", { error: errorMsg, stack: errorStack });
      console.error(red(bold("\n✖ Uninstallation failed:")), errorMsg);
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

    const authMethodRaw = await Select.prompt({
      message: "Authentication method:",
      options: [
        { name: "SSH Key", value: "key" },
        { name: "Password", value: "password" },
      ],
      default: "key",
    });
    const authMethod1 = authMethodRaw as "key" | "password";

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
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          if (err.message === "SSH key validation failed") throw error;
          console.log(red(`\n  ✗ Cannot read key file: ${keyPath1}`));
          console.log(yellow(`    Error: ${err.message}`));
          const retry = await Confirm.prompt({
            message: "Try a different key path?",
            default: true,
          });
          if (!retry) throw new Error("SSH key validation failed");
        }
      }
    } else {
      password1 = await Secret.prompt({
        message: "SSH password:",
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

      const authMethodRaw2 = await Select.prompt({
        message: "Authentication method:",
        options: [
          { name: "SSH Key", value: "key" },
          { name: "Password", value: "password" },
        ],
      });
      const authMethod2 = authMethodRaw2 as "key" | "password";

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
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            if (err.message === "SSH key validation failed") throw error;
            console.log(red(`\n  ✗ Cannot read key file: ${keyPath2}`));
            console.log(yellow(`    Error: ${err.message}`));
            const retry = await Confirm.prompt({
              message: "Try a different key path?",
              default: true,
            });
            if (!retry) throw new Error("SSH key validation failed");
          }
        }
      } else {
        password2 = await Secret.prompt({
          message: "SSH password:",
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
    const manualInterventionNeeded: Array<{node: NodeConfig, failures: Error[]}> = [];

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
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              if (err.message === "MANUAL_INTERVENTION_REQUIRED") {
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

  private async handleManualIntervention(interventions: Array<{node: NodeConfig, failures: Error[]}>) {
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
      const result = await this.node1!.connection!.exec(
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
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.log(red(`  ✖ Error testing connectivity: ${err.message}`));
      return false;
    }

    console.log("  Testing node2 -> node1...");
    try {
      // Try to ping the other node
      const result = await this.node2!.connection!.exec(
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
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.log(red(`  ✖ Error testing connectivity: ${err.message}`));
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

    let dataDir: string = DEFAULT_PATHS.dataDir;
    let metaDir: string = DEFAULT_PATHS.metaDir;
    let workdir: string = DEFAULT_PATHS.workdir;
    let garageVersion = DEFAULT_GARAGE_VERSION;
    const ports: { s3Api: number; rpc: number; s3Web: number; admin: number } = { ...DEFAULT_PORTS };

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

    // Generate RPC secret and admin token
    const rpcSecret = this.generateRPCSecret();
    const adminToken = this.generateRPCSecret();
    console.log(dim(`\nGenerated RPC secret: ${rpcSecret.substring(0, 16)}...`));
    console.log(dim(`Generated Admin token: ${adminToken.substring(0, 16)}...`));

    this.clusterConfig = {
      rpcSecret,
      adminToken,
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

    // Ask if user wants to run validation test
    console.log("");
    const runTest = await Confirm.prompt({
      message: "Run validation test (create test bucket and upload file)?",
      default: true,
    });

    if (runTest) {
      // For post-install, we can auto-create credentials and test
      await this.runPostInstallValidation();
    }
  }

  private async runPostInstallValidation() {
    console.log(bold(cyan("\n=== Post-Install Validation ===")));
    console.log(dim("Creating test credentials via SSH, then testing locally...\n"));
    
    // Create temporary AWS config for path-style addressing
    const tempDir = `/tmp/garage-installer-${Date.now()}`;
    await Deno.mkdir(tempDir, { recursive: true });
    const awsConfigContent = `[default]
region = garage
s3 =
    addressing_style = path
`;
    await Deno.writeTextFile(`${tempDir}/config`, awsConfigContent);
    
    try {
      const testBucket = "installer-test-bucket";
      const testKey = "installer-test-key";
      let accessKey = "";
      let secretKey = "";
      
      // Step 1: Create bucket via SSH
      await withSpinner("Creating test bucket", async () => {
        const result = await this.node1!.connection!.exec(
          `docker exec garage /garage bucket create ${testBucket}`
        );
        if (result.code !== 0 && !result.stderr.includes("already exists")) {
          throw new Error(`Failed to create bucket: ${result.stderr}`);
        }
      });
      
      // Step 2: Create key via SSH and extract credentials immediately
      await withSpinner("Creating test access key", async () => {
        const result = await this.node1!.connection!.exec(
          `docker exec garage /garage key create ${testKey}`
        );
        
        if (result.code !== 0 && !result.stderr.includes("already exists")) {
          throw new Error(`Failed to create key: ${result.stderr}`);
        }
        
        // Extract credentials from CREATE output (not INFO - it redacts the secret!)
        const accessKeyMatch = result.stdout.match(/Key ID:\s+(\S+)/i);
        const secretKeyMatch = result.stdout.match(/Secret key:\s+(\S+)/i);
        
        if (accessKeyMatch) accessKey = accessKeyMatch[1].trim();
        if (secretKeyMatch) secretKey = secretKeyMatch[1].trim();
        
        if (!accessKey || !secretKey) {
          console.log(red("\n📋 Full garage key create output:"));
          console.log(result.stdout);
          console.log(red("\n🔍 Extraction results:"));
          console.log(`  Access Key Match: ${accessKeyMatch ? accessKeyMatch[1] : 'NOT FOUND'}`);
          console.log(`  Secret Key Match: ${secretKeyMatch ? secretKeyMatch[1] : 'NOT FOUND'}`);
          throw new Error(`Failed to extract credentials from key creation. Output: ${result.stdout.substring(0, 200)}`);
        }
      });
      
      console.log(dim(`\n  Access Key: ${accessKey}`));
      console.log(dim(`  Secret Key: ${secretKey.substring(0, 16)}...\n`));
      
      // Step 3: Grant permissions via SSH
      await withSpinner("Granting bucket permissions", async () => {
        const result = await this.node1!.connection!.exec(
          `docker exec garage /garage bucket allow ${testBucket} --read --write --key ${accessKey}`
        );
        if (result.code !== 0) {
          throw new Error(`Failed to grant permissions: ${result.stderr}`);
        }
      });
      
      // Step 4: Test from local machine
      const endpoint = `http://${this.node1!.host}:${this.clusterConfig!.ports.s3Api}`;
      console.log(dim(`\n  Testing endpoint: ${endpoint}`));
      console.log(dim(`  Using bucket: ${testBucket}\n`));
      
      await this.runValidationTest(endpoint, accessKey, secretKey, testBucket, tempDir);
      
      // Show AWS CLI setup instructions
      this.showAWSCLISetup(endpoint);
      
      // Step 5: Cleanup via SSH
      await withSpinner("Cleaning up test resources", async () => {
        await this.node1!.connection!.exec(
          `docker exec garage /garage bucket delete ${testBucket} --yes 2>/dev/null || true`
        );
        await this.node1!.connection!.exec(
          `docker exec garage /garage key delete ${testKey} --yes 2>/dev/null || true`
        );
      });
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.log(red(bold("\n✖ Post-install validation failed")));
      console.log(yellow("\nNote: The cluster may still be functional. You can test manually later."));
      console.log(dim(`\nError: ${err.message}`));
    } finally {
      // Cleanup temp config
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async runValidation() {
    // Initialize logging
    const logger = initLogger();
    console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
    await logger.info("=== Garage Validation Started ===");

    console.log(bold("This will validate an existing Garage installation.\n"));
    console.log(dim("This validation runs completely from your local machine."));
    console.log(dim("Requires AWS CLI to be installed.\n"));

    // Create temporary AWS config for path-style addressing
    const tempDir = `/tmp/garage-installer-${Date.now()}`;
    await Deno.mkdir(tempDir, { recursive: true });
    const awsConfigContent = `[default]
region = garage
s3 =
    addressing_style = path
`;
    await Deno.writeTextFile(`${tempDir}/config`, awsConfigContent);

    try {
      // Check for AWS CLI
      await withSpinner("Checking for AWS CLI", async () => {
        try {
          const awsCheck = new Deno.Command("which", {
            args: ["aws"],
            stdout: "null",
            stderr: "null",
          });
          const { success } = await awsCheck.output();
          
          if (!success) {
            throw new Error("AWS CLI not found");
          }
        } catch {
          throw new Error("AWS CLI is required for validation. Install with: brew install awscli");
        }
      });

      // Try to load endpoint from config file first
      const configFile = "garage-cluster-config.json";
      let endpoint = "";
      let adminEndpoint = "";
      let adminToken = "";
      
      try {
        const configContent = await Deno.readTextFile(configFile);
        const config = JSON.parse(configContent);
        
        console.log(green(`✓ Found ${configFile}`));
        
        // Get ports from config
        const s3Port = config.cluster?.ports?.s3Api || 3900;
        const adminPort = config.cluster?.ports?.admin || 3903;
        const nodeHost = config.nodes[0].host;
        endpoint = `http://${nodeHost}:${s3Port}`;
        adminEndpoint = `http://${nodeHost}:${adminPort}`;
        adminToken = config.cluster?.adminToken || "";
        
        console.log(dim(`  S3 API: ${endpoint}`));
        console.log(dim(`  Admin API: ${adminEndpoint}\n`));
        
        const useConfig = await Confirm.prompt({
          message: "Use configuration from file?",
          default: true,
        });
        
        if (!useConfig) {
          endpoint = "";
          adminEndpoint = "";
          adminToken = "";
        }
      } catch {
        // Config file doesn't exist or is invalid
      }
      
      // Prompt for endpoints if not loaded from config
      if (!endpoint) {
        const host = await Input.prompt({
          message: "Garage S3 API hostname or IP:",
          validate: (value: string) => {
            if (!value) return "Hostname is required";
            return true;
          },
        });
        
        const s3Port = await NumberPrompt.prompt({
          message: "S3 API port:",
          default: 3900,
          min: 1,
          max: 65535,
        });

        const adminPort = await NumberPrompt.prompt({
          message: "Admin API port:",
          default: 3903,
          min: 1,
          max: 65535,
        });
        
        endpoint = `http://${host}:${s3Port}`;
        adminEndpoint = `http://${host}:${adminPort}`;
        
        // Prompt for admin token
        adminToken = await Secret.prompt({
          message: "Admin API token (RPC secret):",
          validate: (value: string) => {
            if (!value) return "Admin token is required to create credentials";
            return true;
          },
        });
      }
      
      // Ask if user wants to create new credentials or use existing
      console.log(bold(cyan("\n=== Validation Mode ===")));
      
      // Check if we have admin token for credential creation
      if (!adminToken) {
        console.log(yellow("\n⚠ Note: Admin API token not available"));
        console.log(dim("  Cannot automatically create test credentials."));
        console.log(dim("  You'll need to provide existing S3 credentials.\n"));
      }
      
      const mode = await Select.prompt({
        message: "Choose validation mode:",
        options: adminToken ? [
          { name: "Create new test credentials (recommended)", value: "create" },
          { name: "Use existing credentials", value: "existing" },
        ] : [
          { name: "Use existing credentials", value: "existing" },
        ],
        default: adminToken ? "create" : "existing",
      });

      let accessKey = "";
      let secretKey = "";
      let bucketName = "installer-test-bucket";
      let createdResources = false;

      if (mode === "create") {
        // Create bucket and key using AWS CLI + Admin API
        console.log(dim("\nCreating test resources via Admin API...\n"));
        
        const keyName = `test-key-${Date.now()}`;
        bucketName = `test-bucket-${Date.now()}`;

        // Create key via Admin API
        await withSpinner("Creating access key via Admin API", async () => {
          const curlCmd = new Deno.Command("curl", {
            args: [
              "-s", "-w", "\\nHTTP_CODE:%{http_code}",
              "-X", "POST",
              `${adminEndpoint}/v1/key`,
              "-H", "Content-Type: application/json",
              "-H", `Authorization: Bearer ${adminToken}`,
              "-d", JSON.stringify({ name: keyName }),
            ],
            stdout: "piped",
            stderr: "piped",
          });
          
          const { success, stdout, stderr } = await curlCmd.output();
          const output = new TextDecoder().decode(stdout);
          const errorOutput = new TextDecoder().decode(stderr);
          
          // Extract HTTP code from output
          const httpCodeMatch = output.match(/HTTP_CODE:(\d+)/);
          const httpCode = httpCodeMatch ? parseInt(httpCodeMatch[1]) : 0;
          const responseBody = output.replace(/\nHTTP_CODE:\d+$/, '');
          
          if (!success || httpCode >= 400 || httpCode === 0) {
            let errorMsg = `HTTP ${httpCode}`;
            if (responseBody) errorMsg += `: ${responseBody}`;
            if (errorOutput) errorMsg += ` (${errorOutput})`;
            if (httpCode === 0) errorMsg = `Cannot connect to Admin API at ${adminEndpoint}. Is the cluster running?`;
            throw new Error(`Failed to create key: ${errorMsg}`);
          }
          
          try {
            const response = JSON.parse(responseBody);
            accessKey = response.accessKeyId;
            secretKey = response.secretAccessKey;
            
            if (!accessKey || !secretKey) {
              throw new Error(`API response missing credentials. Got: ${responseBody.substring(0, 100)}`);
            }
          } catch (parseError) {
            const err = parseError instanceof Error ? parseError : new Error(String(parseError));
            throw new Error(`Invalid JSON response from Admin API: ${err.message}. Response: ${responseBody.substring(0, 200)}`);
          }
        });

        console.log(dim(`  Access Key: ${accessKey}`));
        console.log(dim(`  Secret Key: ${secretKey.substring(0, 10)}...\n`));

        // Grant permission to create buckets
        await withSpinner("Granting bucket creation permission", async () => {
          const curlCmd = new Deno.Command("curl", {
            args: [
              "-s", "-w", "\\nHTTP_CODE:%{http_code}",
              "-X", "POST",
              `${adminEndpoint}/v1/key?id=${accessKey}`,
              "-H", "Content-Type: application/json",
              "-H", `Authorization: Bearer ${adminToken}`,
              "-d", JSON.stringify({
                allow: {
                  createBucket: true
                }
              }),
            ],
            stdout: "piped",
            stderr: "piped",
          });
          
          const { success, stdout, stderr } = await curlCmd.output();
          const output = new TextDecoder().decode(stdout);
          const errorOutput = new TextDecoder().decode(stderr);
          
          const httpCodeMatch = output.match(/HTTP_CODE:(\d+)/);
          const httpCode = httpCodeMatch ? parseInt(httpCodeMatch[1]) : 0;
          const responseBody = output.replace(/\nHTTP_CODE:\d+$/, '');
          
          if (!success || httpCode >= 400 || httpCode === 0) {
            let errorMsg = `HTTP ${httpCode}`;
            if (responseBody) errorMsg += `: ${responseBody}`;
            if (errorOutput) errorMsg += ` (${errorOutput})`;
            throw new Error(`Failed to grant permissions: ${errorMsg}`);
          }
        });

        // Create bucket using AWS CLI
        await withSpinner("Creating test bucket", async () => {
          const createBucketCmd = new Deno.Command("aws", {
            args: [
              "--endpoint-url", endpoint,
              "s3", "mb",
              `s3://${bucketName}`,
              "--region", "garage",
            ],
            env: {
              AWS_ACCESS_KEY_ID: accessKey,
              AWS_SECRET_ACCESS_KEY: secretKey,
              AWS_EC2_METADATA_DISABLED: "true",
              AWS_CONFIG_FILE: `${tempDir}/config`,
            },
            stdout: "piped",
            stderr: "piped",
          });
          
          const { success, stderr } = await createBucketCmd.output();
          if (!success) {
            const errorMsg = new TextDecoder().decode(stderr);
            if (!errorMsg.includes("BucketAlreadyOwnedByYou")) {
              throw new Error(`Failed to create bucket: ${errorMsg}`);
            }
          }
        });

        createdResources = true;
      } else {
        // Use existing credentials
        console.log(bold(cyan("\n=== S3 Credentials ===")));
        console.log(dim("Enter your existing Garage S3 credentials:\n"));
        
        accessKey = await Input.prompt({
          message: "Access Key ID:",
          validate: (value: string) => {
            if (!value) return "Access key is required";
            return true;
          },
        });
        
        secretKey = await Secret.prompt({
          message: "Secret Access Key:",
          validate: (value: string) => {
            if (!value) return "Secret key is required";
            return true;
          },
        });
        
        bucketName = await Input.prompt({
          message: "Test bucket name:",
          default: "installer-test-bucket",
          hint: "Must exist and be writable",
        });
      }

      // Run validation test
      await this.runValidationTest(endpoint, accessKey, secretKey, bucketName, tempDir);

      // Cleanup created resources
      if (createdResources) {
        await withSpinner("Cleaning up test resources", async () => {
          // Delete bucket
          const deleteBucketCmd = new Deno.Command("aws", {
            args: [
              "--endpoint-url", endpoint,
              "s3", "rb",
              `s3://${bucketName}`,
              "--force",
              "--region", "garage",
            ],
            env: {
              AWS_ACCESS_KEY_ID: accessKey,
              AWS_SECRET_ACCESS_KEY: secretKey,
              AWS_EC2_METADATA_DISABLED: "true",
              AWS_CONFIG_FILE: `${tempDir}/config`,
            },
            stdout: "null",
            stderr: "null",
          });
          await deleteBucketCmd.output();

          // Delete key via Admin API
          const curlCmd = new Deno.Command("curl", {
            args: [
              "-s",
              "-X", "DELETE",
              `${adminEndpoint}/v1/key?id=${accessKey}`,
              "-H", `Authorization: Bearer ${adminToken}`,
            ],
            stdout: "null",
            stderr: "null",
          });
          await curlCmd.output();
        });
      }

      console.log(green(bold("\n✓ Validation complete!")));
      console.log(dim("\nYour Garage S3 API is accessible and working correctly."));
      
      // Show AWS CLI configuration helper
      this.showAWSCLISetup(endpoint);
      
      await logger.info("Validation completed successfully");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await logger.error("Validation failed", { error: err.message, stack: err.stack });
      console.error(red(bold("\n✖ Validation failed:")), err.message);
      throw error;
    } finally {
      // Cleanup temp config
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ── Bucket & Key Admin ────────────────────────────────────────────────────

  async runBucketAdmin() {
    const logger = initLogger();
    console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
    await logger.info("=== Bucket & Key Admin Started ===");

    // ── Load cluster config ──────────────────────────────────────────────
    const configFile = "garage-cluster-config.json";
    let nodeHost = "";
    let s3Port = 3900;
    let foundKey = "";
    let username = Deno.env.get("USER") || "ubuntu";

    try {
      const raw = await Deno.readTextFile(configFile);
      const cfg = JSON.parse(raw);
      nodeHost = cfg.nodes?.[0]?.host || "";
      s3Port   = cfg.cluster?.ports?.s3Api ?? 3900;
      console.log(green(`✓ Loaded config from ${configFile}`));
      console.log(dim(`  Admin node : ${nodeHost}`));
      console.log(dim(`  S3 port    : ${s3Port}`));
    } catch {
      console.log(yellow("⚠ Could not load garage-cluster-config.json"));
    }

    // Prompt for overrides if config was missing or user wants to change
    if (!nodeHost) {
      nodeHost = await Input.prompt({
        message: "Admin node hostname or IP:",
        validate: (v: string) => v ? true : "Hostname is required",
      });
    } else {
      const override = await Confirm.prompt({
        message: `Use node "${nodeHost}" for admin operations?`,
        default: true,
      });
      if (!override) {
        nodeHost = await Input.prompt({
          message: "Admin node hostname or IP:",
          validate: (v: string) => v ? true : "Hostname is required",
        });
      }
    }

    // Detect SSH key
    const homeDir = Deno.env.get("HOME") || "";
    for (const kp of [`${homeDir}/.ssh/id_ed25519`, `${homeDir}/.ssh/id_rsa`, `${homeDir}/.ssh/id_ecdsa`]) {
      try { await Deno.stat(kp); foundKey = kp; break; } catch { /* skip */ }
    }

    if (!foundKey) {
      foundKey = await Input.prompt({
        message: "Path to SSH private key:",
        default: `${homeDir}/.ssh/id_rsa`,
      });
    }

    username = await Input.prompt({
      message: "SSH username:",
      default: Deno.env.get("USER") || "ubuntu",
    });

    // ── Connect ──────────────────────────────────────────────────────────
    const adminNode: NodeConfig = {
      name: "admin",
      host: nodeHost,
      port: 22,
      username,
      authMethod: "key",
      keyPath: foundKey,
    };

    const { SSHConnection } = await import("./ssh/connection.ts");
    const conn = new SSHConnection(adminNode);

    try {
      await withSpinner(`Connecting to ${nodeHost}`, () => conn.connect());
      console.log(green(`✓ Connected to ${nodeHost}\n`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`✖ SSH connection failed: ${msg}`));
      return;
    }

    const admin = new GarageAdmin(conn);
    let lastCreatedKeyId = "";
    let lastCreatedKeyName = "";
    let lastAttachedBucket = "";

    // ── UI helpers ────────────────────────────────────────────────────────
    const printAdminHeader = () => {
      let w = 60;
      try { w = Deno.consoleSize().columns; } catch { /* ignore */ }
      const info = `  GARAGE Admin  │  ${nodeHost}:${s3Port}  │  user: ${username}`;
      console.log(bold(cyan("═".repeat(w))));
      console.log(bold(cyan(info)));
      console.log(bold(cyan("═".repeat(w))));
    };
    const pressEnterToContinue = async () => {
      Deno.stdout.writeSync(new TextEncoder().encode(dim("\n  Press Enter to continue…")));
      const buf = new Uint8Array(64);
      await Deno.stdin.read(buf);
    };

    // Clear banner clutter now that we are connected
    console.clear();
    printAdminHeader();

    // ── Menu loop ─────────────────────────────────────────────────────────
    let running = true;
    while (running) {
      console.clear();
      printAdminHeader();
      console.log();
      const category = await Select.prompt({
        message: "Bucket & Key Admin:",
        options: [
          { name: "Buckets",      value: "buckets" },
          { name: "Keys",         value: "keys" },
          { name: "Permissions",  value: "permissions" },
          { name: "Guided flows", value: "guided" },
          { name: "Exit",         value: "exit" },
        ],
      });

      if (category === "exit") { running = false; break; }

      let action = "";

      if (category === "buckets") {
        action = await Select.prompt({
          message: "Buckets:",
          options: [
            { name: "List buckets",   value: "bucket:list" },
            { name: "Create bucket",  value: "bucket:create" },
            { name: "Bucket info",    value: "bucket:info" },
            { name: "Delete bucket",  value: "bucket:delete" },
            { name: "← Back",         value: "back" },
          ],
        });
      } else if (category === "keys") {
        action = await Select.prompt({
          message: "Keys:",
          options: [
            { name: "List keys",    value: "key:list" },
            { name: "Create key",   value: "key:create" },
            { name: "Key info",     value: "key:info" },
            { name: "Delete key",   value: "key:delete" },
            { name: "← Back",        value: "back" },
          ],
        });
      } else if (category === "permissions") {
        action = await Select.prompt({
          message: "Permissions:",
          options: [
            { name: "Grant bucket permissions to key",    value: "perm:allow" },
            { name: "Revoke bucket permissions from key", value: "perm:deny" },
            { name: "← Back",                             value: "back" },
          ],
        });
      } else if (category === "guided") {
        action = await Select.prompt({
          message: "Guided flows:",
          options: [
            { name: "Create object-CRUD user for bucket", value: "guide:crud-user" },
            { name: "← Back",                             value: "back" },
          ],
        });
      }

      if (action === "back" || action === "") continue;

      try {
        // ── Bucket: list ──────────────────────────────────────────────
        if (action === "bucket:list") {
          let out = "";
          await withSpinner("Fetching bucket list", async () => {
            out = await admin.listBuckets();
          });
          console.log("\n" + out);
          await pressEnterToContinue();
        }

        // ── Bucket: create ────────────────────────────────────────────
        else if (action === "bucket:create") {
          const name = await Input.prompt({
            message: "Bucket name:",
            validate: (v: string) => v ? true : "Name is required",
          });
          await withSpinner(`Creating bucket "${name}"`, () => admin.createBucket(name));
          console.log(green(`✓ Bucket "${name}" created`));
        }

        // ── Bucket: info ──────────────────────────────────────────────
        else if (action === "bucket:info") {
          const name = await Input.prompt({
            message: "Bucket name or ID:",
            validate: (v: string) => v ? true : "Name is required",
          });
          let out = "";
          await withSpinner(`Fetching info for "${name}"`, async () => {
            out = await admin.bucketInfo(name);
          });
          console.log("\n" + out);
          await pressEnterToContinue();
        }

        // ── Bucket: delete ────────────────────────────────────────────
        else if (action === "bucket:delete") {
          const name = await Input.prompt({
            message: "Bucket name to delete:",
            validate: (v: string) => v ? true : "Name is required",
          });
          const forceEmpty = await Confirm.prompt({
            message: "Also delete all objects inside the bucket?",
            default: false,
          });
          console.log(yellow(`\n⚠ This will permanently delete bucket "${name}"${forceEmpty ? " and ALL its contents" : ""}.`));
          const confirm = await Confirm.prompt({
            message: `Delete bucket "${name}"?`,
            default: false,
          });
          if (!confirm) { console.log(dim("Cancelled.")); continue; }

          if (forceEmpty) {
            // Create a temporary key, empty via local AWS CLI, then delete bucket + key
            const tmpKeyName = `tmp-delete-${Date.now()}`;
            const endpoint = `http://${nodeHost}:${s3Port}`;
            let tmpKeyId = "";
            try {
              let tmpKey;
              await withSpinner("Creating temporary access key", async () => {
                tmpKey = await admin.createKey(tmpKeyName);
              });
              tmpKeyId = tmpKey!.accessKeyId;
              const tmpSecret = tmpKey!.secretAccessKey;

              await withSpinner(`Granting access to "${name}"`, () =>
                admin.allowBucket(name, tmpKeyId, { read: true, write: true })
              );

              // Write a temp AWS config for path-style addressing
              const tmpDir = `/tmp/garage-admin-${Date.now()}`;
              await Deno.mkdir(tmpDir, { recursive: true });
              await Deno.writeTextFile(`${tmpDir}/config`, `[default]\nregion = garage\ns3 =\n    addressing_style = path\n`);

              await withSpinner(`Emptying bucket "${name}"`, async () => {
                const rmCmd = new Deno.Command("aws", {
                  args: ["s3", "rm", `s3://${name}`, "--recursive", "--endpoint-url", endpoint, "--region", "garage"],
                  env: {
                    AWS_ACCESS_KEY_ID: tmpKeyId,
                    AWS_SECRET_ACCESS_KEY: tmpSecret,
                    AWS_EC2_METADATA_DISABLED: "true",
                    AWS_CONFIG_FILE: `${tmpDir}/config`,
                  },
                  stdout: "piped",
                  stderr: "piped",
                });
                const { success, stderr } = await rmCmd.output();
                if (!success) {
                  const errMsg = new TextDecoder().decode(stderr);
                  throw new Error(`Failed to empty bucket: ${errMsg}`);
                }
              });

              try { await Deno.remove(tmpDir, { recursive: true }); } catch { /* ignore */ }
            } finally {
              if (tmpKeyId) {
                await withSpinner("Removing temporary key", () => admin.deleteKey(tmpKeyId));
              }
            }
          }

          await withSpinner(`Deleting bucket "${name}"`, () => admin.deleteBucket(name));
          console.log(green(`✓ Bucket "${name}" deleted`));
        }

        // ── Key: list ─────────────────────────────────────────────────
        else if (action === "key:list") {
          let out = "";
          await withSpinner("Fetching key list", async () => {
            out = await admin.listKeys();
          });
          console.log("\n" + out);
          await pressEnterToContinue();
        }

        // ── Key: create ───────────────────────────────────────────────
        else if (action === "key:create") {
          const name = await Input.prompt({
            message: "Key name (label):",
            validate: (v: string) => v ? true : "Name is required",
          });
          let created;
          await withSpinner(`Creating key "${name}"`, async () => {
            created = await admin.createKey(name);
          });
          const k = created!;
          lastCreatedKeyId = k.accessKeyId;
          lastCreatedKeyName = name;
          lastAttachedBucket = "";
          let w2 = 60;
          try { w2 = Deno.consoleSize().columns; } catch { /* ignore */ }
          const box = "─".repeat(w2 - 2);
          console.log("\n┌" + box + "┐");
          console.log(bold("│  ⚠  New Access Key – save the secret NOW, it will not be shown again").padEnd(w2 + 9) + "│");
          console.log("│" + " ".repeat(w2 - 2) + "│");
          console.log(("│  Key ID    : " + green(k.accessKeyId)).padEnd(w2 + 9) + "│");
          console.log(("│  Secret    : " + yellow(k.secretAccessKey)).padEnd(w2 + 9) + "│");
          console.log(("│  Can create buckets: " + k.canCreateBuckets).padEnd(w2 - 1) + "│");
          console.log("└" + box + "┘");
          await pressEnterToContinue();
        }

        // ── Key: info ─────────────────────────────────────────────────
        else if (action === "key:info") {
          const keyInfoHint = lastCreatedKeyId
            ? `Key ID is more reliable. Last created key: ${lastCreatedKeyId} (${lastCreatedKeyName || "n/a"})`
            : "Key ID is more reliable — names are not unique";
          const nameOrId = await Input.prompt({
            message: "Key ID (GK…) or name:",
            hint: keyInfoHint,
            default: lastCreatedKeyId || undefined,
            validate: (v: string) => v ? true : "Name or ID is required",
          });
          let out = "";
          await withSpinner(`Fetching key info`, async () => {
            out = await admin.keyInfo(nameOrId);
          });
          console.log("\n" + out);
          const hasAssignedBuckets = /\n(?:R|W|O){1,3}\s+\S+/.test(out);
          if (!hasAssignedBuckets && lastCreatedKeyId && nameOrId !== lastCreatedKeyId) {
            console.log(yellow(`\n⚠ This key has no bucket assignments.`));
            console.log(dim(`  Tip: Your most recently created key is ${lastCreatedKeyId}.`));
            if (lastAttachedBucket) {
              console.log(dim(`  It was last attached to bucket: ${lastAttachedBucket}`));
            }
          }
          await pressEnterToContinue();
        }

        // ── Key: delete ───────────────────────────────────────────────
        else if (action === "key:delete") {
          const nameOrId = await Input.prompt({
            message: "Key name or Key ID to delete:",
            validate: (v: string) => v ? true : "Name or ID is required",
          });
          console.log(yellow(`\n⚠ This will permanently delete key "${nameOrId}".`));
          const confirm = await Confirm.prompt({
            message: `Delete key "${nameOrId}"?`,
            default: false,
          });
          if (!confirm) { console.log(dim("Cancelled.")); continue; }
          await withSpinner(`Deleting key "${nameOrId}"`, () => admin.deleteKey(nameOrId));
          console.log(green(`✓ Key "${nameOrId}" deleted`));
        }

        // ── Permission: allow ─────────────────────────────────────────
        else if (action === "perm:allow") {
          const bucket = await Input.prompt({
            message: "Bucket name:",
            validate: (v: string) => v ? true : "Required",
          });
          const keyId = await Input.prompt({
            message: "Key ID (starts with GK…):",
            validate: (v: string) => v ? true : "Required",
          });
          const read  = await Confirm.prompt({ message: "Grant read?",   default: true  });
          const write = await Confirm.prompt({ message: "Grant write?",  default: true  });
          const owner = await Confirm.prompt({ message: "Grant owner? (create/delete bucket)", default: false });
          if (owner) {
            console.log(yellow("⚠ Owner permission allows the key to delete this bucket."));
            const ownerConfirm = await Confirm.prompt({ message: "Confirm owner permission?", default: false });
            if (!ownerConfirm) { console.log(dim("Owner skipped.")); }
          }
          await withSpinner("Granting permissions", () =>
            admin.allowBucket(bucket, keyId, { read, write, owner })
          );
          console.log(green(`✓ Permissions granted on "${bucket}" to ${keyId}`));
        }

        // ── Permission: deny ──────────────────────────────────────────
        else if (action === "perm:deny") {
          const bucket = await Input.prompt({
            message: "Bucket name:",
            validate: (v: string) => v ? true : "Required",
          });
          const keyId = await Input.prompt({
            message: "Key ID (starts with GK…):",
            validate: (v: string) => v ? true : "Required",
          });
          console.log(yellow(`\n⚠ This will revoke all access for key "${keyId}" on bucket "${bucket}".`));
          const confirm = await Confirm.prompt({ message: "Proceed?", default: false });
          if (!confirm) { console.log(dim("Cancelled.")); continue; }
          await withSpinner("Revoking permissions", () => admin.denyBucket(bucket, keyId));
          console.log(green(`✓ Permissions revoked for ${keyId} on "${bucket}"`))
        }

        // ── Guided: create object-CRUD user for bucket ─────────────────
        else if (action === "guide:crud-user") {
          console.log(bold(cyan("\n=== Create Object-CRUD User ===")));
          console.log(dim("Creates a least-privilege key with read+write on one bucket."));
          console.log(dim("The key will NOT be able to create/delete buckets globally.\n"));

          // Bucket selection
          console.log(dim("Fetching existing buckets..."));
          let bucketList = "";
          try { bucketList = await admin.listBuckets(); } catch { /* ignore */ }
          if (bucketList) console.log("\n" + bucketList);

          const bucketChoice = await Select.prompt({
            message: "Use an existing bucket or create one?",
            options: [
              { name: "Use existing bucket",  value: "existing" },
              { name: "Create a new bucket",  value: "new" },
            ],
          });

          let targetBucket = "";
          if (bucketChoice === "new") {
            targetBucket = await Input.prompt({
              message: "New bucket name:",
              validate: (v: string) => v ? true : "Required",
            });
            await withSpinner(`Creating bucket "${targetBucket}"`, () => admin.createBucket(targetBucket));
            console.log(green(`✓ Bucket "${targetBucket}" created`));
          } else {
            targetBucket = await Input.prompt({
              message: "Bucket name:",
              validate: (v: string) => v ? true : "Required",
            });
          }

          // Key creation
          const keyLabel = await Input.prompt({
            message: "Key label (human-readable name):",
            default: `${targetBucket}-rw-user`,
          });

          let created;
          await withSpinner(`Creating key "${keyLabel}"`, async () => {
            created = await admin.createKey(keyLabel);
          });
          const k = created!;
          lastCreatedKeyId = k.accessKeyId;
          lastCreatedKeyName = keyLabel;

          // Grant read + write only (no owner, no createBucket)
          await withSpinner(`Granting read+write on "${targetBucket}"`, () =>
            admin.allowBucket(targetBucket, k.accessKeyId, { read: true, write: true, owner: false })
          );

          // Verify the grant took effect
          let verifiedInfo = "";
          await withSpinner("Verifying permissions", async () => {
            verifiedInfo = await admin.keyInfo(k.accessKeyId);
          });
          const bucketApplied = verifiedInfo.includes(targetBucket);
          if (bucketApplied) {
            lastAttachedBucket = targetBucket;
          }
          const endpoint = `http://${nodeHost}:${s3Port}`;

          console.log("\n" + "═".repeat(62));
          console.log(bold(green("✓ Object-CRUD user created")));
          console.log("═".repeat(62));
          console.log(bold("\n  Bucket      : ") + cyan(targetBucket));
          console.log(bold("  Key ID      : ") + green(k.accessKeyId));
          console.log(bold("  Secret Key  : ") + yellow(k.secretAccessKey));
          console.log(dim("\n  ⚠ Save the secret key now – it cannot be retrieved again."));
          console.log(dim(`\n  Permissions : read + write (no owner, no createBucket)`));
          console.log(dim(`  Bucket grant verified: ${bucketApplied ? green("✓ yes") : red("✗ no – check bucket name")}`) );
          console.log(dim("  This key can create, read, update and delete objects"));
          console.log(dim("  inside the bucket but cannot manage buckets globally."));
          if (!bucketApplied) {
            console.log(yellow(`\n  ⚠ The bucket "${targetBucket}" did not appear in key info.`));
            console.log(yellow("    Use 'Permissions → Grant' manually with the Key ID above."));
          }

          console.log(bold("\n  AWS CLI quick-start:"));
          console.log(dim(`  aws configure set aws_access_key_id ${k.accessKeyId}`));
          console.log(dim(`  aws configure set aws_secret_access_key ${k.secretAccessKey}`));
          console.log(dim(`  aws configure set default.region garage`));
          console.log(dim(`  aws configure set default.s3.addressing_style path`));
          console.log(dim(`  aws s3 ls s3://${targetBucket}/ --endpoint-url ${endpoint}`));
          console.log(dim(`  # To inspect this exact key later:`));
          console.log(dim(`  # Keys → Key info → ${k.accessKeyId}`));
          console.log("═".repeat(62) + "\n");
          await pressEnterToContinue();
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(red(`\n✖ Operation failed: ${msg}`));
        await logger.error("Admin operation failed", { error: msg });
        await pressEnterToContinue();
      }
    }

    // ── Teardown ──────────────────────────────────────────────────────────
    try { conn.close(); } catch { /* ignore */ }
    await logger.info("=== Bucket & Key Admin Ended ===");
    console.log(dim("\nAdmin session closed."));
  }

  private async runValidationTest(endpoint: string, accessKey: string, secretKey: string, bucketName: string, tempDir: string) {
    console.log(bold(cyan("\n=== Running Validation Test ===")));
    console.log(dim("Testing S3 API from your local machine using AWS CLI...\n"));
    
    try {
      const testFile = "installer-test.html";
      const testContent = "<html><body><h1>Garage Test - Success!</h1></body></html>";
      const localTestPath = `/tmp/${testFile}`;
      const downloadPath = `/tmp/downloaded-${testFile}`;
      
      // Step 1: Create local test file
      await withSpinner("Creating test file", async () => {
        await Deno.writeTextFile(localTestPath, testContent);
      });
      
      // Step 2: Upload test file
      await withSpinner("Uploading test file to S3", async () => {
        const uploadCmd = new Deno.Command("aws", {
          args: [
            "s3", "cp",
            localTestPath,
            `s3://${bucketName}/${testFile}`,
            "--endpoint-url", endpoint,
            "--region", "garage",
          ],
          env: {
            AWS_ACCESS_KEY_ID: accessKey,
            AWS_SECRET_ACCESS_KEY: secretKey,
            AWS_EC2_METADATA_DISABLED: "true",
            AWS_CONFIG_FILE: `${tempDir}/config`,
          },
          stdout: "piped",
          stderr: "piped",
        });
        
        const { success, stderr, stdout: _stdout } = await uploadCmd.output();
        if (!success) {
          const errorMsg = new TextDecoder().decode(stderr);
          console.log(red(`\nAWS CLI Error Details:`));
          console.log(dim(`Command: aws s3 cp ${localTestPath} s3://${bucketName}/${testFile}`));
          console.log(dim(`Endpoint: ${endpoint}`));
          console.log(dim(`Region: garage`));
          console.log(dim(`Access Key: ${accessKey}`));
          console.log(dim(`Error: ${errorMsg}`));
          throw new Error(`Upload failed: ${errorMsg}`);
        }
      });
      
      // Step 3: Download and verify
      await withSpinner("Downloading and verifying file", async () => {
        const downloadCmd = new Deno.Command("aws", {
          args: [
            "--endpoint-url", endpoint,
            "s3", "cp",
            `s3://${bucketName}/${testFile}`,
            downloadPath,
            "--region", "garage",
          ],
          env: {
            AWS_ACCESS_KEY_ID: accessKey,
            AWS_SECRET_ACCESS_KEY: secretKey,
            AWS_EC2_METADATA_DISABLED: "true",
            AWS_CONFIG_FILE: `${tempDir}/config`,
          },
          stdout: "piped",
          stderr: "piped",
        });
        
        const { success, stderr } = await downloadCmd.output();
        if (!success) {
          const errorMsg = new TextDecoder().decode(stderr);
          throw new Error(`Download failed: ${errorMsg}`);
        }
        
        // Verify content
        const downloaded = await Deno.readTextFile(downloadPath);
        if (downloaded !== testContent) {
          throw new Error("Downloaded content doesn't match uploaded content");
        }
      });
      
      // Step 4: Cleanup local files
      await withSpinner("Cleaning up local files", async () => {
        await Deno.remove(localTestPath);
        await Deno.remove(downloadPath);
        
        // Delete test file from S3
        const deleteCmd = new Deno.Command("aws", {
          args: [
            "--endpoint-url", endpoint,
            "s3", "rm",
            `s3://${bucketName}/${testFile}`,
            "--region", "garage",
          ],
          env: {
            AWS_ACCESS_KEY_ID: accessKey,
            AWS_SECRET_ACCESS_KEY: secretKey,
            AWS_EC2_METADATA_DISABLED: "true",
            AWS_CONFIG_FILE: `${tempDir}/config`,
          },
          stdout: "null",
          stderr: "null",
        });
        await deleteCmd.output();
      });
      
      console.log(green(bold("\n✓ All tests passed!")));
      console.log(dim("\n  Test Results:"));
      console.log(dim("  • S3 endpoint accessible: ✓"));
      console.log(dim("  • Authentication working: ✓"));
      console.log(dim("  • File upload: ✓"));
      console.log(dim("  • File download: ✓"));
      console.log(dim("  • Content verification: ✓"));
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.log(red(bold("\n✖ Validation test failed")));
      console.log(yellow("\nPossible issues:"));
      console.log(dim("  • Endpoint not reachable from this machine"));
      console.log(dim("  • Invalid credentials"));
      console.log(dim("  • Bucket doesn't exist or lacks write permissions"));
      console.log(dim("  • Network/firewall blocking access"));
      console.log(dim(`\nError: ${err.message}`));
      throw error;
    }
  }

  private showSuccessMessage() {
    console.log("\n" + "═".repeat(60));
    console.log(bold(green("Your Garage cluster is ready!")));
    console.log("═".repeat(60));
    
    console.log("\n" + bold("S3 API Endpoints:"));
    console.log(`  http://${this.node1!.host}:3900`);
    console.log(`  http://${this.node2!.host}:3900`);
    
    console.log("\n" + bold("Quick Start - Using AWS CLI:"));
    console.log(dim("  # Configure AWS CLI"));
    console.log(dim(`  aws configure set aws_access_key_id <your-key-id>`));
    console.log(dim(`  aws configure set aws_secret_access_key <your-secret-key>`));
    console.log(dim(`  aws configure set default.region garage`));
    console.log(dim(""));
    console.log(dim("  # Create a bucket"));
    console.log(dim(`  aws --endpoint-url http://${this.node1!.host}:3900 s3 mb s3://my-bucket`));
    console.log(dim(""));
    console.log(dim("  # Upload a file"));
    console.log(dim(`  aws --endpoint-url http://${this.node1!.host}:3900 s3 cp file.txt s3://my-bucket/`));
    
    console.log("\n" + bold("Or manage via Garage CLI:"));
    console.log(dim("  # SSH to a node"));
    console.log(dim(`  ssh ${this.node1!.username}@${this.node1!.host}`));
    console.log(dim(""));
    console.log(dim("  # Create bucket and key"));
    console.log(dim(`  docker exec garage /garage bucket create my-bucket`));
    console.log(dim(`  docker exec garage /garage key create my-key`));
    console.log(dim(`  docker exec garage /garage bucket allow my-bucket --read --write --key my-key`));
    console.log(dim(`  docker exec garage /garage key info my-key`));
    
    console.log("\n" + bold("Documentation:"));
    console.log("  https://garagehq.deuxfleurs.fr/documentation/");
    console.log("\n");
  }

  private showAWSCLISetup(endpoint: string) {
    console.log("\n" + "═".repeat(60));
    console.log(bold(cyan("AWS CLI Configuration")));
    console.log("═".repeat(60));
    
    console.log("\n" + bold("Quick Setup:"));
    console.log(dim("\n  1. Configure credentials in ~/.aws/credentials:"));
    console.log(dim("     [default]"));
    console.log(dim("     aws_access_key_id = YOUR_ACCESS_KEY"));
    console.log(dim("     aws_secret_access_key = YOUR_SECRET_KEY"));
    
    console.log(dim("\n  2. Configure endpoint and region in ~/.aws/config:"));
    console.log(dim("     [default]"));
    console.log(dim(`     region = garage`));
    console.log(dim(`     endpoint_url = ${endpoint}`));
    console.log(dim("     "));
    console.log(dim("     [profile default]"));
    console.log(dim("     s3 ="));
    console.log(dim("         addressing_style = path"));
    
    console.log(dim("\n  3. Or use this one-liner to configure path-style:"));
    console.log(dim("     aws configure set default.s3.addressing_style path"));
    
    console.log("\n" + bold("Usage Examples:"));
    console.log(dim("  aws s3 ls                              # List buckets"));
    console.log(dim("  aws s3 mb s3://my-bucket               # Create bucket"));
    console.log(dim("  aws s3 cp file.txt s3://my-bucket/     # Upload file"));
    console.log(dim("  aws s3 sync ./folder s3://my-bucket/   # Sync directory"));
    
    console.log("\n" + bold("📚 Full Guide:"));
    console.log(dim("  See docs/aws-cli-configuration.md for complete setup"));
    console.log(dim("  instructions, troubleshooting, and advanced usage."));
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
    if (!(KNOWN_GOOD_VERSIONS as readonly string[]).includes(version)) {
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
