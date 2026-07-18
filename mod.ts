#!/usr/bin/env -S deno run --allow-all
/**
 * Garage Cluster Installer
 * 
 * Interactive wizard for deploying a two-node Garage S3-compatible
 * object storage cluster using Docker.
 * 
 * Usage: 
 *   ./garage-installer          # Install Garage cluster
 *   ./garage-installer uninstall  # Uninstall Garage cluster
 */

import { Wizard } from "./src/wizard/index.ts";
import { runTUI } from "./src/tui/main.ts";
import { bold, blue, red, cyan } from "@std/fmt/colors";
import { Select } from "@cliffy/prompt";
import figlet from "npm:figlet@1.7.0";

const VERSION = "1.0.0";

function shouldRunLegacyCLI(): boolean {
  if (Deno.env.get("GARAGE_USE_LEGACY_CLI") === "1") {
    return true;
  }

  if (Deno.args.includes("--legacy-cli")) {
    return true;
  }

  return false;
}

async function runLegacyCLI() {
  // Display banner
  console.clear();

  const banner = figlet.textSync("GARAGE", {
    font: "Standard",
  });

  console.log(cyan(banner));
  console.log(bold(blue("  Cluster Installer v" + VERSION)));
  console.log("  S3-Compatible Object Storage for Your Infrastructure");
  console.log();

  const wizard = new Wizard();

  // Check if uninstall mode was requested via command line
  if (Deno.args.includes("uninstall") || Deno.args.includes("remove")) {
    await wizard.runUninstall();
    return;
  }

  // Ask user what they want to do
  const action = await Select.prompt({
    message: "What would you like to do?",
    options: [
      { name: "Install Garage cluster", value: "install" },
      { name: "Bucket & Key Admin", value: "admin" },
      { name: "Validate existing cluster", value: "validate" },
      { name: "Health report only", value: "health" },
      { name: "Uninstall Garage cluster", value: "uninstall" },
    ],
  });

  if (action === "uninstall") {
    await wizard.runUninstall();
  } else if (action === "validate") {
    await wizard.runValidation();
  } else if (action === "health") {
    await wizard.runHealthReport();
  } else if (action === "admin") {
    await wizard.runBucketAdmin();
  } else {
    await wizard.run();
  }
}

async function main() {
  try {
    if (shouldRunLegacyCLI()) {
      // TUI mode handles its own SIGINT via tui.dispatch(); only register
      // the legacy handler when running the prompt-driven wizard.
      Deno.addSignalListener("SIGINT", () => {
        console.log(red("\n\nInstallation cancelled by user."));
        Deno.exit(130);
      });
      await runLegacyCLI();
    } else {
      await runTUI();
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(red("\n✖ Fatal error:"), err.message);
    console.error("\nStack trace:", err.stack);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
