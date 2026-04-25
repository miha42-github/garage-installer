import { Input, Confirm, Select } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { initLogger } from "../../logger.ts";
import { withSpinner } from "../../ui/spinner.ts";
import { GarageAdmin } from "../../garage/admin.ts";
import { SSHConnection } from "../../ssh/connection.ts";
import type { NodeConfig } from "../types.ts";
import { loadGarageClusterConfig } from "../services/configLoader.ts";
import { findFirstAvailableSSHKey, getDefaultSSHUsername } from "../services/sshDefaults.ts";

export async function runBucketAdminWorkflow(): Promise<void> {
  const logger = initLogger();
  console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
  await logger.info("=== Bucket & Key Admin Started ===");

  // ── Load cluster config ──────────────────────────────────────────────
  const configFile = "garage-cluster-config.json";
  let nodeHost = "";
  let s3Port = 3900;
  let foundKey = "";
  let username = getDefaultSSHUsername();

  const cfg = await loadGarageClusterConfig(configFile);
  if (cfg?.nodes?.[0]?.host) {
    nodeHost = cfg.nodes?.[0]?.host || "";
    s3Port = cfg.cluster?.ports?.s3Api ?? 3900;
    console.log(green(`✓ Loaded config from ${configFile}`));
    console.log(dim(`  Admin node : ${nodeHost}`));
    console.log(dim(`  S3 port    : ${s3Port}`));
  } else {
    console.log(yellow("⚠ Could not load garage-cluster-config.json"));
  }

  // Prompt for overrides if config was missing or user wants to change
  if (!nodeHost) {
    nodeHost = await Input.prompt({
      message: "Admin node hostname or IP:",
      validate: (v: string) => v ? true : "Hostname is required",
    });
  } else {
    const override = await Confirm.prompt({
      message: `Use node "${nodeHost}" for admin operations?`,
      default: true,
    });
    if (!override) {
      nodeHost = await Input.prompt({
        message: "Admin node hostname or IP:",
        validate: (v: string) => v ? true : "Hostname is required",
      });
    }
  }

  // Detect SSH key
  const homeDir = Deno.env.get("HOME") || "";
  foundKey = await findFirstAvailableSSHKey(homeDir);

  if (!foundKey) {
    foundKey = await Input.prompt({
      message: "Path to SSH private key:",
      default: `${homeDir}/.ssh/id_rsa`,
    });
  }

  username = await Input.prompt({
    message: "SSH username:",
    default: getDefaultSSHUsername(),
  });

  // ── Connect ──────────────────────────────────────────────────────────
  const adminNode: NodeConfig = {
    name: "admin",
    host: nodeHost,
    port: 22,
    username,
    authMethod: "key",
    keyPath: foundKey,
  };

  const conn = new SSHConnection(adminNode);

  try {
    await withSpinner(`Connecting to ${nodeHost}`, () => conn.connect());
    console.log(green(`✓ Connected to ${nodeHost}\n`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`✖ SSH connection failed: ${msg}`));
    return;
  }

  const admin = new GarageAdmin(conn);
  let lastCreatedKeyId = "";
  let lastCreatedKeyName = "";
  let lastAttachedBucket = "";

  // ── UI helpers ────────────────────────────────────────────────────────
  const printAdminHeader = () => {
    let w = 60;
    try {
      w = Deno.consoleSize().columns;
    } catch {
      // ignore
    }
    const info = `  GARAGE Admin  │  ${nodeHost}:${s3Port}  │  user: ${username}`;
    console.log(bold(cyan("═".repeat(w))));
    console.log(bold(cyan(info)));
    console.log(bold(cyan("═".repeat(w))));
  };
  const pressEnterToContinue = async () => {
    Deno.stdout.writeSync(new TextEncoder().encode(dim("\n  Press Enter to continue…")));
    const buf = new Uint8Array(64);
    await Deno.stdin.read(buf);
  };

  // Clear banner clutter now that we are connected
  console.clear();
  printAdminHeader();

  // ── Menu loop ─────────────────────────────────────────────────────────
  let running = true;
  while (running) {
    console.clear();
    printAdminHeader();
    console.log();
    const category = await Select.prompt({
      message: "Bucket & Key Admin:",
      options: [
        { name: "Buckets", value: "buckets" },
        { name: "Keys", value: "keys" },
        { name: "Permissions", value: "permissions" },
        { name: "Guided flows", value: "guided" },
        { name: "Exit", value: "exit" },
      ],
    });

    if (category === "exit") {
      running = false;
      break;
    }

    let action = "";

    if (category === "buckets") {
      action = await Select.prompt({
        message: "Buckets:",
        options: [
          { name: "List buckets", value: "bucket:list" },
          { name: "Create bucket", value: "bucket:create" },
          { name: "Bucket info", value: "bucket:info" },
          { name: "Delete bucket", value: "bucket:delete" },
          { name: "← Back", value: "back" },
        ],
      });
    } else if (category === "keys") {
      action = await Select.prompt({
        message: "Keys:",
        options: [
          { name: "List keys", value: "key:list" },
          { name: "Create key", value: "key:create" },
          { name: "Key info", value: "key:info" },
          { name: "Delete key", value: "key:delete" },
          { name: "← Back", value: "back" },
        ],
      });
    } else if (category === "permissions") {
      action = await Select.prompt({
        message: "Permissions:",
        options: [
          { name: "Grant bucket permissions to key", value: "perm:allow" },
          { name: "Revoke bucket permissions from key", value: "perm:deny" },
          { name: "← Back", value: "back" },
        ],
      });
    } else if (category === "guided") {
      action = await Select.prompt({
        message: "Guided flows:",
        options: [
          { name: "Create object-CRUD user for bucket", value: "guide:crud-user" },
          { name: "← Back", value: "back" },
        ],
      });
    }

    if (action === "back" || action === "") continue;

    try {
      // ── Bucket: list ──────────────────────────────────────────────
      if (action === "bucket:list") {
        let out = "";
        await withSpinner("Fetching bucket list", async () => {
          out = await admin.listBuckets();
        });
        console.log("\n" + out);
        await pressEnterToContinue();
      }

      // ── Bucket: create ────────────────────────────────────────────
      else if (action === "bucket:create") {
        const name = await Input.prompt({
          message: "Bucket name:",
          validate: (v: string) => v ? true : "Name is required",
        });
        await withSpinner(`Creating bucket "${name}"`, () => admin.createBucket(name));
        console.log(green(`✓ Bucket "${name}" created`));
      }

      // ── Bucket: info ──────────────────────────────────────────────
      else if (action === "bucket:info") {
        const name = await Input.prompt({
          message: "Bucket name or ID:",
          validate: (v: string) => v ? true : "Name is required",
        });
        let out = "";
        await withSpinner(`Fetching info for "${name}"`, async () => {
          out = await admin.bucketInfo(name);
        });
        console.log("\n" + out);
        await pressEnterToContinue();
      }

      // ── Bucket: delete ────────────────────────────────────────────
      else if (action === "bucket:delete") {
        const name = await Input.prompt({
          message: "Bucket name to delete:",
          validate: (v: string) => v ? true : "Name is required",
        });
        const forceEmpty = await Confirm.prompt({
          message: "Also delete all objects inside the bucket?",
          default: false,
        });
        console.log(yellow(`\n⚠ This will permanently delete bucket "${name}"${forceEmpty ? " and ALL its contents" : ""}.`));
        const confirm = await Confirm.prompt({
          message: `Delete bucket "${name}"?`,
          default: false,
        });
        if (!confirm) {
          console.log(dim("Cancelled."));
          continue;
        }

        if (forceEmpty) {
          // Create a temporary key, empty via local AWS CLI, then delete bucket + key
          const tmpKeyName = `tmp-delete-${Date.now()}`;
          const endpoint = `http://${nodeHost}:${s3Port}`;
          let tmpKeyId = "";
          try {
            let tmpKey;
            await withSpinner("Creating temporary access key", async () => {
              tmpKey = await admin.createKey(tmpKeyName);
            });
            tmpKeyId = tmpKey!.accessKeyId;
            const tmpSecret = tmpKey!.secretAccessKey;

            await withSpinner(`Granting access to "${name}"`, () =>
              admin.allowBucket(name, tmpKeyId, { read: true, write: true })
            );

            // Write a temp AWS config for path-style addressing
            const tmpDir = `/tmp/garage-admin-${Date.now()}`;
            await Deno.mkdir(tmpDir, { recursive: true });
            await Deno.writeTextFile(`${tmpDir}/config`, `[default]\nregion = garage\ns3 =\n    addressing_style = path\n`);

            await withSpinner(`Emptying bucket "${name}"`, async () => {
              const rmCmd = new Deno.Command("aws", {
                args: ["s3", "rm", `s3://${name}`, "--recursive", "--endpoint-url", endpoint, "--region", "garage"],
                env: {
                  AWS_ACCESS_KEY_ID: tmpKeyId,
                  AWS_SECRET_ACCESS_KEY: tmpSecret,
                  AWS_EC2_METADATA_DISABLED: "true",
                  AWS_CONFIG_FILE: `${tmpDir}/config`,
                },
                stdout: "piped",
                stderr: "piped",
              });
              const { success, stderr } = await rmCmd.output();
              if (!success) {
                const errMsg = new TextDecoder().decode(stderr);
                throw new Error(`Failed to empty bucket: ${errMsg}`);
              }
            });

            try {
              await Deno.remove(tmpDir, { recursive: true });
            } catch {
              // ignore
            }
          } finally {
            if (tmpKeyId) {
              await withSpinner("Removing temporary key", () => admin.deleteKey(tmpKeyId));
            }
          }
        }

        await withSpinner(`Deleting bucket "${name}"`, () => admin.deleteBucket(name));
        console.log(green(`✓ Bucket "${name}" deleted`));
      }

      // ── Key: list ─────────────────────────────────────────────────
      else if (action === "key:list") {
        let out = "";
        await withSpinner("Fetching key list", async () => {
          out = await admin.listKeys();
        });
        console.log("\n" + out);
        await pressEnterToContinue();
      }

      // ── Key: create ───────────────────────────────────────────────
      else if (action === "key:create") {
        const name = await Input.prompt({
          message: "Key name (label):",
          validate: (v: string) => v ? true : "Name is required",
        });
        let created;
        await withSpinner(`Creating key "${name}"`, async () => {
          created = await admin.createKey(name);
        });
        const k = created!;
        lastCreatedKeyId = k.accessKeyId;
        lastCreatedKeyName = name;
        lastAttachedBucket = "";
        let w2 = 60;
        try {
          w2 = Deno.consoleSize().columns;
        } catch {
          // ignore
        }
        const box = "─".repeat(w2 - 2);
        console.log("\n┌" + box + "┐");
        console.log(bold("│  ⚠  New Access Key – save the secret NOW, it will not be shown again").padEnd(w2 + 9) + "│");
        console.log("│" + " ".repeat(w2 - 2) + "│");
        console.log(("│  Key ID    : " + green(k.accessKeyId)).padEnd(w2 + 9) + "│");
        console.log(("│  Secret    : " + yellow(k.secretAccessKey)).padEnd(w2 + 9) + "│");
        console.log(("│  Can create buckets: " + k.canCreateBuckets).padEnd(w2 - 1) + "│");
        console.log("└" + box + "┘");
        await pressEnterToContinue();
      }

      // ── Key: info ─────────────────────────────────────────────────
      else if (action === "key:info") {
        const keyInfoHint = lastCreatedKeyId
          ? `Key ID is more reliable. Last created key: ${lastCreatedKeyId} (${lastCreatedKeyName || "n/a"})`
          : "Key ID is more reliable — names are not unique";
        const nameOrId = await Input.prompt({
          message: "Key ID (GK…) or name:",
          hint: keyInfoHint,
          default: lastCreatedKeyId || undefined,
          validate: (v: string) => v ? true : "Name or ID is required",
        });
        let out = "";
        await withSpinner(`Fetching key info`, async () => {
          out = await admin.keyInfo(nameOrId);
        });
        console.log("\n" + out);
        const hasAssignedBuckets = /\n(?:R|W|O){1,3}\s+\S+/.test(out);
        if (!hasAssignedBuckets && lastCreatedKeyId && nameOrId !== lastCreatedKeyId) {
          console.log(yellow(`\n⚠ This key has no bucket assignments.`));
          console.log(dim(`  Tip: Your most recently created key is ${lastCreatedKeyId}.`));
          if (lastAttachedBucket) {
            console.log(dim(`  It was last attached to bucket: ${lastAttachedBucket}`));
          }
        }
        await pressEnterToContinue();
      }

      // ── Key: delete ───────────────────────────────────────────────
      else if (action === "key:delete") {
        const nameOrId = await Input.prompt({
          message: "Key name or Key ID to delete:",
          validate: (v: string) => v ? true : "Name or ID is required",
        });
        console.log(yellow(`\n⚠ This will permanently delete key "${nameOrId}".`));
        const confirm = await Confirm.prompt({
          message: `Delete key "${nameOrId}"?`,
          default: false,
        });
        if (!confirm) {
          console.log(dim("Cancelled."));
          continue;
        }
        await withSpinner(`Deleting key "${nameOrId}"`, () => admin.deleteKey(nameOrId));
        console.log(green(`✓ Key "${nameOrId}" deleted`));
      }

      // ── Permission: allow ─────────────────────────────────────────
      else if (action === "perm:allow") {
        const bucket = await Input.prompt({
          message: "Bucket name:",
          validate: (v: string) => v ? true : "Required",
        });
        const keyId = await Input.prompt({
          message: "Key ID (starts with GK…):",
          validate: (v: string) => v ? true : "Required",
        });
        const read = await Confirm.prompt({ message: "Grant read?", default: true });
        const write = await Confirm.prompt({ message: "Grant write?", default: true });
        const owner = await Confirm.prompt({ message: "Grant owner? (create/delete bucket)", default: false });
        if (owner) {
          console.log(yellow("⚠ Owner permission allows the key to delete this bucket."));
          const ownerConfirm = await Confirm.prompt({ message: "Confirm owner permission?", default: false });
          if (!ownerConfirm) {
            console.log(dim("Owner skipped."));
          }
        }
        await withSpinner("Granting permissions", () =>
          admin.allowBucket(bucket, keyId, { read, write, owner })
        );
        console.log(green(`✓ Permissions granted on "${bucket}" to ${keyId}`));
      }

      // ── Permission: deny ──────────────────────────────────────────
      else if (action === "perm:deny") {
        const bucket = await Input.prompt({
          message: "Bucket name:",
          validate: (v: string) => v ? true : "Required",
        });
        const keyId = await Input.prompt({
          message: "Key ID (starts with GK…):",
          validate: (v: string) => v ? true : "Required",
        });
        console.log(yellow(`\n⚠ This will revoke all access for key "${keyId}" on bucket "${bucket}".`));
        const confirm = await Confirm.prompt({ message: "Proceed?", default: false });
        if (!confirm) {
          console.log(dim("Cancelled."));
          continue;
        }
        await withSpinner("Revoking permissions", () => admin.denyBucket(bucket, keyId));
        console.log(green(`✓ Permissions revoked for ${keyId} on "${bucket}"`));
      }

      // ── Guided: create object-CRUD user for bucket ─────────────────
      else if (action === "guide:crud-user") {
        console.log(bold(cyan("\n=== Create Object-CRUD User ===")));
        console.log(dim("Creates a least-privilege key with read+write on one bucket."));
        console.log(dim("The key will NOT be able to create/delete buckets globally.\n"));

        // Bucket selection
        console.log(dim("Fetching existing buckets..."));
        let bucketList = "";
        try {
          bucketList = await admin.listBuckets();
        } catch {
          // ignore
        }
        if (bucketList) console.log("\n" + bucketList);

        const bucketChoice = await Select.prompt({
          message: "Use an existing bucket or create one?",
          options: [
            { name: "Use existing bucket", value: "existing" },
            { name: "Create a new bucket", value: "new" },
          ],
        });

        let targetBucket = "";
        if (bucketChoice === "new") {
          targetBucket = await Input.prompt({
            message: "New bucket name:",
            validate: (v: string) => v ? true : "Required",
          });
          await withSpinner(`Creating bucket "${targetBucket}"`, () => admin.createBucket(targetBucket));
          console.log(green(`✓ Bucket "${targetBucket}" created`));
        } else {
          targetBucket = await Input.prompt({
            message: "Bucket name:",
            validate: (v: string) => v ? true : "Required",
          });
        }

        // Key creation
        const keyLabel = await Input.prompt({
          message: "Key label (human-readable name):",
          default: `${targetBucket}-rw-user`,
        });

        let created;
        await withSpinner(`Creating key "${keyLabel}"`, async () => {
          created = await admin.createKey(keyLabel);
        });
        const k = created!;
        lastCreatedKeyId = k.accessKeyId;
        lastCreatedKeyName = keyLabel;

        // Grant read + write only (no owner, no createBucket)
        await withSpinner(`Granting read+write on "${targetBucket}"`, () =>
          admin.allowBucket(targetBucket, k.accessKeyId, { read: true, write: true, owner: false })
        );

        // Verify the grant took effect
        let verifiedInfo = "";
        await withSpinner("Verifying permissions", async () => {
          verifiedInfo = await admin.keyInfo(k.accessKeyId);
        });
        const bucketApplied = verifiedInfo.includes(targetBucket);
        if (bucketApplied) {
          lastAttachedBucket = targetBucket;
        }
        const endpoint = `http://${nodeHost}:${s3Port}`;

        console.log("\n" + "═".repeat(62));
        console.log(bold(green("✓ Object-CRUD user created")));
        console.log("═".repeat(62));
        console.log(bold("\n  Bucket      : ") + cyan(targetBucket));
        console.log(bold("  Key ID      : ") + green(k.accessKeyId));
        console.log(bold("  Secret Key  : ") + yellow(k.secretAccessKey));
        console.log(dim("\n  ⚠ Save the secret key now – it cannot be retrieved again."));
        console.log(dim(`\n  Permissions : read + write (no owner, no createBucket)`));
        console.log(dim(`  Bucket grant verified: ${bucketApplied ? green("✓ yes") : red("✗ no – check bucket name")}`));
        console.log(dim("  This key can create, read, update and delete objects"));
        console.log(dim("  inside the bucket but cannot manage buckets globally."));
        if (!bucketApplied) {
          console.log(yellow(`\n  ⚠ The bucket "${targetBucket}" did not appear in key info.`));
          console.log(yellow("    Use 'Permissions → Grant' manually with the Key ID above."));
        }

        console.log(bold("\n  AWS CLI quick-start:"));
        console.log(dim(`  aws configure set aws_access_key_id ${k.accessKeyId}`));
        console.log(dim(`  aws configure set aws_secret_access_key ${k.secretAccessKey}`));
        console.log(dim(`  aws configure set default.region garage`));
        console.log(dim(`  aws configure set default.s3.addressing_style path`));
        console.log(dim(`  aws s3 ls s3://${targetBucket}/ --endpoint-url ${endpoint}`));
        console.log(dim(`  # To inspect this exact key later:`));
        console.log(dim(`  # Keys → Key info → ${k.accessKeyId}`));
        console.log("═".repeat(62) + "\n");
        await pressEnterToContinue();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(red(`\n✖ Operation failed: ${msg}`));
      await logger.error("Admin operation failed", { error: msg });
      await pressEnterToContinue();
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────
  try {
    conn.close();
  } catch {
    // ignore
  }
  await logger.info("=== Bucket & Key Admin Ended ===");
  console.log(dim("\nAdmin session closed."));
}
