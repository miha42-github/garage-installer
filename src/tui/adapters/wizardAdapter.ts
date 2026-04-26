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

type AdapterOptions = {
  configFile?: string;
  checkEndpoint?: ReachabilityFn;
  checkPing?: HostProbeFn;
  checkSSH?: HostProbeFn;
  checkCommandExists?: CommandExistsFn;
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
  const configFile = options.configFile ?? "garage-cluster-config.json";
  const checkEndpoint = options.checkEndpoint ?? checkEndpointReachability;
  const checkPing = options.checkPing ?? checkPingProbe;
  const checkSSH = options.checkSSH ?? checkSSHProbe;
  const checkCommand = options.checkCommandExists ?? commandExists;

  const config = await loadGarageClusterConfig(configFile);
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

  const [curlAvailable, awsAvailable] = await Promise.all([
    checkCommand("curl"),
    checkCommand("aws"),
  ]);

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
      value: "NOT PROBED",
      detail: "disk telemetry adapter pending",
      status: "warn",
    },
    {
      title: "API",
      value: `${curlAvailable ? "curl" : "no curl"} · ${awsAvailable ? "aws" : "no aws"}`,
      detail: "local tooling for admin/validation",
      status: curlAvailable && awsAvailable ? "ok" : "warn",
    },
  ];

  return {
    refreshedAt: new Date().toLocaleTimeString(),
    nodes: nodeHealth,
    metrics,
  };
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
