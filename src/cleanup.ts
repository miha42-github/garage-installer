import type { NodeConfig } from "./wizard/types.ts";
import { DockerManager } from "./docker/manager.ts";
import { yellow, red, green, dim } from "@std/fmt/colors";

export interface DeploymentState {
  nodes: Map<string, NodeDeploymentState>;
}

export interface NodeDeploymentState {
  containerDeployed: boolean;
  configWritten: boolean;
  directoriesCreated: boolean;
  workdir?: string;
}

export class CleanupManager {
  private state: DeploymentState;

  constructor() {
    this.state = {
      nodes: new Map(),
    };
  }

  /**
   * Mark that a container was deployed on a node
   */
  markContainerDeployed(nodeName: string, workdir: string): void {
    const nodeState = this.getOrCreateNodeState(nodeName);
    nodeState.containerDeployed = true;
    nodeState.workdir = workdir;
  }

  /**
   * Mark that configuration was written on a node
   */
  markConfigWritten(nodeName: string): void {
    const nodeState = this.getOrCreateNodeState(nodeName);
    nodeState.configWritten = true;
  }

  /**
   * Mark that directories were created on a node
   */
  markDirectoriesCreated(nodeName: string): void {
    const nodeState = this.getOrCreateNodeState(nodeName);
    nodeState.directoriesCreated = true;
  }

  /**
   * Check if any deployment has occurred
   */
  hasDeploymentState(): boolean {
    return this.state.nodes.size > 0;
  }

  /**
   * Clean up all deployed resources on all nodes
   */
  async cleanupAll(nodes: NodeConfig[]): Promise<void> {
    console.log(yellow("\n⚠ Rolling back deployment...\n"));

    for (const node of nodes) {
      const nodeState = this.state.nodes.get(node.name);
      if (!nodeState) {
        console.log(dim(`  ${node.name}: Nothing to clean up`));
        continue;
      }

      console.log(`  Cleaning up ${node.name}...`);
      
      try {
        await this.cleanupNode(node, nodeState);
        console.log(green(`  ✓ ${node.name} cleaned up`));
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(red(`  ✖ Failed to clean up ${node.name}: ${errorMsg}`));
      }
    }
  }

  /**
   * Clean up a single node
   */
  private async cleanupNode(node: NodeConfig, state: NodeDeploymentState): Promise<void> {
    if (!node.connection) {
      console.log(dim(`    Skipping ${node.name}: No connection`));
      return;
    }

    const docker = new DockerManager(node.connection);

    // Stop and remove container
    if (state.containerDeployed) {
      console.log(dim(`    Stopping container...`));
      await docker.stopContainer("garage");
      await docker.removeContainer("garage");
    }

    // Remove docker compose file and workdir
    if (state.workdir) {
      console.log(dim(`    Removing workdir...`));
      await node.connection.exec(`rm -rf ${state.workdir}`);
    }

    // Note: We don't remove data/meta directories as they might contain data
    // User should manually remove them if desired
    console.log(dim(`    Note: Data/metadata directories preserved. Remove manually if needed.`));
  }

  /**
   * Display cleanup instructions for manual cleanup
   */
  displayManualCleanupInstructions(nodes: NodeConfig[]): void {
    console.log(yellow("\n⚠ Manual cleanup may be required\n"));
    console.log("To completely remove Garage from nodes, run these commands:\n");

    for (const node of nodes) {
      const nodeState = this.state.nodes.get(node.name);
      if (!nodeState) continue;

      console.log(`${node.name} (${node.host}):`);
      console.log(dim(`  ssh ${node.username}@${node.host}`));
      console.log(dim(`  docker stop garage && docker rm garage`));
      
      if (nodeState.workdir) {
        console.log(dim(`  rm -rf ${nodeState.workdir}`));
      }
      
      console.log(dim(`  # Optional: Remove data directories (if customized)`));
      console.log();
    }
  }

  private getOrCreateNodeState(nodeName: string): NodeDeploymentState {
    if (!this.state.nodes.has(nodeName)) {
      this.state.nodes.set(nodeName, {
        containerDeployed: false,
        configWritten: false,
        directoriesCreated: false,
      });
    }
    return this.state.nodes.get(nodeName)!;
  }
}
