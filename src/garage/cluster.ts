import type { NodeConfig, ClusterConfig } from "../wizard.ts";
import { DockerManager } from "../docker/manager.ts";
import type { DisplayManager } from "../ui/display.ts";
import type { CleanupManager } from "../cleanup.ts";
import { green, yellow, dim } from "@std/fmt/colors";
import { withSpinner } from "../ui/spinner.ts";

export class GarageCluster {
  private nodes: NodeConfig[];
  private config: ClusterConfig;
  private cleanupManager?: CleanupManager;

  constructor(nodes: NodeConfig[], config: ClusterConfig, cleanupManager?: CleanupManager) {
    this.nodes = nodes;
    this.config = config;
    this.cleanupManager = cleanupManager;
  }

  async deploy(display: DisplayManager): Promise<void> {
    console.log("\nDeploying Garage to nodes...\n");

    for (const node of this.nodes) {
      await withSpinner(
        `Deploying to ${node.name}`,
        async () => {
          await this.deployNode(node, display);
        }
      );
    }
  }

  private async deployNode(node: NodeConfig, display: DisplayManager): Promise<void> {
    const docker = new DockerManager(node.connection!);
    
    // Detect if we need sudo for docker commands
    await docker.detectSudoRequirement();

    // Step 1: Pull image
    await docker.pullImage(`dxflrs/garage:${this.config.garageVersion}`);

    // Step 2: Stop existing container if any
    await docker.stopContainer("garage");
    await docker.removeContainer("garage");

    // Step 3: Clean up any existing directories and recreate (in case previous install failed with wrong permissions)
    const workdir = this.config.workdir;
    
    // Check if directories exist and remove them (handles both user-owned and potentially root-owned from failed installs)
    await node.connection!.exec(`rm -rf ${workdir} 2>/dev/null || sudo rm -rf ${workdir} 2>/dev/null || true`);
    await node.connection!.exec(`rm -rf ${this.config.dataDir} 2>/dev/null || sudo rm -rf ${this.config.dataDir} 2>/dev/null || true`);
    await node.connection!.exec(`rm -rf ${this.config.metaDir} 2>/dev/null || sudo rm -rf ${this.config.metaDir} 2>/dev/null || true`);
    
    // Create fresh directories as current user
    await node.connection!.exec(`mkdir -p ${workdir}`);
    await node.connection!.exec(`mkdir -p ${this.config.dataDir}`);
    await node.connection!.exec(`mkdir -p ${this.config.metaDir}`);
    
    // Track directory creation for cleanup
    if (this.cleanupManager) {
      this.cleanupManager.markDirectoriesCreated(node.name);
    }

    // Get user ID for non-root execution
    const uidResult = await node.connection!.exec("id -u");
    const gidResult = await node.connection!.exec("id -g");
    const uid = uidResult.stdout.trim();
    const gid = gidResult.stdout.trim();

    // Resolve hostname to IP for rpc_public_addr
    const publicIP = await this.resolveToIP(node.host);
    
    if (publicIP !== node.host) {
      console.log(dim(`  Resolved ${node.host} → ${publicIP}`));
    }

    // Step 4: Generate config
    const garageConfig = this.generateGarageConfig(node, [], publicIP);
    
    // Create workdir as user (no sudo needed since it's in home directory)
    await node.connection!.exec(`mkdir -p ${workdir}`);
    await node.connection!.writeFile(`${workdir}/garage.toml`, garageConfig);
    
    // Track config writing for cleanup
    if (this.cleanupManager) {
      this.cleanupManager.markConfigWritten(node.name);
    }

    // Step 5: Generate docker-compose
    const composeContent = this.generateDockerCompose(node, uid, gid);
    await docker.deployWithCompose(composeContent, workdir);
    
    // Track container deployment for cleanup
    if (this.cleanupManager) {
      this.cleanupManager.markContainerDeployed(node.name, workdir);
    }

    // Step 6: Wait for container to be healthy
    const healthy = await docker.waitForHealthy("garage", 30);
    
    if (!healthy) {
      const logs = await docker.getContainerLogs("garage");
      throw new Error(`Container failed to start. Logs:\n${logs}`);
    }
  }

  private async resolveToIP(hostname: string): Promise<string> {
    // If already an IP address, return as-is
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    
    if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
      return hostname;
    }
    
    // Try to resolve hostname to IP
    try {
      const result = await Deno.resolveDns(hostname, "A");
      if (result && result.length > 0) {
        return result[0];
      }
    } catch {
      // If DNS resolution fails, try IPv6
      try {
        const result = await Deno.resolveDns(hostname, "AAAA");
        if (result && result.length > 0) {
          return `[${result[0]}]`; // IPv6 needs brackets
        }
      } catch {
        // If all fails, return hostname as-is and let it fail with a clear error
        return hostname;
      }
    }
    
    return hostname;
  }

  private generateGarageConfig(node: NodeConfig, bootstrapPeers: string[] = [], publicAddr?: string): string {
    const peersConfig = bootstrapPeers.length > 0
      ? `bootstrap_peers = [\n  "${bootstrapPeers.join('",\n  "')}"\n]`
      : `bootstrap_peers = []`;
    
    // Use the resolved IP address if provided, otherwise fall back to hostname
    const rpcPublicAddr = publicAddr || node.host;
      
    // Use container paths (Docker mounts host paths to these locations)
    return `
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"

db_engine = "lmdb"

replication_factor = ${this.config.replicationFactor}
compression_level = 2

rpc_bind_addr = "[::]:${this.config.ports.rpc}"
rpc_public_addr = "${rpcPublicAddr}:${this.config.ports.rpc}"
rpc_secret = "${this.config.rpcSecret}"

# Bootstrap peers for automatic node discovery on restart
${peersConfig}

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:${this.config.ports.s3Api}"
root_domain = ".s3.garage"

[s3_web]
bind_addr = "[::]:${this.config.ports.s3Web}"
root_domain = ".web.garage"
index = "index.html"

[admin]
api_bind_addr = "[::]:${this.config.ports.admin}"
`.trim();
  }

  private generateDockerCompose(node: NodeConfig, uid: string, gid: string): string {
    return `
services:
  garage:
    image: dxflrs/garage:${this.config.garageVersion}
    container_name: garage
    restart: unless-stopped
    network_mode: host
    user: "${uid}:${gid}"
    volumes:
      - ./garage.toml:/etc/garage.toml:ro
      - ${this.config.metaDir}:/var/lib/garage/meta
      - ${this.config.dataDir}:/var/lib/garage/data
    environment:
      - RUST_LOG=garage=info
    command: ["/garage", "server"]
`.trim();
  }

  async configure(display: DisplayManager): Promise<void> {
    console.log("\nConfiguring cluster...\n");

    // Get node IDs
    const nodeIds = await withSpinner("Retrieving node IDs", async () => {
      return await this.getNodeIds();
    });
    console.log(dim(`  Node 1 ID: ${nodeIds[0].substring(0, 16)}...`));
    console.log(dim(`  Node 2 ID: ${nodeIds[1].substring(0, 16)}...`));

    // Update configs with bootstrap peers now that we have node IDs
    await withSpinner("Updating bootstrap peers", async () => {
      await this.updateBootstrapPeers(nodeIds);
    });

    // Connect nodes
    await withSpinner("Connecting nodes", async () => {
      await this.connectNodes(nodeIds);
      // Wait a bit for nodes to sync
      await new Promise(resolve => setTimeout(resolve, 3000));
    });

    // Configure layout
    await withSpinner("Configuring cluster layout", async () => {
      await this.configureLayout(nodeIds);
    });

    // Wait for layout to apply
    await withSpinner("Applying cluster layout", async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
    });

    // Verify cluster
    await withSpinner("Verifying cluster health", async () => {
      const status = await this.getClusterStatus();
      console.log(dim(`\n${status}`));
    });
  }

  private async getNodeIds(): Promise<string[]> {
    const ids: string[] = [];

    for (const node of this.nodes) {
      const docker = new DockerManager(node.connection!);
      await docker.detectSudoRequirement();
      const result = await docker.execInContainer("garage", "garage node id");
      
      if (result.code !== 0) {
        throw new Error(`Failed to get node ID: ${result.stderr}`);
      }

      // Extract node ID from output (format: "NodeID: <id>")
      // Use case-insensitive regex to match both uppercase and lowercase hex
      const match = result.stdout.match(/([a-f0-9]{64})/i);
      if (!match) {
        throw new Error("Could not parse node ID");
      }

      ids.push(match[1]);
    }

    return ids;
  }

  private async updateBootstrapPeers(nodeIds: string[]): Promise<void> {
    // Resolve node IPs
    const node1IP = await this.resolveToIP(this.nodes[0].host);
    const node2IP = await this.resolveToIP(this.nodes[1].host);
    
    // Build bootstrap peers list
    // Format: "nodeId@host:port"
    const bootstrapPeers = [
      `${nodeIds[0]}@${node1IP}:${this.config.ports.rpc}`,
      `${nodeIds[1]}@${node2IP}:${this.config.ports.rpc}`
    ];

    const workdir = this.config.workdir;

    // Update config on each node
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const publicIP = i === 0 ? node1IP : node2IP;
      const docker = new DockerManager(node.connection!);
      await docker.detectSudoRequirement();

      // Generate new config with bootstrap peers and resolved IP
      const garageConfig = this.generateGarageConfig(node, bootstrapPeers, publicIP);
      
      // Write updated config
      await node.connection!.writeFile(`${workdir}/garage.toml`, garageConfig);
      
      const uidResult = await node.connection!.exec("id -u");
      const gidResult = await node.connection!.exec("id -g");
      const uid = uidResult.stdout.trim();
      const gid = gidResult.stdout.trim();
      await node.connection!.exec(`sudo chown ${uid}:${gid} ${workdir}/garage.toml`);

      // Restart container to pick up new config
      console.log(dim(`  Restarting ${node.name} with updated config...`));
      try {
        await docker.restartContainer("garage");
      } catch (error: any) {
        console.log(yellow(`  Warning: Restart failed (${error.message}), trying stop/start...`));
        await docker.stopContainer("garage");
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Container should auto-restart via docker-compose restart policy
      }
      
      // Wait a moment for restart
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify container is back up
      const healthy = await docker.waitForHealthy("garage", 30);
      if (!healthy) {
        throw new Error(`${node.name} failed to restart after config update`);
      }
    }
  }

  private async connectNodes(nodeIds: string[]): Promise<void> {
    // Connect node1 to node2
    const docker1 = new DockerManager(this.nodes[0].connection!);
    await docker1.detectSudoRequirement();
    const connectCmd = `garage node connect ${nodeIds[1]}@${this.nodes[1].host}:${this.config.ports.rpc}`;
    
    const result = await docker1.execInContainer("garage", connectCmd);
    
    if (result.code !== 0 && !result.stderr.includes("already connected")) {
      throw new Error(`Failed to connect nodes: ${result.stderr}`);
    }
  }

  private async configureLayout(nodeIds: string[]): Promise<void> {
    const docker = new DockerManager(this.nodes[0].connection!);
    await docker.detectSudoRequirement();

    // Assign node1 to zone1
    const assign1Cmd = `garage layout assign -z zone1 -c ${this.config.capacityPerNode} ${nodeIds[0].substring(0, 8)}`;
    const result1 = await docker.execInContainer("garage", assign1Cmd);
    
    if (result1.code !== 0) {
      throw new Error(`Failed to assign node1: ${result1.stderr}`);
    }

    // Assign node2 to zone2
    const assign2Cmd = `garage layout assign -z zone2 -c ${this.config.capacityPerNode} ${nodeIds[1].substring(0, 8)}`;
    const result2 = await docker.execInContainer("garage", assign2Cmd);
    
    if (result2.code !== 0) {
      throw new Error(`Failed to assign node2: ${result2.stderr}`);
    }

    // Get current layout version
    const layoutShowResult = await docker.execInContainer("garage", "garage layout show");
    
    if (layoutShowResult.code !== 0) {
      throw new Error(`Failed to get layout: ${layoutShowResult.stderr}`);
    }

    // Parse version from layout show output
    // Look for "Current cluster layout version: X" or similar
    let layoutVersion = 1; // Default for initial setup
    const versionMatch = layoutShowResult.stdout.match(/version[:\s]+(\d+)/i);
    if (versionMatch) {
      layoutVersion = parseInt(versionMatch[1]) + 1;
    }

    // Apply layout with correct version
    const applyCmd = `garage layout apply --version ${layoutVersion}`;
    const result3 = await docker.execInContainer("garage", applyCmd);
    
    if (result3.code !== 0) {
      throw new Error(`Failed to apply layout: ${result3.stderr}`);
    }
  }

  private async getClusterStatus(): Promise<string> {
    const docker = new DockerManager(this.nodes[0].connection!);
    await docker.detectSudoRequirement();
    const result = await docker.execInContainer("garage", "garage status");
    
    if (result.code !== 0) {
      throw new Error(`Failed to get status: ${result.stderr}`);
    }

    return result.stdout;
  }
}
