#!/usr/bin/env -S deno run --allow-all
/**
 * Garage Cluster Installer
 * 
 * Interactive wizard for deploying a two-node Garage S3-compatible
 * object storage cluster using Docker.
 * 
 * Usage: ./garage-installer
 */

import { Wizard } from "./src/wizard.ts";
import { bold, blue, red } from "@std/fmt/colors";

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
    await wizard.run();
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
