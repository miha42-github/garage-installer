import { Input, Confirm, Number as NumberPrompt, Select, Secret } from "@cliffy/prompt";
import { green, yellow, red, bold, dim } from "@std/fmt/colors";
import type { NodeConfig } from "../types.ts";
import { testHostResolution } from "../services/endpointChecks.ts";
import { findAvailableSSHKeys, getDefaultSSHUsername } from "../services/sshDefaults.ts";

function isValidHostOrIP(value: string): boolean {
  if (!value) return false;

  const hostnameRegex = /^[\w\-.]+$/;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  const ipv6BracketRegex = /^\[([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\]$/;

  return (
    hostnameRegex.test(value) ||
    ipv4Regex.test(value) ||
    ipv6Regex.test(value) ||
    ipv6BracketRegex.test(value)
  );
}

async function promptHostWithResolutionCheck(
  existingHost?: string
): Promise<string> {
  let host = "";
  let hostValid = false;

  while (!hostValid) {
    host = await Input.prompt({
      message: "Hostname or IP address (IPv4/IPv6 supported):",
      validate: (value) => {
        if (!value) return "Hostname is required";
        if (!isValidHostOrIP(value)) return "Invalid hostname or IP address";
        if (existingHost && value === existingHost) {
          return "Node 2 must have different hostname than Node 1";
        }
        return true;
      },
    });

    console.log(dim(`  Checking if ${host} is reachable...`));
    const resolves = await testHostResolution(host);

    if (!resolves) {
      console.log(yellow(`\n  ⚠ Warning: Cannot resolve hostname "${host}"`));
      console.log(yellow(`    This could mean:`));
      console.log(yellow(`    • Hostname is misspelled`));
      console.log(yellow(`    • Host is defined in /etc/hosts (might still work)`));
      console.log(yellow(`    • Host is currently unreachable\n`));

      const proceed = await Confirm.prompt({
        message: "Try connecting anyway?",
        default: false,
      });

      if (proceed) {
        hostValid = true;
      } else {
        const retry = await Confirm.prompt({
          message: "Re-enter hostname?",
          default: true,
        });
        if (!retry) {
          throw new Error("Hostname validation cancelled");
        }
      }
    } else {
      console.log(green(`  ✓ ${host} is reachable`));
      hostValid = true;
    }
  }

  return host;
}

async function promptSSHKey(defaultKeyPath?: string): Promise<string> {
  const homeDir = Deno.env.get("HOME") || "";
  const availableKeys = await findAvailableSSHKeys(homeDir);
  let keyPath = "";
  let keyValid = false;

  while (!keyValid) {
    if (availableKeys.length > 0) {
      const choices = [...availableKeys, "Other (specify path)"];
      const keyChoice = await Select.prompt({
        message: "Select SSH private key:",
        options: choices,
      });

      if (keyChoice === "Other (specify path)") {
        keyPath = await Input.prompt({
          message: "Path to SSH private key:",
          default: defaultKeyPath ?? `${homeDir}/.ssh/id_rsa`,
        });
      } else {
        keyPath = keyChoice;
      }
    } else {
      keyPath = await Input.prompt({
        message: "Path to SSH private key:",
        default: defaultKeyPath ?? `${homeDir}/.ssh/id_rsa`,
      });
    }

    try {
      const keyData = await Deno.readTextFile(keyPath);
      if (!keyData.includes("PRIVATE KEY")) {
        console.log(
          red(`\n  ✗ Invalid key file: ${keyPath} doesn't appear to be a private key`)
        );
        const retry = await Confirm.prompt({
          message: "Try a different key path?",
          default: true,
        });
        if (!retry) throw new Error("SSH key validation failed");
        continue;
      }
      keyValid = true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.message === "SSH key validation failed") throw error;
      console.log(red(`\n  ✗ Cannot read key file: ${keyPath}`));
      console.log(yellow(`    Error: ${err.message}`));
      const retry = await Confirm.prompt({
        message: "Try a different key path?",
        default: true,
      });
      if (!retry) throw new Error("SSH key validation failed");
    }
  }

  return keyPath;
}

async function promptAuthCredentials(
  defaultKeyPath?: string
): Promise<{ authMethod: "key" | "password"; keyPath?: string; password?: string }> {
  const authMethodRaw = await Select.prompt({
    message: "Authentication method:",
    options: [
      { name: "SSH Key", value: "key" },
      { name: "Password", value: "password" },
    ],
    default: "key",
  });
  const authMethod = authMethodRaw as "key" | "password";

  if (authMethod === "key") {
    const keyPath = await promptSSHKey(defaultKeyPath);
    return { authMethod, keyPath };
  } else {
    const password = await Secret.prompt({ message: "SSH password:" });
    return { authMethod, password };
  }
}

export async function collectNodeInfo(): Promise<{ node1: NodeConfig; node2: NodeConfig }> {
  // ── Node 1 ────────────────────────────────────────────────────────────────
  console.log(bold("\nNode 1 Configuration:"));

  const host1 = await promptHostWithResolutionCheck();

  const port1 = await NumberPrompt.prompt({
    message: "SSH port:",
    default: 22,
    min: 1,
    max: 65535,
  });

  const username1 = await Input.prompt({
    message: "SSH username:",
    default: getDefaultSSHUsername(),
  });

  const { authMethod: authMethod1, keyPath: keyPath1, password: password1 } =
    await promptAuthCredentials();

  const node1: NodeConfig = {
    name: "node1",
    host: host1,
    port: port1,
    username: username1,
    authMethod: authMethod1,
    keyPath: keyPath1,
    password: password1,
  };

  // ── Node 2 ────────────────────────────────────────────────────────────────
  console.log(bold("\nNode 2 Configuration:"));

  const sameCredentials = await Confirm.prompt({
    message: "Use same SSH credentials as Node 1?",
    default: true,
  });

  let node2: NodeConfig;

  if (sameCredentials) {
    const host2 = await promptHostWithResolutionCheck(host1);
    node2 = {
      name: "node2",
      host: host2,
      port: port1,
      username: username1,
      authMethod: authMethod1,
      keyPath: keyPath1,
      password: password1,
    };
  } else {
    const host2 = await promptHostWithResolutionCheck(host1);

    const port2 = await NumberPrompt.prompt({
      message: "SSH port:",
      default: 22,
    });

    const username2 = await Input.prompt({
      message: "SSH username:",
      default: username1,
    });

    const { authMethod: authMethod2, keyPath: keyPath2, password: password2 } =
      await promptAuthCredentials(keyPath1);

    node2 = {
      name: "node2",
      host: host2,
      port: port2,
      username: username2,
      authMethod: authMethod2,
      keyPath: keyPath2,
      password: password2,
    };
  }

  console.log(green("\n✓ Node configuration collected"));
  return { node1, node2 };
}
