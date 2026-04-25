import { Confirm, Select, Secret } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { initLogger, getLogger } from "../../logger.ts";
import type { CleanupManager } from "../../cleanup.ts";
import type { StateManager, InstallationState } from "../../state.ts";
import type { ClusterConfig, NodeConfig } from "../types.ts";

export async function runInstallWorkflow(deps: {
  stateManager: StateManager;
  cleanupManager: CleanupManager;
  getNode1: () => NodeConfig | undefined;
  getNode2: () => NodeConfig | undefined;
  getClusterConfig: () => ClusterConfig | undefined;
  setNode1: (node: NodeConfig | undefined) => void;
  setNode2: (node: NodeConfig | undefined) => void;
  setClusterConfig: (config: ClusterConfig | undefined) => void;
  setResumeMode: (resumeMode: boolean) => void;
  collectNodeInfo: () => Promise<void>;
  testConnectivity: () => Promise<void>;
  runPreflightChecks: () => Promise<void>;
  configureCluster: () => Promise<void>;
  showSummary: () => Promise<void>;
  deployCluster: () => Promise<void>;
  postInstall: () => Promise<void>;
  showSuccessMessage: () => void;
  closeConnections: () => Promise<void>;
  resumeInstallation: (state: InstallationState) => Promise<void>;
}): Promise<void> {
  const logger = initLogger();
  console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
  await logger.info("=== Garage Installer Started ===");

  const hasExistingState = await deps.stateManager.exists();
  if (hasExistingState) {
    await deps.stateManager.load();
    const state = deps.stateManager.getState();

    if (state && deps.stateManager.isInProgress()) {
      console.log(yellow("⚠️  Found previous installation in progress"));
      const lastPhase = deps.stateManager.getLastCompletedPhase();
      const nextPhase = deps.stateManager.getNextPendingPhase();

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
        deps.setResumeMode(true);
        await deps.resumeInstallation(state);
        return;
      }

      await deps.stateManager.clear();
    }
  }

  deps.stateManager.initializeState();
  await deps.stateManager.save();

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
    await deps.stateManager.clear();
    return;
  }

  try {
    console.log(bold(cyan("\n=== Phase 1: Node Configuration ===")));
    await logger.info("Phase 1: Node Configuration started");
    deps.stateManager.updatePhase("nodeConfig", "in-progress");
    await deps.stateManager.save();

    await deps.collectNodeInfo();

    deps.stateManager.updatePhase("nodeConfig", "completed");
    deps.stateManager.updateNodes([deps.getNode1()!, deps.getNode2()!]);
    await deps.stateManager.save();

    console.log(bold(cyan("\n=== Phase 2: Testing Connectivity ===")));
    await logger.info("Phase 2: Testing Connectivity started");
    deps.stateManager.updatePhase("connectivity", "in-progress");
    await deps.stateManager.save();

    await deps.testConnectivity();

    deps.stateManager.updatePhase("connectivity", "completed");
    await deps.stateManager.save();

    console.log(bold(cyan("\n=== Phase 3: System Checks ===")));
    await logger.info("Phase 3: System Checks started");
    deps.stateManager.updatePhase("preflightChecks", "in-progress");
    await deps.stateManager.save();

    await deps.runPreflightChecks();

    deps.stateManager.updatePhase("preflightChecks", "completed");
    await deps.stateManager.save();

    console.log(bold(cyan("\n=== Phase 4: Cluster Configuration ===")));
    await logger.info("Phase 4: Cluster Configuration started");
    deps.stateManager.updatePhase("clusterConfig", "in-progress");
    await deps.stateManager.save();

    await deps.configureCluster();

    deps.stateManager.updatePhase("clusterConfig", "completed");
    deps.stateManager.updateCluster(deps.getClusterConfig()!);
    await deps.stateManager.save();

    console.log(bold(cyan("\n=== Phase 5: Deployment Summary ===")));
    await logger.info("Phase 5: Deployment Summary");
    await deps.showSummary();

    console.log(bold(cyan("\n=== Phase 6: Deploying Garage ===")));
    await logger.info("Phase 6: Deploying Garage started");
    deps.stateManager.updatePhase("deployment", "in-progress");
    await deps.stateManager.save();

    await deps.deployCluster();

    deps.stateManager.updatePhase("deployment", "completed");
    await deps.stateManager.save();

    deps.stateManager.updatePhase("configuration", "in-progress");
    await deps.stateManager.save();

    deps.stateManager.updatePhase("configuration", "completed");
    await deps.stateManager.save();

    console.log(bold(cyan("\n=== Phase 7: Finalizing ===")));
    await logger.info("Phase 7: Finalizing started");
    deps.stateManager.updatePhase("postInstall", "in-progress");
    await deps.stateManager.save();

    await deps.postInstall();

    deps.stateManager.updatePhase("postInstall", "completed");
    await deps.stateManager.save();

    console.log(green(bold("\n✓ Installation complete!")));
    await logger.info("Installation completed successfully");
    deps.showSuccessMessage();

    await deps.stateManager.clear();
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    await logger.error("Installation failed", { error: errorMsg, stack: errorStack });
    console.error(red(bold("\n✖ Installation failed:")), errorMsg);
    console.error(dim(`\nFor troubleshooting, check the log file: ${logger.getLogPath()}`));

    const nextPhase = deps.stateManager.getNextPendingPhase();
    if (nextPhase) {
      deps.stateManager.updatePhase(nextPhase, "failed");
      await deps.stateManager.save();
    }

    console.log(yellow("\n💾 Installation state saved. You can resume later by running the installer again."));

    if (deps.cleanupManager.hasDeploymentState()) {
      const shouldCleanup = await Confirm.prompt({
        message: "Would you like to rollback and clean up what was deployed?",
        default: true,
      });

      if (shouldCleanup) {
        await deps.cleanupManager.cleanupAll([deps.getNode1()!, deps.getNode2()!].filter((n) => n));
        await deps.stateManager.clear();
      } else {
        deps.cleanupManager.displayManualCleanupInstructions([deps.getNode1()!, deps.getNode2()!].filter((n) => n));
      }
    }

    throw error;
  } finally {
    await deps.closeConnections();
  }
}

export async function resumeInstallWorkflow(
  deps: {
    stateManager: StateManager;
    getNode1: () => NodeConfig | undefined;
    getNode2: () => NodeConfig | undefined;
    getClusterConfig: () => ClusterConfig | undefined;
    setNode1: (node: NodeConfig | undefined) => void;
    setNode2: (node: NodeConfig | undefined) => void;
    setClusterConfig: (config: ClusterConfig | undefined) => void;
    collectNodeInfo: () => Promise<void>;
    testConnectivity: () => Promise<void>;
    runPreflightChecks: () => Promise<void>;
    configureCluster: () => Promise<void>;
    showSummary: () => Promise<void>;
    deployCluster: () => Promise<void>;
    postInstall: () => Promise<void>;
    showSuccessMessage: () => void;
    closeConnections: () => Promise<void>;
  },
  state: InstallationState,
): Promise<void> {
  const logger = getLogger();
  await logger.info("=== Resuming Garage Installation ===");

  console.log(bold("\nResuming installation from saved state...\n"));

  try {
    if (state.nodes && state.nodes.length >= 2) {
      deps.setNode1({
        ...state.nodes[0],
        connection: undefined,
      });
      deps.setNode2({
        ...state.nodes[1],
        connection: undefined,
      });

      const node1 = deps.getNode1();
      const node2 = deps.getNode2();
      if (node1 && node1.authMethod === "password") {
        const password = await Secret.prompt({
          message: `Password for ${node1.username}@${node1.host}:`,
        });
        node1.password = password;
      }

      if (node2 && node2.authMethod === "password") {
        const password = await Secret.prompt({
          message: `Password for ${node2.username}@${node2.host}:`,
        });
        node2.password = password;
      }
    }

    if (state.cluster) {
      deps.setClusterConfig(state.cluster);
    }

    const nextPhase = deps.stateManager.getNextPendingPhase();

    if (!nextPhase) {
      console.log(green("✓ Installation already complete!"));
      return;
    }

    console.log(yellow(`Resuming from phase: ${bold(nextPhase)}\n`));

    if (nextPhase !== "nodeConfig") {
      console.log("Reconnecting to nodes...");
      await deps.testConnectivity();
    }

    if (nextPhase === "nodeConfig" || state.phases.nodeConfig !== "completed") {
      console.log(bold(cyan("\n=== Phase 1: Node Configuration ===")));
      deps.stateManager.updatePhase("nodeConfig", "in-progress");
      await deps.stateManager.save();
      await deps.collectNodeInfo();
      deps.stateManager.updatePhase("nodeConfig", "completed");
      deps.stateManager.updateNodes([deps.getNode1()!, deps.getNode2()!]);
      await deps.stateManager.save();
    }

    if (nextPhase === "connectivity" || (state.phases.nodeConfig === "completed" && state.phases.connectivity !== "completed")) {
      console.log(bold(cyan("\n=== Phase 2: Testing Connectivity ===")));
      deps.stateManager.updatePhase("connectivity", "in-progress");
      await deps.stateManager.save();
      await deps.testConnectivity();
      deps.stateManager.updatePhase("connectivity", "completed");
      await deps.stateManager.save();
    }

    if (nextPhase === "preflightChecks" || (state.phases.connectivity === "completed" && state.phases.preflightChecks !== "completed")) {
      console.log(bold(cyan("\n=== Phase 3: System Checks ===")));
      deps.stateManager.updatePhase("preflightChecks", "in-progress");
      await deps.stateManager.save();
      await deps.runPreflightChecks();
      deps.stateManager.updatePhase("preflightChecks", "completed");
      await deps.stateManager.save();
    }

    if (nextPhase === "clusterConfig" || (state.phases.preflightChecks === "completed" && state.phases.clusterConfig !== "completed")) {
      console.log(bold(cyan("\n=== Phase 4: Cluster Configuration ===")));
      deps.stateManager.updatePhase("clusterConfig", "in-progress");
      await deps.stateManager.save();
      await deps.configureCluster();
      deps.stateManager.updatePhase("clusterConfig", "completed");
      deps.stateManager.updateCluster(deps.getClusterConfig()!);
      await deps.stateManager.save();
    }

    if (nextPhase === "deployment" || (state.phases.clusterConfig === "completed" && state.phases.deployment !== "completed")) {
      console.log(bold(cyan("\n=== Phase 5: Deployment Summary ===")));
      await deps.showSummary();

      console.log(bold(cyan("\n=== Phase 6: Deploying Garage ===")));
      deps.stateManager.updatePhase("deployment", "in-progress");
      await deps.stateManager.save();
      await deps.deployCluster();
      deps.stateManager.updatePhase("deployment", "completed");
      deps.stateManager.updatePhase("configuration", "completed");
      await deps.stateManager.save();
    }

    if (nextPhase === "postInstall" || (state.phases.deployment === "completed" && state.phases.postInstall !== "completed")) {
      console.log(bold(cyan("\n=== Phase 7: Finalizing ===")));
      deps.stateManager.updatePhase("postInstall", "in-progress");
      await deps.stateManager.save();
      await deps.postInstall();
      deps.stateManager.updatePhase("postInstall", "completed");
      await deps.stateManager.save();
    }

    console.log(green(bold("\n✓ Installation complete!")));
    await logger.info("Installation completed successfully (resumed)");
    deps.showSuccessMessage();

    await deps.stateManager.clear();
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    await logger.error("Installation failed during resume", { error: errorMsg, stack: errorStack });
    console.error(red(bold("\n✖ Installation failed:")), errorMsg);

    const nextPhase = deps.stateManager.getNextPendingPhase();
    if (nextPhase) {
      deps.stateManager.updatePhase(nextPhase, "failed");
      await deps.stateManager.save();
    }

    console.log(yellow("\n💾 Installation state saved. You can resume later by running the installer again."));

    throw error;
  } finally {
    await deps.closeConnections();
  }
}
