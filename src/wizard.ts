import { Input, Confirm, Number as NumberPrompt, Select } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { SSHConnection } from "./ssh/connection.ts";
import { SystemChecker } from "./checks/system.ts";
import { DockerManager } from "./docker/manager.ts";
import { GarageCluster } from "./garage/cluster.ts";
import { DisplayManager } from "./ui/display.ts";

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
  garageVersion: string;
  replicationFactor: number;
}

export class Wizard {
  private display: DisplayManager;
  private node1?: NodeConfig;
  private node2?: NodeConfig;
  private clusterConfig?: ClusterConfig;

  constructor() {
    this.display = new DisplayManager();
  }

  async run() {
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
      return;
    }

    try {
      // Phase 1: Node Discovery
      console.log(bold(cyan("\n=== Phase 1: Node Configuration ===")));
      await this.collectNodeInfo();

      // Phase 2: SSH Connectivity
      console.log(bold(cyan("\n=== Phase 2: Testing Connectivity ===")));
      await this.testConnectivity();

      // Phase 3: Preflight Checks
      console.log(bold(cyan("\n=== Phase 3: System Checks ===")));
      await this.runPreflightChecks();

      // Phase 4: Cluster Configuration
      console.log(bold(cyan("\n=== Phase 4: Cluster Configuration ===")));
      await this.configureCluster();

      // Phase 5: Deployment Summary
      console.log(bold(cyan("\n=== Phase 5: Deployment Summary ===")));
      await this.showSummary();

      // Phase 6: Deploy
      console.log(bold(cyan("\n=== Phase 6: Deploying Garage ===")));
      await this.deployCluster();

      // Phase 7: Post-Install
      console.log(bold(cyan("\n=== Phase 7: Finalizing ===")));
      await this.postInstall();

      console.log(green(bold("\n✓ Installation complete!")));
      this.showSuccessMessage();

    } catch (error) {
      console.error(red(bold("\n✖ Installation failed:")), error.message);
      console.error(dim("\nFor troubleshooting, check the logs above."));
      throw error;
    } finally {
      // Clean up SSH connections
      await this.cleanup();
    }
  }

  private async collectNodeInfo() {
    // Node 1
    console.log(bold("\nNode 1 Configuration:"));
    
    const host1 = await Input.prompt({
      message: "Hostname or IP address:",
      validate: (value) => {
        if (!value) return "Hostname is required";
        // Basic validation
        if (!/^[\w\-.]+$/.test(value) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) {
          return "Invalid hostname or IP address";
        }
        return true;
      },
    });

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
      keyPath1 = await Input.prompt({
        message: "Path to SSH private key:",
        default: `${Deno.env.get("HOME")}/.ssh/id_rsa`,
      });
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
      const host2 = await Input.prompt({
        message: "Hostname or IP address:",
        validate: (value) => {
          if (!value) return "Hostname is required";
          if (value === host1) return "Node 2 must have different hostname than Node 1";
          return true;
        },
      });

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
      const host2 = await Input.prompt({
        message: "Hostname or IP address:",
      });

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
        keyPath2 = await Input.prompt({
          message: "Path to SSH private key:",
          default: keyPath1,
        });
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
      console.log(`\nTesting connection to ${bold(node.name)} (${node.host})...`);
      
      try {
        const ssh = new SSHConnection(node);
        await ssh.connect();
        await ssh.test();
        node.connection = ssh;
        console.log(green(`✓ Connected to ${node.name}`));
      } catch (error) {
        throw new Error(`Failed to connect to ${node.name}: ${error.message}`);
      }
    }

    console.log(green("\n✓ All nodes reachable"));
  }

  private async runPreflightChecks() {
    const nodes = [this.node1!, this.node2!];

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
        
        for (const failure of failures) {
          if (failure.autoFix) {
            console.log(`  Fixing: ${failure.name}...`);
            await failure.autoFix(node.connection!);
            console.log(green(`  ✓ Fixed: ${failure.name}`));
          } else {
            throw new Error(`Check failed: ${failure.name} - ${failure.message}`);
          }
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

  private async testInterNodeConnectivity(): Promise<boolean> {
    try {
      const result = await this.node1!.connection!.exec(
        `ping -c 1 -W 2 ${this.node2!.host}`
      );
      return result.code === 0;
    } catch {
      return false;
    }
  }

  private async configureCluster() {
    console.log("\nConfiguring cluster parameters...\n");

    const capacity = await Input.prompt({
      message: "Storage capacity per node (e.g., 10G, 100G, 1T):",
      default: "10G",
      validate: (value) => {
        if (!/^\d+[KMGT]$/.test(value)) {
          return "Invalid format. Use: 10G, 100G, 1T, etc.";
        }
        return true;
      },
    });

    const dataDir = await Input.prompt({
      message: "Data directory path:",
      default: "/var/lib/garage/data",
    });

    const metaDir = await Input.prompt({
      message: "Metadata directory path:",
      default: "/var/lib/garage/meta",
    });

    const garageVersion = await Input.prompt({
      message: "Garage version:",
      default: "v2.1.0",
    });

    // Generate RPC secret
    const rpcSecret = this.generateRPCSecret();
    console.log(dim(`\nGenerated RPC secret: ${rpcSecret.substring(0, 16)}...`));

    this.clusterConfig = {
      rpcSecret,
      capacityPerNode: capacity,
      dataDir,
      metaDir,
      garageVersion,
      replicationFactor: 2,
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
      this.clusterConfig!
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

  private async cleanup() {
    // Close SSH connections
    if (this.node1?.connection) {
      await this.node1.connection.close();
    }
    if (this.node2?.connection) {
      await this.node2.connection.close();
    }
  }
}
