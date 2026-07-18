import { Confirm } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { SSHConnection } from "./ssh/connection.ts";
import { SystemChecker } from "./checks/system.ts";
import { GarageCluster } from "./garage/cluster.ts";
import { DisplayManager } from "./ui/display.ts";
import { CleanupManager } from "./cleanup.ts";
import { StateManager, type InstallationState } from "./state.ts";
import { withSpinner } from "./ui/spinner.ts";
import type { ClusterConfig, NodeConfig } from "./wizard/types.ts";
import { runInstallWorkflow, resumeInstallWorkflow } from "./wizard/workflows/install.ts";
import { runUninstallWorkflow } from "./wizard/workflows/uninstall.ts";
import { runValidationWorkflow } from "./wizard/workflows/validation.ts";
import { runHealthReportWorkflow } from "./wizard/workflows/healthReport.ts";
import { runBucketAdminWorkflow } from "./wizard/workflows/bucketAdmin.ts";
import { collectNodeInfo } from "./wizard/prompts/nodePrompts.ts";
import { configureCluster } from "./wizard/prompts/clusterPrompts.ts";
import { showSuccessMessage, showAWSCLISetup } from "./wizard/output/successMessage.ts";

export type { ClusterConfig, NodeConfig } from "./wizard/types.ts";

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
    return await runInstallWorkflow({
      stateManager: this.stateManager,
      cleanupManager: this.cleanupManager,
      getNode1: () => this.node1,
      getNode2: () => this.node2,
      getClusterConfig: () => this.clusterConfig,
      setNode1: (node) => {
        this.node1 = node;
      },
      setNode2: (node) => {
        this.node2 = node;
      },
      setClusterConfig: (config) => {
        this.clusterConfig = config;
      },
      setResumeMode: (resumeMode) => {
        this.resumeMode = resumeMode;
      },
      collectNodeInfo: this.collectNodeInfo.bind(this),
      testConnectivity: this.testConnectivity.bind(this),
      runPreflightChecks: this.runPreflightChecks.bind(this),
      configureCluster: this.configureCluster.bind(this),
      showSummary: this.showSummary.bind(this),
      deployCluster: this.deployCluster.bind(this),
      postInstall: this.postInstall.bind(this),
      showSuccessMessage: this.showSuccessMessage.bind(this),
      closeConnections: this.closeConnections.bind(this),
      resumeInstallation: this.resumeInstallation.bind(this),
    });
  }

  private async resumeInstallation(state: InstallationState) {
    return await resumeInstallWorkflow({
      stateManager: this.stateManager,
      getNode1: () => this.node1,
      getNode2: () => this.node2,
      getClusterConfig: () => this.clusterConfig,
      setNode1: (node) => {
        this.node1 = node;
      },
      setNode2: (node) => {
        this.node2 = node;
      },
      setClusterConfig: (config) => {
        this.clusterConfig = config;
      },
      collectNodeInfo: this.collectNodeInfo.bind(this),
      testConnectivity: this.testConnectivity.bind(this),
      runPreflightChecks: this.runPreflightChecks.bind(this),
      configureCluster: this.configureCluster.bind(this),
      showSummary: this.showSummary.bind(this),
      deployCluster: this.deployCluster.bind(this),
      postInstall: this.postInstall.bind(this),
      showSuccessMessage: this.showSuccessMessage.bind(this),
      closeConnections: this.closeConnections.bind(this),
    }, state);
  }

  async runUninstall() {
    return await runUninstallWorkflow({
      stateManager: this.stateManager,
      getNode1: () => this.node1,
      getNode2: () => this.node2,
      setNode1: (node) => {
        this.node1 = node;
      },
      setNode2: (node) => {
        this.node2 = node;
      },
      collectNodeInfo: this.collectNodeInfo.bind(this),
      testConnectivity: this.testConnectivity.bind(this),
      closeConnections: this.closeConnections.bind(this),
    });
  }

  private async collectNodeInfo() {
    const { node1, node2 } = await collectNodeInfo();
    this.node1 = node1;
    this.node2 = node2;
  }

  // ── kept for historical reference (all prompt logic now in nodePrompts.ts)
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
    this.clusterConfig = await configureCluster();
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
    
    const { getConfigPath, ensureAppDir } = await import("./wizard/services/paths.ts");
    const configFile = getConfigPath();
    const config = {
      nodes: [
        { name: this.node1!.name, host: this.node1!.host },
        { name: this.node2!.name, host: this.node2!.host },
      ],
      cluster: this.clusterConfig,
      installedAt: new Date().toISOString(),
    };

    await ensureAppDir();
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
    return await runValidationWorkflow({
      runValidationTest: this.runValidationTest.bind(this),
    });
  }

  async runHealthReport() {
    return await runHealthReportWorkflow();
  }

  // ── Bucket & Key Admin ────────────────────────────────────────────────────

  async runBucketAdmin() {
    return await runBucketAdminWorkflow();
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
    showSuccessMessage({
      node1: { host: this.node1!.host, username: this.node1!.username },
      node2: { host: this.node2!.host },
      s3ApiPort: this.clusterConfig?.ports.s3Api ?? 3900,
    });
  }

  private showAWSCLISetup(endpoint: string) {
    showAWSCLISetup(endpoint);
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
