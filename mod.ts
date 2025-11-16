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

import { Wizard } from "./src/wizard.ts";
import { bold, blue, red } from "@std/fmt/colors";
import { Select } from "@cliffy/prompt";

const VERSION = "1.0.0";

async function main() {
  // Display banner
  console.clear();
  console.log(bold(blue("╔═══════════════════════════════════════════════════════════╗")));
  console.log(bold(blue("║") + "   " + bold("Garage Cluster Installer") + " v" + VERSION + "                  " + blue("║")));
  console.log(bold(blue("║") + "   S3-Compatible Object Storage for Your Infrastructure   " + blue("║")));
  console.log(bold(blue("╚═══════════════════════════════════════════════════════════╝")));
  console.log();

  try {
    const wizard = new Wizard();
    
    // Check if uninstall mode was requested via command line
    if (Deno.args.includes("uninstall") || Deno.args.includes("remove")) {
      await wizard.runUninstall();
    } else {
      // Ask user what they want to do
      const action = await Select.prompt({
        message: "What would you like to do?",
        options: [
          { name: "Install Garage cluster", value: "install" },
          { name: "Uninstall Garage cluster", value: "uninstall" },
        ],
      });
      
      if (action === "uninstall") {
        await wizard.runUninstall();
      } else {
        await wizard.run();
      }
    }
  } catch (error) {
    console.error(red("\n✖ Fatal error:"), error.message);
    console.error("\nStack trace:", error.stack);
    Deno.exit(1);
  }
}

// Handle Ctrl+C gracefully
Deno.addSignalListener("SIGINT", () => {
  console.log(red("\n\nInstallation cancelled by user."));
  Deno.exit(130);
});

if (import.meta.main) {
  await main();
}
