import { Confirm, Secret } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { initLogger } from "../../logger.ts";
import { DockerManager } from "../../docker/manager.ts";
import type { NodeConfig } from "../types.ts";
import { loadGarageClusterConfig } from "../services/configLoader.ts";
import { findFirstAvailableSSHKey, getDefaultSSHUsername } from "../services/sshDefaults.ts";
import type { StateManager } from "../../state.ts";

export async function runUninstallWorkflow(deps: {
  stateManager: StateManager;
  getNode1: () => NodeConfig | undefined;
  getNode2: () => NodeConfig | undefined;
  setNode1: (node: NodeConfig | undefined) => void;
  setNode2: (node: NodeConfig | undefined) => void;
  collectNodeInfo: () => Promise<void>;
  testConnectivity: () => Promise<void>;
  closeConnections: () => Promise<void>;
}): Promise<void> {
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
    let usesSavedConfig = false;

    const config = await loadGarageClusterConfig();
    if (config?.nodes && config.nodes.length === 2) {
      const configNode1 = config.nodes[0]!;
      const configNode2 = config.nodes[1]!;
      console.log(green(`✓ Loaded cluster config`));
      console.log(`  • ${configNode1.name} (${configNode1.host})`);
      console.log(`  • ${configNode2.name} (${configNode2.host})\n`);

      const useSaved = await Confirm.prompt({
        message: "Use these nodes for uninstall?",
        default: true,
      });

      if (useSaved) {
        const foundKey = await findFirstAvailableSSHKey();

        if (!foundKey) {
          console.log(yellow("\n⚠ No SSH key found in ~/.ssh/"));
          console.log(dim("Please enter SSH credentials manually.\n"));
        } else {
          deps.setNode1({
            name: configNode1.name,
            host: configNode1.host,
            port: 22,
            username: getDefaultSSHUsername(),
            authMethod: "key",
            keyPath: foundKey,
          });

          deps.setNode2({
            name: configNode2.name,
            host: configNode2.host,
            port: 22,
            username: getDefaultSSHUsername(),
            authMethod: "key",
            keyPath: foundKey,
          });

          const keyName = foundKey.split("/").pop();
          console.log(bold(cyan("\n=== Connecting to Nodes ===")));
          console.log(dim(`Using default SSH settings (port 22, current user, ~/.ssh/${keyName})\n`));

          await deps.testConnectivity();
          usesSavedConfig = true;
        }
      }
    }

    if (!usesSavedConfig && await deps.stateManager.exists()) {
      await deps.stateManager.load();
      const state = deps.stateManager.getState();

      if (state && state.nodes && state.nodes.length === 2) {
        console.log(green("✓ Found saved installation state"));
        console.log(`  • ${state.nodes[0].name} (${state.nodes[0].host})`);
        console.log(`  • ${state.nodes[1].name} (${state.nodes[1].host})\n`);

        const useSaved = await Confirm.prompt({
          message: "Use these nodes for uninstall?",
          default: true,
        });

        if (useSaved) {
          const node1 = { ...state.nodes[0] as NodeConfig };
          const node2 = { ...state.nodes[1] as NodeConfig };
          deps.setNode1(node1);
          deps.setNode2(node2);

          console.log(bold(cyan("\n=== Connecting to Nodes ===")));

          node1.password = await Secret.prompt({
            message: `Password for ${node1.name} (${node1.username}@${node1.host}):`,
          });

          node2.password = await Secret.prompt({
            message: `Password for ${node2.name} (${node2.username}@${node2.host}):`,
          });

          await deps.testConnectivity();
          usesSavedConfig = true;
        }
      }
    }

    if (!usesSavedConfig) {
      console.log(bold(cyan("\n=== Connecting to Nodes ===")));
      await deps.collectNodeInfo();
      await deps.testConnectivity();
    }

    const node1 = deps.getNode1()!;
    const node2 = deps.getNode2()!;

    console.log(yellow("\nYou are about to uninstall Garage from:"));
    console.log(`  • ${node1.name} (${node1.host})`);
    console.log(`  • ${node2.name} (${node2.host})`);

    const finalConfirm = await Confirm.prompt({
      message: "Proceed with uninstallation?",
      default: false,
    });

    if (!finalConfirm) {
      console.log("Uninstall cancelled.");
      return;
    }

    const removeData = await Confirm.prompt({
      message: "Also remove data directories (this will delete all stored data)?",
      default: false,
    });

    console.log(bold(cyan("\n=== Uninstalling Garage ===")));
    await logger.info("Starting uninstall process");

    for (const node of [node1, node2]) {
      console.log(`\nUninstalling from ${bold(node.name)}...`);

      const docker = new DockerManager(node.connection!);

      console.log(dim("  Stopping container..."));
      await docker.stopContainer("garage");
      await docker.removeContainer("garage");
      console.log(green("  ✓ Container removed"));

      const workdirResult = await node.connection!.exec("ls -d ~/garage 2>/dev/null || echo ''");
      const workdir = workdirResult.stdout.trim();

      if (workdir) {
        console.log(dim("  Removing configuration..."));
        await node.connection!.exec(`rm -rf ${workdir}`);
        console.log(green("  ✓ Configuration removed"));
      }

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
    await deps.closeConnections();
  }
}
