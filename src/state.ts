import type { NodeConfig } from "./wizard.ts";
import type { ClusterConfig } from "./garage/cluster.ts";

export type PhaseStatus = "pending" | "in-progress" | "completed" | "failed";

export interface InstallationState {
  version: string;
  nodes?: Array<{
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: "key" | "password";
    keyPath?: string;
    // Note: password not stored for security
  }>;
  cluster?: {
    garageVersion: string;
    workdir: string;
    dataDir: string;
    metaDir: string;
    replicationFactor: number;
    rpcSecret: string;
    adminToken: string;
    capacityPerNode: string;
    ports: {
      s3Api: number;
      rpc: number;
      s3Web: number;
      admin: number;
    };
  };
  phases: {
    nodeConfig: PhaseStatus;
    connectivity: PhaseStatus;
    preflightChecks: PhaseStatus;
    clusterConfig: PhaseStatus;
    deployment: PhaseStatus;
    configuration: PhaseStatus;
    postInstall: PhaseStatus;
  };
  nodeState: {
    [nodeName: string]: {
      containerDeployed: boolean;
      configWritten: boolean;
      clusterConfigured: boolean;
    };
  };
  lastUpdated: string;
}

export class StateManager {
  private static STATE_FILE = ".garage-installer-state.json";
  private state: InstallationState | null = null;

  constructor() {}

  /**
   * Check if a state file exists
   */
  async exists(): Promise<boolean> {
    try {
      await Deno.stat(StateManager.STATE_FILE);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load state from file
   */
  async load(): Promise<InstallationState | null> {
    try {
      const content = await Deno.readTextFile(StateManager.STATE_FILE);
      this.state = JSON.parse(content);
      return this.state;
    } catch {
      return null;
    }
  }

  /**
   * Initialize a new state
   */
  initializeState(): InstallationState {
    this.state = {
      version: "1.0.0",
      phases: {
        nodeConfig: "pending",
        connectivity: "pending",
        preflightChecks: "pending",
        clusterConfig: "pending",
        deployment: "pending",
        configuration: "pending",
        postInstall: "pending",
      },
      nodeState: {},
      lastUpdated: new Date().toISOString(),
    };
    return this.state;
  }

  /**
   * Get current state
   */
  getState(): InstallationState | null {
    return this.state;
  }

  /**
   * Update node configuration
   */
  updateNodes(nodes: NodeConfig[]): void {
    if (!this.state) return;
    
    this.state.nodes = nodes.map(node => ({
      name: node.name,
      host: node.host,
      port: node.port,
      username: node.username,
      authMethod: node.authMethod,
      keyPath: node.keyPath,
      // Don't store password for security
    }));
    
    // Initialize node state
    for (const node of nodes) {
      if (!this.state.nodeState[node.name]) {
        this.state.nodeState[node.name] = {
          containerDeployed: false,
          configWritten: false,
          clusterConfigured: false,
        };
      }
    }
    
    this.state.lastUpdated = new Date().toISOString();
  }

  /**
   * Update cluster configuration
   */
  updateCluster(cluster: ClusterConfig): void {
    if (!this.state) return;
    
    this.state.cluster = {
      garageVersion: cluster.garageVersion,
      workdir: cluster.workdir,
      dataDir: cluster.dataDir,
      metaDir: cluster.metaDir,
      replicationFactor: cluster.replicationFactor,
      rpcSecret: cluster.rpcSecret,
      adminToken: cluster.adminToken,
      capacityPerNode: cluster.capacityPerNode,
      ports: { ...cluster.ports },
    };
    
    this.state.lastUpdated = new Date().toISOString();
  }

  /**
   * Update phase status
   */
  updatePhase(phase: keyof InstallationState["phases"], status: PhaseStatus): void {
    if (!this.state) return;
    
    this.state.phases[phase] = status;
    this.state.lastUpdated = new Date().toISOString();
  }

  /**
   * Update node deployment state
   */
  updateNodeState(
    nodeName: string,
    updates: Partial<InstallationState["nodeState"][string]>
  ): void {
    if (!this.state) return;
    
    if (!this.state.nodeState[nodeName]) {
      this.state.nodeState[nodeName] = {
        containerDeployed: false,
        configWritten: false,
        clusterConfigured: false,
      };
    }
    
    Object.assign(this.state.nodeState[nodeName], updates);
    this.state.lastUpdated = new Date().toISOString();
  }

  /**
   * Save state to file
   */
  async save(): Promise<void> {
    if (!this.state) return;
    
    this.state.lastUpdated = new Date().toISOString();
    await Deno.writeTextFile(
      StateManager.STATE_FILE,
      JSON.stringify(this.state, null, 2)
    );
  }

  /**
   * Clear state file
   */
  async clear(): Promise<void> {
    try {
      await Deno.remove(StateManager.STATE_FILE);
      this.state = null;
    } catch {
      // File doesn't exist, that's fine
    }
  }

  /**
   * Check if installation is complete
   */
  isComplete(): boolean {
    if (!this.state) return false;
    
    return Object.values(this.state.phases).every(
      status => status === "completed"
    );
  }

  /**
   * Check if installation is in progress
   */
  isInProgress(): boolean {
    if (!this.state) return false;
    
    return Object.values(this.state.phases).some(
      status => status === "completed" || status === "in-progress"
    );
  }

  /**
   * Get the last completed phase
   */
  getLastCompletedPhase(): keyof InstallationState["phases"] | null {
    if (!this.state) return null;
    
    const phases: Array<keyof InstallationState["phases"]> = [
      "nodeConfig",
      "connectivity",
      "preflightChecks",
      "clusterConfig",
      "deployment",
      "configuration",
      "postInstall",
    ];
    
    for (let i = phases.length - 1; i >= 0; i--) {
      if (this.state.phases[phases[i]] === "completed") {
        return phases[i];
      }
    }
    
    return null;
  }

  /**
   * Get the next pending phase
   */
  getNextPendingPhase(): keyof InstallationState["phases"] | null {
    if (!this.state) return null;
    
    const phases: Array<keyof InstallationState["phases"]> = [
      "nodeConfig",
      "connectivity",
      "preflightChecks",
      "clusterConfig",
      "deployment",
      "configuration",
      "postInstall",
    ];
    
    for (const phase of phases) {
      if (this.state.phases[phase] === "pending" || 
          this.state.phases[phase] === "failed" ||
          this.state.phases[phase] === "in-progress") {
        return phase;
      }
    }
    
    return null;
  }
}
