import type { CleanupManager } from "../cleanup.ts";
import type { DisplayManager } from "../ui/display.ts";
import type { Logger } from "../logger.ts";
import type { StateManager } from "../state.ts";
import type { ClusterConfig, NodeConfig } from "./types.ts";

export interface WizardContext {
  display: DisplayManager;
  cleanupManager: CleanupManager;
  stateManager: StateManager;
  logger: Logger;
  node1?: NodeConfig;
  node2?: NodeConfig;
  clusterConfig?: ClusterConfig;
  resumeMode: boolean;
}
