import { Input, Confirm, Number as NumberPrompt, Secret, Select } from "@cliffy/prompt";
import { green, yellow, red, bold, cyan, dim } from "@std/fmt/colors";
import { initLogger, type Logger } from "../../logger.ts";
import { withSpinner } from "../../ui/spinner.ts";
import { loadGarageClusterConfig } from "../services/configLoader.ts";
import { checkEndpointReachability, commandExists } from "../services/endpointChecks.ts";
import { showAWSCLISetup } from "../output/successMessage.ts";

export interface ValidationPreflightResult {
  s3Reachable: boolean;
  adminReachable: boolean;
  curlAvailable: boolean;
  awsAvailable: boolean;
}

export async function runValidationWorkflow(deps: {
  runValidationTest: (
    endpoint: string,
    accessKey: string,
    secretKey: string,
    bucketName: string,
    tempDir: string,
  ) => Promise<void>;
}): Promise<void> {
  const logger = initLogger();
  console.log(dim(`Logging to: ${logger.getLogPath()}\n`));
  await logger.info("=== Garage Validation Started ===");

  console.log(bold("This will validate an existing Garage installation.\n"));
  console.log(dim("This validation runs completely from your local machine."));
  console.log(dim("Requires AWS CLI to be installed.\n"));

  const tempDir = `/tmp/garage-installer-${Date.now()}`;
  await Deno.mkdir(tempDir, { recursive: true });
  const awsConfigContent = `[default]\nregion = garage\ns3 =\n    addressing_style = path\n`;
  await Deno.writeTextFile(`${tempDir}/config`, awsConfigContent);

  try {
    await withSpinner("Checking for AWS CLI", async () => {
      try {
        const awsCheck = new Deno.Command("which", {
          args: ["aws"],
          stdout: "null",
          stderr: "null",
        });
        const { success } = await awsCheck.output();

        if (!success) {
          throw new Error("AWS CLI not found");
        }
      } catch {
        throw new Error("AWS CLI is required for validation. Install with: brew install awscli");
      }
    });

    const configFile = "garage-cluster-config.json";
    let endpoint = "";
    let adminEndpoint = "";
    let adminToken = "";

    const config = await loadGarageClusterConfig(configFile);
    if (config?.nodes?.[0]?.host) {
      console.log(green(`✓ Found ${configFile}`));

      const s3Port = config.cluster?.ports?.s3Api || 3900;
      const adminPort = config.cluster?.ports?.admin || 3903;
      const nodeHost = config.nodes[0].host;
      endpoint = `http://${nodeHost}:${s3Port}`;
      adminEndpoint = `http://${nodeHost}:${adminPort}`;
      adminToken = config.cluster?.adminToken || "";

      console.log(dim(`  S3 API: ${endpoint}`));
      console.log(dim(`  Admin API: ${adminEndpoint}\n`));

      const useConfig = await Confirm.prompt({
        message: "Use configuration from file?",
        default: true,
      });

      if (!useConfig) {
        endpoint = "";
        adminEndpoint = "";
        adminToken = "";
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

      adminToken = await Secret.prompt({
        message: "Admin API token (RPC secret):",
        validate: (value: string) => {
          if (!value) return "Admin token is required to create credentials";
          return true;
        },
      });
    }

    const preflight = await runValidationPreflightWorkflow(endpoint, adminEndpoint, Boolean(adminToken), logger);

    if (!preflight.s3Reachable) {
      console.log(red("\n✖ S3 API endpoint is not reachable from this machine."));
      const continueDespiteS3Failure = await Confirm.prompt({
        message: "Continue anyway?",
        default: false,
      });

      if (!continueDespiteS3Failure) {
        await logger.warn("Validation cancelled: S3 endpoint unreachable", { endpoint });
        console.log(yellow("Validation cancelled."));
        return;
      }
    }

    console.log(bold(cyan("\n=== Validation Mode ===")));

    if (!adminToken) {
      console.log(yellow("\n⚠ Note: Admin API token not available"));
      console.log(dim("  Cannot automatically create test credentials."));
      console.log(dim("  You'll need to provide existing S3 credentials.\n"));
    } else if (!preflight.adminReachable) {
      console.log(yellow("\n⚠ Note: Admin API endpoint currently unreachable"));
      console.log(dim("  Create-mode may fail until the cluster recovers."));
      console.log(dim("  Existing credentials mode is recommended for now.\n"));
    }

    let mode = await Select.prompt({
      message: "Choose validation mode:",
      options: adminToken
        ? [
            { name: "Create new test credentials (recommended)", value: "create" },
            { name: "Use existing credentials", value: "existing" },
          ]
        : [{ name: "Use existing credentials", value: "existing" }],
      default: adminToken && preflight.adminReachable ? "create" : "existing",
    });

    if (mode === "create" && !preflight.curlAvailable) {
      console.log(yellow("\n⚠ curl is not available, so Admin API create-mode cannot run."));

      const fallbackToExisting = await Confirm.prompt({
        message: "Switch to existing credentials mode?",
        default: true,
      });

      if (!fallbackToExisting) {
        throw new Error("Validation cancelled: curl is required for Admin API create-mode.");
      }

      mode = "existing";
    }

    let accessKey = "";
    let secretKey = "";
    let bucketName = "installer-test-bucket";
    let createdResources = false;

    if (mode === "create") {
      console.log(dim("\nCreating test resources via Admin API...\n"));

      const keyName = `test-key-${Date.now()}`;
      bucketName = `test-bucket-${Date.now()}`;

      try {
        await withSpinner("Creating access key via Admin API", async () => {
          const curlCmd = new Deno.Command("curl", {
            args: [
              "-s",
              "-w",
              "\\nHTTP_CODE:%{http_code}",
              "-X",
              "POST",
              `${adminEndpoint}/v1/key`,
              "-H",
              "Content-Type: application/json",
              "-H",
              `Authorization: Bearer ${adminToken}`,
              "-d",
              JSON.stringify({ name: keyName }),
            ],
            stdout: "piped",
            stderr: "piped",
          });

          const { success, stdout, stderr } = await curlCmd.output();
          const output = new TextDecoder().decode(stdout);
          const errorOutput = new TextDecoder().decode(stderr);

          const httpCodeMatch = output.match(/HTTP_CODE:(\d+)/);
          const httpCode = httpCodeMatch ? parseInt(httpCodeMatch[1]) : 0;
          const responseBody = output.replace(/\nHTTP_CODE:\d+$/, "");

          if (!success || httpCode >= 400 || httpCode === 0) {
            let errorMsg = `HTTP ${httpCode}`;
            if (responseBody) errorMsg += `: ${responseBody}`;
            if (errorOutput) errorMsg += ` (${errorOutput})`;
            if (httpCode === 0) errorMsg = `Cannot connect to Admin API at ${adminEndpoint}. Is the cluster running?`;
            throw new Error(`Failed to create key: ${errorMsg}`);
          }

          try {
            const response = JSON.parse(responseBody);
            accessKey = response.accessKeyId;
            secretKey = response.secretAccessKey;

            if (!accessKey || !secretKey) {
              throw new Error(`API response missing credentials. Got: ${responseBody.substring(0, 100)}`);
            }
          } catch (parseError) {
            const err = parseError instanceof Error ? parseError : new Error(String(parseError));
            throw new Error(`Invalid JSON response from Admin API: ${err.message}. Response: ${responseBody.substring(0, 200)}`);
          }
        });

        console.log(dim(`  Access Key: ${accessKey}`));
        console.log(dim(`  Secret Key: ${secretKey.substring(0, 10)}...\n`));

        await withSpinner("Granting bucket creation permission", async () => {
          const curlCmd = new Deno.Command("curl", {
            args: [
              "-s",
              "-w",
              "\\nHTTP_CODE:%{http_code}",
              "-X",
              "POST",
              `${adminEndpoint}/v1/key?id=${accessKey}`,
              "-H",
              "Content-Type: application/json",
              "-H",
              `Authorization: Bearer ${adminToken}`,
              "-d",
              JSON.stringify({
                allow: {
                  createBucket: true,
                },
              }),
            ],
            stdout: "piped",
            stderr: "piped",
          });

          const { success, stdout, stderr } = await curlCmd.output();
          const output = new TextDecoder().decode(stdout);
          const errorOutput = new TextDecoder().decode(stderr);

          const httpCodeMatch = output.match(/HTTP_CODE:(\d+)/);
          const httpCode = httpCodeMatch ? parseInt(httpCodeMatch[1]) : 0;
          const responseBody = output.replace(/\nHTTP_CODE:\d+$/, "");

          if (!success || httpCode >= 400 || httpCode === 0) {
            let errorMsg = `HTTP ${httpCode}`;
            if (responseBody) errorMsg += `: ${responseBody}`;
            if (errorOutput) errorMsg += ` (${errorOutput})`;
            throw new Error(`Failed to grant permissions: ${errorMsg}`);
          }
        });

        await withSpinner("Creating test bucket", async () => {
          const createBucketCmd = new Deno.Command("aws", {
            args: ["--endpoint-url", endpoint, "s3", "mb", `s3://${bucketName}`, "--region", "garage"],
            env: {
              AWS_ACCESS_KEY_ID: accessKey,
              AWS_SECRET_ACCESS_KEY: secretKey,
              AWS_EC2_METADATA_DISABLED: "true",
              AWS_CONFIG_FILE: `${tempDir}/config`,
            },
            stdout: "piped",
            stderr: "piped",
          });

          const { success, stderr } = await createBucketCmd.output();
          if (!success) {
            const errorMsg = new TextDecoder().decode(stderr);
            if (!errorMsg.includes("BucketAlreadyOwnedByYou")) {
              throw new Error(`Failed to create bucket: ${errorMsg}`);
            }
          }
        });

        createdResources = true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const adminApiUnavailable = err.message.includes("Cannot connect to Admin API") || err.message.includes("HTTP 0");

        if (!adminApiUnavailable) {
          throw error;
        }

        await logger.warn("Admin API unavailable during validation", {
          adminEndpoint,
          error: err.message,
        });

        console.log(yellow(bold("\n⚠ Admin API appears unavailable")));
        console.log(dim(`  Endpoint: ${adminEndpoint}`));
        console.log(dim("  Automatic test credential creation cannot continue."));
        console.log(dim("  You can still validate using existing S3 credentials.\n"));

        const fallbackToExisting = await Confirm.prompt({
          message: "Continue validation with existing S3 credentials instead?",
          default: true,
        });

        if (!fallbackToExisting) {
          throw new Error("Validation cancelled: Admin API is unreachable and no fallback credentials were provided.");
        }

        mode = "existing";
      }
    }

    if (mode === "existing") {
      console.log(bold(cyan("\n=== S3 Credentials ===")));
      console.log(dim("Enter your existing Garage S3 credentials:\n"));

      accessKey = await Input.prompt({
        message: "Access Key ID:",
        validate: (value: string) => {
          if (!value) return "Access key is required";
          return true;
        },
      });

      secretKey = await Secret.prompt({
        message: "Secret Access Key:",
        validate: (value: string) => {
          if (!value) return "Secret key is required";
          return true;
        },
      });

      bucketName = await Input.prompt({
        message: "Test bucket name:",
        default: "installer-test-bucket",
        hint: "Must exist and be writable",
      });
    }

    await deps.runValidationTest(endpoint, accessKey, secretKey, bucketName, tempDir);

    if (createdResources) {
      await withSpinner("Cleaning up test resources", async () => {
        const deleteBucketCmd = new Deno.Command("aws", {
          args: ["--endpoint-url", endpoint, "s3", "rb", `s3://${bucketName}`, "--force", "--region", "garage"],
          env: {
            AWS_ACCESS_KEY_ID: accessKey,
            AWS_SECRET_ACCESS_KEY: secretKey,
            AWS_EC2_METADATA_DISABLED: "true",
            AWS_CONFIG_FILE: `${tempDir}/config`,
          },
          stdout: "null",
          stderr: "null",
        });
        await deleteBucketCmd.output();

        const curlCmd = new Deno.Command("curl", {
          args: ["-s", "-X", "DELETE", `${adminEndpoint}/v1/key?id=${accessKey}`, "-H", `Authorization: Bearer ${adminToken}`],
          stdout: "null",
          stderr: "null",
        });
        await curlCmd.output();
      });
    }

    console.log(green(bold("\n✓ Validation complete!")));
    console.log(dim("\nYour Garage S3 API is accessible and working correctly."));

    showAWSCLISetup(endpoint);

    await logger.info("Validation completed successfully");
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await logger.error("Validation failed", { error: err.message, stack: err.stack });
    console.error(red(bold("\n✖ Validation failed:")), err.message);

    console.log(yellow("\nValidation ended early. See logs for details and retry after recovery."));
    return;
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function runValidationPreflightWorkflow(
  endpoint: string,
  adminEndpoint: string,
  hasAdminToken: boolean,
  logger: Logger,
): Promise<ValidationPreflightResult> {
  console.log(bold(cyan("\n=== Preflight: Basic System Health ===")));

  const awsAvailable = await commandExists("aws");
  const curlAvailable = await commandExists("curl");
  const s3Status = await checkEndpointReachability(endpoint);
  const adminStatus = await checkEndpointReachability(adminEndpoint);

  const statusLabel = (ok: boolean) => ok ? green("✓ OK") : red("✖ DOWN");

  console.log(dim("\nLocal tools:"));
  console.log(`  AWS CLI: ${awsAvailable ? green("✓ OK") : yellow("⚠ MISSING")}`);
  console.log(`  curl: ${curlAvailable ? green("✓ OK") : yellow("⚠ MISSING")}`);

  console.log(dim("\nEndpoints:"));
  console.log(`  S3 API (${endpoint}): ${statusLabel(s3Status.ok)} ${dim(`(${s3Status.detail})`)}`);
  console.log(`  Admin API (${adminEndpoint}): ${statusLabel(adminStatus.ok)} ${dim(`(${adminStatus.detail})`)}`);

  if (!hasAdminToken) {
    console.log(dim("  Admin token: not provided (create-mode unavailable)"));
  }

  const okCount = [s3Status.ok, adminStatus.ok].filter(Boolean).length;
  const summaryColor = okCount === 2 ? green : okCount === 1 ? yellow : red;
  console.log(summaryColor(`\nHealth summary: ${okCount}/2 endpoints reachable\n`));

  await logger.info("Validation preflight health", {
    endpoint,
    adminEndpoint,
    s3Reachable: s3Status.ok,
    s3Detail: s3Status.detail,
    adminReachable: adminStatus.ok,
    adminDetail: adminStatus.detail,
    awsAvailable,
    curlAvailable,
    hasAdminToken,
  });

  return {
    s3Reachable: s3Status.ok,
    adminReachable: adminStatus.ok,
    curlAvailable,
    awsAvailable,
  };
}
