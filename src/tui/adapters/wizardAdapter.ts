import { checkEndpointReachability, commandExists } from "../../wizard/services/endpointChecks.ts";
import { loadGarageClusterConfig } from "../../wizard/services/configLoader.ts";

export type HealthStatus = "ok" | "warn" | "down";

export type ProbeHealth = {
  status: HealthStatus;
  summary: string;
};

export type NodeHealth = {
  title: string;
  host: string;
  role: string;
  zone: string;
  statusLabel: string;
  s3: ProbeHealth;
  admin: ProbeHealth;
  ping: ProbeHealth;
  ssh: ProbeHealth;
  status: HealthStatus;
};

export type MetricHealth = {
  title: string;
  value: string;
  detail: string;
  status: HealthStatus;
};

export type HealthSnapshot = {
  refreshedAt: string;
  nodes: NodeHealth[];
  metrics: MetricHealth[];
};

type ReachabilityFn = (url: string) => Promise<{ ok: boolean; detail: string }>;
type HostProbeFn = (host: string) => Promise<ProbeHealth>;
type CommandExistsFn = (command: string) => Promise<boolean>;

export type GarageHealthResult = {
  reachable: boolean;
  healthy: boolean;
  storageNodes: number;
  storageNodesOk: number;
};

type StorageProbeFn = (host: string, adminPort: number) => Promise<GarageHealthResult>;

type AdapterOptions = {
  configFile?: string;
  checkEndpoint?: ReachabilityFn;
  checkPing?: HostProbeFn;
  checkSSH?: HostProbeFn;
  checkCommandExists?: CommandExistsFn;
  checkGarageHealth?: StorageProbeFn;
};

export type StepDef = {
  label: string;
  run: () => Promise<string | void>;
};

export type PollingController = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

function nodeRole(index: number): string {
  return index === 0 ? "Primary" : "Secondary";
}

function nodeZone(index: number): string {
  return index === 0 ? "dc1" : "dc1";
}

function compactDetail(detail: string): string {
  return detail
    .replace(/error sending request for url\s*\([^)]*\):\s*/i, "")
    .replace(/client error \([^)]*\)\s*/i, "")
    .replace(/: tcp connect error:/i, "")
    .replace(/tcp connect error:/i, "")
    .replace(/dns error:\s*/i, "dns ")
    .replace(/connection refused/i, "conn refused")
    .replace(/Connection refused/i, "conn refused")
    .replace(/No route to host/i, "no route")
    .replace(/operation timed out/i, "timeout")
    .replace(/Connection timed out/i, "timeout")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22) || "unavailable";
}

function endpointProbe(ok: boolean, detail: string): ProbeHealth {
  return {
    status: ok ? "ok" : "down",
    summary: `${ok ? "OK" : "DOWN"} ${compactDetail(detail)}`,
  };
}

async function runCommandProbe(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(4000),
  }).output();

  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout).trim(),
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

export async function checkPingProbe(host: string): Promise<ProbeHealth> {
  try {
    const result = await runCommandProbe("ping", ["-c", "1", host]);
    if (result.code === 0) {
      return { status: "ok", summary: "OK echo reply" };
    }

    return { status: "down", summary: `DOWN ${compactDetail(result.stderr || result.stdout)}` };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { status: "down", summary: `DOWN ${compactDetail(err.message)}` };
  }
}

export async function checkSSHProbe(host: string): Promise<ProbeHealth> {
  try {
    const result = await runCommandProbe("ssh", [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=3",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      host,
      "true",
    ]);

    if (result.code === 0) {
      return { status: "ok", summary: "OK cli auth" };
    }

    const text = result.stderr || result.stdout;
    if (/Permission denied/i.test(text)) {
      return { status: "warn", summary: "WARN auth denied" };
    }

    return { status: "down", summary: `DOWN ${compactDetail(text)}` };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { status: "down", summary: `DOWN ${compactDetail(err.message)}` };
  }
}

export async function checkGarageHealthEndpoint(host: string, adminPort: number): Promise<GarageHealthResult> {
  const url = `http://${host}:${adminPort}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      return {
        reachable: true,
        healthy: data.status === "healthy",
        storageNodes: typeof data.storage_nodes === "number" ? data.storage_nodes : 0,
        storageNodesOk: typeof data.storage_nodes_ok === "number" ? data.storage_nodes_ok : 0,
      };
    } catch {
      return { reachable: true, healthy: response.ok, storageNodes: 0, storageNodesOk: 0 };
    }
  } catch {
    return { reachable: false, healthy: false, storageNodes: 0, storageNodesOk: 0 };
  }
}

function summarizeNodeStatus(probes: ProbeHealth[]): { status: HealthStatus; label: string } {
  const hasDownHost = probes[2].status === "down" && probes[3].status === "down";
  const allOk = probes.every((probe) => probe.status === "ok");

  if (allOk) {
    return { status: "ok", label: "OK" };
  }

  if (hasDownHost) {
    return { status: "down", label: "DOWN" };
  }

  return { status: "warn", label: "WARN" };
}

function metricStatus(ok: number, total: number): HealthStatus {
  if (ok === total) return "ok";
  if (ok === 0) return "down";
  return "warn";
}

export async function collectHealthSnapshot(options: AdapterOptions = {}): Promise<HealthSnapshot> {
  const checkEndpoint = options.checkEndpoint ?? checkEndpointReachability;
  const checkPing = options.checkPing ?? checkPingProbe;
  const checkSSH = options.checkSSH ?? checkSSHProbe;
  const checkCommand = options.checkCommandExists ?? commandExists;
  const checkGarageHealth = options.checkGarageHealth ?? checkGarageHealthEndpoint;

  const config = await loadGarageClusterConfig(options.configFile);
  const nodes = config?.nodes ?? [];

  const s3Port = config?.cluster?.ports?.s3Api ?? 3900;
  const adminPort = config?.cluster?.ports?.admin ?? 3903;
  const replicationFactor = config?.cluster?.replicationFactor ?? 2;

  const nodeHealth = await Promise.all(nodes.slice(0, 2).map(async (node, index) => {
    const s3Url = `http://${node.host}:${s3Port}`;
    const adminUrl = `http://${node.host}:${adminPort}`;

    const [s3, admin, ping, ssh] = await Promise.all([
      checkEndpoint(s3Url),
      checkEndpoint(adminUrl),
      checkPing(node.host),
      checkSSH(node.host),
    ]);

    const s3Probe = endpointProbe(s3.ok, s3.detail);
    const adminProbe = endpointProbe(admin.ok, admin.detail);
    const summary = summarizeNodeStatus([s3Probe, adminProbe, ping, ssh]);

    return {
      title: node.name.toUpperCase(),
      host: node.host,
      role: nodeRole(index),
      zone: nodeZone(index),
      statusLabel: summary.label,
      s3: s3Probe,
      admin: adminProbe,
      ping,
      ssh,
      status: summary.status,
    } as NodeHealth;
  }));

  while (nodeHealth.length < 2) {
    nodeHealth.push({
      title: `NODE ${nodeHealth.length}`,
      host: "n/a",
      role: nodeRole(nodeHealth.length),
      zone: nodeZone(nodeHealth.length),
      statusLabel: "WARN",
      s3: { status: "warn", summary: "WARN no config" },
      admin: { status: "warn", summary: "WARN no config" },
      ping: { status: "warn", summary: "WARN no config" },
      ssh: { status: "warn", summary: "WARN no config" },
      status: "warn",
    });
  }

  const reachableNodes = nodeHealth.filter((node) => node.status === "ok").length;
  const degradedNodes = nodeHealth.filter((node) => node.status !== "ok").length;

  const [[curlAvailable, awsAvailable], garageHealth] = await Promise.all([
    Promise.all([checkCommand("curl"), checkCommand("aws")]),
    (async (): Promise<GarageHealthResult> => {
      for (const node of nodes.slice(0, 2)) {
        const result = await checkGarageHealth(node.host, adminPort);
        if (result.reachable) return result;
      }
      return { reachable: false, healthy: false, storageNodes: 0, storageNodesOk: 0 };
    })(),
  ]);

  let storageValue: string;
  let storageDetail: string;
  let storageStatus: HealthStatus;

  if (!garageHealth.reachable) {
    storageValue = "NOT PROBED";
    storageDetail = "admin API unreachable";
    storageStatus = "warn";
  } else if (garageHealth.storageNodes > 0) {
    const sOk = garageHealth.storageNodesOk;
    const sTotal = garageHealth.storageNodes;
    storageValue = `${sOk}/${sTotal} NODES OK`;
    storageDetail = garageHealth.healthy ? "all partitions ok" : "partitions degraded";
    storageStatus = metricStatus(sOk, sTotal);
  } else {
    storageValue = garageHealth.healthy ? "HEALTHY" : "DEGRADED";
    storageDetail = "garage /health ok";
    storageStatus = garageHealth.healthy ? "ok" : "warn";
  }

  const metrics: MetricHealth[] = [
    {
      title: "CLUSTER",
      value: `${reachableNodes}/${nodeHealth.length} HEALTHY`,
      detail: degradedNodes ? `${degradedNodes} node(s) degraded` : "all nodes reachable",
      status: metricStatus(reachableNodes, nodeHealth.length),
    },
    {
      title: "REPLICATION",
      value: `${replicationFactor}x TARGET`,
      detail: replicationFactor >= 2 ? "redundancy configured" : "single-copy risk",
      status: replicationFactor >= 2 ? "ok" : "warn",
    },
    {
      title: "STORAGE",
      value: storageValue,
      detail: storageDetail,
      status: storageStatus,
    },
    {
      title: "API",
      value: `${curlAvailable ? "curl" : "no curl"} · ${awsAvailable ? "aws" : "no aws"}`,
      detail: "local tooling only",
      status: curlAvailable && awsAvailable ? "ok" : "warn",
    },
  ];

  return {
    refreshedAt: new Date().toLocaleTimeString(),
    nodes: nodeHealth,
    metrics,
  };
}

async function runWithEnv(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
    env: { ...Deno.env.toObject(), ...env },
    signal: AbortSignal.timeout(10000),
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout).trim(),
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

/**
 * Builds the full end-to-end S3 validation step array.
 * Steps share closure state: config loaded once, key/bucket created and cleaned up.
 */
export function buildValidateFullSteps(configFile?: string): StepDef[] {
  let s3Url = "";
  let adminUrl = "";
  let adminToken = "";
  let accessKey = "";
  let secretKey = "";
  let bucketName = "";
  let bucketId = "";
  let keyId = "";

  const awsCreds = () => ({
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_DEFAULT_REGION: "garage",
  });

  return [
    {
      label: "Load cluster config",
      run: async () => {
        const config = await loadGarageClusterConfig(configFile);
        if (!config?.nodes?.[0]?.host) throw new Error("no config — run install first");
        const host = config.nodes[0].host;
        const s3Port = config.cluster?.ports?.s3Api ?? 3900;
        const adminPort = config.cluster?.ports?.admin ?? 3903;
        adminToken = config.cluster?.adminToken ?? "";
        if (!adminToken) throw new Error("no adminToken in config");
        s3Url = `http://${host}:${s3Port}`;
        adminUrl = `http://${host}:${adminPort}`;
        return `${host}  s3:${s3Port}  admin:${adminPort}`;
      },
    },
    {
      label: "S3 API reachable",
      run: async () => {
        const r = await checkEndpointReachability(s3Url);
        if (!r.ok) throw new Error(compactDetail(r.detail));
        return r.detail;
      },
    },
    {
      label: "Admin API reachable",
      run: async () => {
        const r = await checkEndpointReachability(adminUrl);
        if (!r.ok) throw new Error(compactDetail(r.detail));
        return r.detail;
      },
    },
    {
      label: "Create validation key",
      run: async () => {
        const resp = await fetch(`${adminUrl}/v1/key`, {
          method: "POST",
          headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "tui-validate" }),
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) throw new Error(`POST /v1/key → ${resp.status}`);
        const data = await resp.json() as { accessKeyId: string; secretAccessKey: string };
        keyId = data.accessKeyId;
        accessKey = data.accessKeyId;
        secretKey = data.secretAccessKey;
        return `${keyId.slice(0, 8)}…`;
      },
    },
    {
      label: "Create bucket & grant access",
      run: async () => {
        bucketName = `tui-validate-${Date.now()}`;
        const createResp = await fetch(`${adminUrl}/v1/bucket`, {
          method: "POST",
          headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ globalAlias: bucketName }),
          signal: AbortSignal.timeout(5000),
        });
        if (!createResp.ok) throw new Error(`POST /v1/bucket → ${createResp.status}`);
        const bdata = await createResp.json() as { id: string };
        bucketId = bdata.id;
        const allowResp = await fetch(`${adminUrl}/v1/bucket/allow`, {
          method: "POST",
          headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            bucketId,
            accessKeyId: keyId,
            permissions: { read: true, write: true, owner: false },
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!allowResp.ok) throw new Error(`POST /v1/bucket/allow → ${allowResp.status}`);
        return bucketName;
      },
    },
    {
      label: "Upload test object",
      run: async () => {
        const tmp = await Deno.makeTempFile({ prefix: "garage-validate-" });
        try {
          await Deno.writeTextFile(tmp, "garage-installer-validate-ok\n");
          const r = await runWithEnv(
            "aws",
            ["s3api", "put-object", "--bucket", bucketName, "--key", "validate.txt", "--body", tmp, "--endpoint-url", s3Url],
            awsCreds(),
          );
          if (r.code !== 0) throw new Error(r.stderr || r.stdout);
          return "uploaded validate.txt";
        } finally {
          await Deno.remove(tmp).catch(() => {});
        }
      },
    },
    {
      label: "Download & verify object",
      run: async () => {
        const tmp = await Deno.makeTempFile({ prefix: "garage-dl-" });
        try {
          const r = await runWithEnv(
            "aws",
            ["s3api", "get-object", "--bucket", bucketName, "--key", "validate.txt", tmp, "--endpoint-url", s3Url],
            awsCreds(),
          );
          if (r.code !== 0) throw new Error(r.stderr || r.stdout);
          const content = await Deno.readTextFile(tmp);
          if (!content.includes("garage-installer-validate-ok")) {
            throw new Error(`content mismatch: ${content.slice(0, 30)}`);
          }
          return "content verified";
        } finally {
          await Deno.remove(tmp).catch(() => {});
        }
      },
    },
    {
      label: "Cleanup bucket & key",
      run: async () => {
        const errs: string[] = [];
        if (bucketName) {
          const r = await runWithEnv(
            "aws",
            ["s3api", "delete-object", "--bucket", bucketName, "--key", "validate.txt", "--endpoint-url", s3Url],
            awsCreds(),
          ).catch((e: unknown) => ({ code: 1, stdout: "", stderr: String(e) }));
          if (r.code !== 0) errs.push(`del obj: ${r.stderr.slice(0, 20)}`);
        }
        if (bucketId) {
          const r = await fetch(`${adminUrl}/v1/bucket?id=${encodeURIComponent(bucketId)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${adminToken}` },
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          if (!r?.ok) errs.push(`del bucket: ${r?.status ?? "err"}`);
        }
        if (keyId) {
          const r = await fetch(`${adminUrl}/v1/key?id=${encodeURIComponent(keyId)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${adminToken}` },
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          if (!r?.ok) errs.push(`del key: ${r?.status ?? "err"}`);
        }
        return errs.length ? `partial: ${errs.join(", ")}` : "bucket & key removed";
      },
    },
  ];
}

/**
 * Builds the validation preflight step array. Steps share closure state so
 * config is loaded once and endpoints are available to subsequent steps.
 */
export function buildValidatePreflightSteps(configFile?: string): StepDef[] {
  let s3Url = "";
  let adminUrl = "";

  return [
    {
      label: "Load cluster config",
      run: async () => {
        const config = await loadGarageClusterConfig(configFile);
        if (!config?.nodes?.[0]?.host) {
          throw new Error("no config found — run install first");
        }
        const host = config.nodes[0].host;
        const s3Port = config.cluster?.ports?.s3Api ?? 3900;
        const adminPort = config.cluster?.ports?.admin ?? 3903;
        s3Url = `http://${host}:${s3Port}`;
        adminUrl = `http://${host}:${adminPort}`;
        return `${host}  S3:${s3Port}  Admin:${adminPort}`;
      },
    },
    {
      label: "S3 API endpoint",
      run: async () => {
        const result = await checkEndpointReachability(s3Url);
        if (!result.ok) throw new Error(compactDetail(result.detail));
        return result.detail;
      },
    },
    {
      label: "Admin API endpoint",
      run: async () => {
        const result = await checkEndpointReachability(adminUrl);
        if (!result.ok) throw new Error(compactDetail(result.detail));
        return result.detail;
      },
    },
    {
      label: "AWS CLI available",
      run: async () => {
        const ok = await commandExists("aws");
        if (!ok) throw new Error("aws not found — install awscli");
        return "found in PATH";
      },
    },
    {
      label: "curl available",
      run: async () => {
        const ok = await commandExists("curl");
        if (!ok) throw new Error("curl not found");
        return "found in PATH";
      },
    },
  ];
}

export function createPollingController(task: () => Promise<void> | void, intervalMs: number): PollingController {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await task();
    } finally {
      inFlight = false;
    }
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    },
    stop: () => {
      if (!running) return;
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    isRunning: () => running,
  };
}
