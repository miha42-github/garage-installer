import { Input, Confirm, Number as NumberPrompt } from "@cliffy/prompt";
import { cyan, yellow, dim, green } from "@std/fmt/colors";
import type { ClusterConfig } from "../types.ts";
import {
  DEFAULT_PORTS,
  DEFAULT_PATHS,
  DEFAULT_GARAGE_VERSION,
  DEFAULT_REPLICATION_FACTOR,
  DEFAULT_CAPACITY,
  KNOWN_GOOD_VERSIONS,
  MINIMUM_VERSION,
} from "../../constants.ts";

function generateRPCSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function validateGarageVersion(version: string): void {
  const compareVersions = (a: string, b: string): number => {
    const aParts = a.replace("v", "").split(".").map(Number);
    const bParts = b.replace("v", "").split(".").map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    return 0;
  };

  if (compareVersions(version, MINIMUM_VERSION) < 0) {
    console.log(
      yellow(
        `\n  ⚠ Warning: Version ${version} is older than the minimum recommended version (${MINIMUM_VERSION}).`
      )
    );
    console.log(
      yellow(
        `    Consider upgrading to ${DEFAULT_GARAGE_VERSION} for better stability and features.`
      )
    );
  }

  if (!(KNOWN_GOOD_VERSIONS as readonly string[]).includes(version)) {
    console.log(
      yellow(
        `\n  ℹ Note: Version ${version} is not in the list of tested versions.`
      )
    );
    console.log(
      yellow(`    Known stable versions: ${KNOWN_GOOD_VERSIONS.join(", ")}`)
    );
    console.log(
      yellow(
        `    This version may work but hasn't been extensively tested with this installer.`
      )
    );
  }
}

export async function configureCluster(): Promise<ClusterConfig> {
  console.log("\nConfiguring cluster parameters...\n");

  const capacity = await Input.prompt({
    message: "Storage capacity per node (e.g., 10G, 100G, 1T):",
    default: DEFAULT_CAPACITY,
    validate: (value: string) => {
      if (!/^\d+[KMGT]$/.test(value)) {
        return "Invalid format. Use: 10G, 100G, 1T, etc.";
      }

      const match = value.match(/^(\d+)([KMGT])$/);
      if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2];

        let capacityGB = amount;
        if (unit === "K") capacityGB = amount / (1024 * 1024);
        else if (unit === "M") capacityGB = amount / 1024;
        else if (unit === "T") capacityGB = amount * 1024;

        if (capacityGB < 1) {
          return "Capacity too small. Minimum 1GB recommended.";
        }
        if (capacityGB > 100000) {
          return "Capacity seems unusually large. Please verify.";
        }

        if (capacityGB < 5) {
          console.log(
            yellow("\n  ⚠ Warning: Small capacity may limit cluster functionality.")
          );
        }
      }

      return true;
    },
  });

  const advancedConfig = await Confirm.prompt({
    message: "Configure advanced settings (ports, paths)?",
    default: false,
  });

  let dataDir: string = DEFAULT_PATHS.dataDir;
  let metaDir: string = DEFAULT_PATHS.metaDir;
  let workdir: string = DEFAULT_PATHS.workdir;
  let garageVersion = DEFAULT_GARAGE_VERSION;
  const ports: { s3Api: number; rpc: number; s3Web: number; admin: number } = {
    ...DEFAULT_PORTS,
  };

  if (advancedConfig) {
    console.log(cyan("\n--- Advanced Configuration ---\n"));

    workdir = await Input.prompt({
      message: "Working directory path:",
      default: DEFAULT_PATHS.workdir,
    });

    dataDir = await Input.prompt({
      message: "Data directory path:",
      default: DEFAULT_PATHS.dataDir,
    });

    metaDir = await Input.prompt({
      message: "Metadata directory path:",
      default: DEFAULT_PATHS.metaDir,
    });

    garageVersion = await Input.prompt({
      message: "Garage version:",
      default: DEFAULT_GARAGE_VERSION,
    });

    validateGarageVersion(garageVersion);

    const customPorts = await Confirm.prompt({
      message: "Customize ports?",
      default: false,
    });

    if (customPorts) {
      ports.s3Api = await NumberPrompt.prompt({
        message: "S3 API port:",
        default: DEFAULT_PORTS.s3Api,
        min: 1,
        max: 65535,
      });

      ports.rpc = await NumberPrompt.prompt({
        message: "RPC port:",
        default: DEFAULT_PORTS.rpc,
        min: 1,
        max: 65535,
      });

      ports.s3Web = await NumberPrompt.prompt({
        message: "S3 Web port:",
        default: DEFAULT_PORTS.s3Web,
        min: 1,
        max: 65535,
      });

      ports.admin = await NumberPrompt.prompt({
        message: "Admin API port:",
        default: DEFAULT_PORTS.admin,
        min: 1,
        max: 65535,
      });
    }
  }

  const rpcSecret = generateRPCSecret();
  const adminToken = generateRPCSecret();
  console.log(dim(`\nGenerated RPC secret: ${rpcSecret.substring(0, 16)}...`));
  console.log(dim(`Generated Admin token: ${adminToken.substring(0, 16)}...`));

  const clusterConfig: ClusterConfig = {
    rpcSecret,
    adminToken,
    capacityPerNode: capacity,
    dataDir,
    metaDir,
    workdir,
    garageVersion,
    replicationFactor: DEFAULT_REPLICATION_FACTOR,
    ports,
  };

  console.log(green("\n✓ Cluster configured"));
  return clusterConfig;
}
