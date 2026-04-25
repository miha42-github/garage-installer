import { Input, Confirm, Number as NumberPrompt } from "@cliffy/prompt";
import { green, yellow, bold, cyan, dim } from "@std/fmt/colors";
import { initLogger } from "../../logger.ts";
import { loadGarageClusterConfig } from "../services/configLoader.ts";
import { runValidationPreflightWorkflow } from "./validation.ts";

export async function runHealthReportWorkflow(): Promise<void> {
  const logger = initLogger();
  console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
  await logger.info("=== Garage Health Report Started ===");

  console.log(bold("This will run a basic health report for an existing Garage installation.\n"));
  console.log(dim("It checks local tool availability and endpoint reachability from this machine.\n"));

  const configFile = "garage-cluster-config.json";
  let endpoint = "";
  let adminEndpoint = "";
  let hasAdminToken = false;

  const config = await loadGarageClusterConfig(configFile);
  if (config?.nodes?.[0]?.host) {
    console.log(green(`✓ Found ${configFile}`));

    const s3Port = config.cluster?.ports?.s3Api || 3900;
    const adminPort = config.cluster?.ports?.admin || 3903;
    const nodeHost = config.nodes[0].host;
    endpoint = `http://${nodeHost}:${s3Port}`;
    adminEndpoint = `http://${nodeHost}:${adminPort}`;
    hasAdminToken = Boolean(config.cluster?.adminToken);

    console.log(dim(`  S3 API: ${endpoint}`));
    console.log(dim(`  Admin API: ${adminEndpoint}\n`));

    const useConfig = await Confirm.prompt({
      message: "Use configuration from file?",
      default: true,
    });

    if (!useConfig) {
      endpoint = "";
      adminEndpoint = "";
      hasAdminToken = false;
    }
  }

  if (!endpoint) {
    const host = await Input.prompt({
      message: "Garage S3 API hostname or IP:",
      validate: (value: string) => {
        if (!value) return "Hostname is required";
        return true;
      },
    });

    const s3Port = await NumberPrompt.prompt({
      message: "S3 API port:",
      default: 3900,
      min: 1,
      max: 65535,
    });

    const adminPort = await NumberPrompt.prompt({
      message: "Admin API port:",
      default: 3903,
      min: 1,
      max: 65535,
    });

    endpoint = `http://${host}:${s3Port}`;
    adminEndpoint = `http://${host}:${adminPort}`;

    hasAdminToken = await Confirm.prompt({
      message: "Do you have an Admin API token configured?",
      default: false,
    });
  }

  const preflight = await runValidationPreflightWorkflow(
    endpoint,
    adminEndpoint,
    hasAdminToken,
    logger,
  );

  console.log(bold(cyan("=== Health Report Outcome ===")));
  if (preflight.s3Reachable && preflight.adminReachable) {
    console.log(green("✓ Core endpoints look healthy from this machine."));
  } else {
    console.log(yellow("⚠ One or more endpoint checks failed."));
    if (!preflight.s3Reachable) {
      console.log(dim("  • S3 API is unreachable: client operations will fail."));
    }
    if (!preflight.adminReachable) {
      console.log(dim("  • Admin API is unreachable: key/bucket admin automation may fail."));
    }
  }

  await logger.info("Garage health report completed", {
    endpoint,
    adminEndpoint,
    s3Reachable: preflight.s3Reachable,
    adminReachable: preflight.adminReachable,
    curlAvailable: preflight.curlAvailable,
  });
}
