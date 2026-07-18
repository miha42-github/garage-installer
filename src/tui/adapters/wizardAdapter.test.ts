import { assert, assertEquals } from "@std/assert";
import {
  collectHealthSnapshot,
  createPollingController,
  buildValidateFullSteps,
  buildValidatePreflightSteps,
} from "./wizardAdapter.ts";
import type { GarageHealthResult } from "./wizardAdapter.ts";

// Writes a minimal cluster config to a temp file and returns the path.
// Caller is responsible for removing it.
async function writeTempConfig(nodes: Array<{ name: string; host: string }>): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.writeTextFile(path, JSON.stringify({
    nodes,
    cluster: { replicationFactor: 2, ports: { s3Api: 3900, admin: 3903 } },
  }));
  return path;
}

Deno.test("collectHealthSnapshot maps degraded node when endpoints are down", async () => {
  const configFile = await writeTempConfig([
    { name: "node1", host: "espresso-1" },
    { name: "node2", host: "cafe-1" },
  ]);

  try {
    const statuses = new Map<string, { ok: boolean; detail: string }>([
      ["http://espresso-1:3900", { ok: false, detail: "connection refused" }],
      ["http://espresso-1:3903", { ok: false, detail: "connection refused" }],
      ["http://cafe-1:3900", { ok: true, detail: "HTTP 200" }],
      ["http://cafe-1:3903", { ok: true, detail: "HTTP 200" }],
    ]);

    const garageHealthStub: GarageHealthResult = {
      reachable: true,
      healthy: true,
      storageNodes: 2,
      storageNodesOk: 2,
    };

    const snapshot = await collectHealthSnapshot({
      configFile,
      checkEndpoint: async (url) => statuses.get(url) ?? { ok: false, detail: "missing test stub" },
      checkPing: async () => ({ status: "ok", summary: "OK echo reply" }),
      checkSSH: async () => ({ status: "ok", summary: "OK cli auth" }),
      checkCommandExists: async () => true,
      checkGarageHealth: async () => garageHealthStub,
    });

    assertEquals(snapshot.nodes.length, 2);
    assertEquals(snapshot.nodes[0].title, "NODE1");
    assertEquals(snapshot.nodes[0].host, "espresso-1");
    assertEquals(snapshot.nodes[0].status, "warn");
    assertEquals(snapshot.nodes[0].statusLabel, "WARN");
    assertEquals(snapshot.nodes[0].s3.status, "down");
    assertEquals(snapshot.nodes[0].admin.status, "down");
    assertEquals(snapshot.nodes[0].ping.status, "ok");
    assertEquals(snapshot.nodes[0].ssh.status, "ok");
    assertEquals(snapshot.nodes[1].status, "ok");

    const clusterMetric = snapshot.metrics.find((m) => m.title === "CLUSTER");
    assert(clusterMetric);
    assertEquals(clusterMetric.status, "warn");
  } finally {
    await Deno.remove(configFile).catch(() => undefined);
  }
});

Deno.test("collectHealthSnapshot builds storage metric from garage health probe", async () => {
  const configFile = await writeTempConfig([
    { name: "node1", host: "espresso-1" },
    { name: "node2", host: "cafe-1" },
  ]);

  try {
    const snapshot = await collectHealthSnapshot({
      configFile,
      checkEndpoint: async () => ({ ok: true, detail: "HTTP 200" }),
      checkPing: async () => ({ status: "ok", summary: "OK echo reply" }),
      checkSSH: async () => ({ status: "ok", summary: "OK cli auth" }),
      checkCommandExists: async () => true,
      checkGarageHealth: async () => ({
        reachable: true,
        healthy: true,
        storageNodes: 2,
        storageNodesOk: 2,
      }),
    });

    const storageMetric = snapshot.metrics.find((m) => m.title === "STORAGE");
    assert(storageMetric);
    assertEquals(storageMetric.status, "ok");
    assertEquals(storageMetric.value, "2/2 NODES OK");
    assertEquals(storageMetric.detail, "all partitions ok");
  } finally {
    await Deno.remove(configFile).catch(() => undefined);
  }
});

Deno.test("collectHealthSnapshot storage metric is warn when garage health unreachable", async () => {
  const configFile = await writeTempConfig([
    { name: "node1", host: "espresso-1" },
  ]);

  try {
    const snapshot = await collectHealthSnapshot({
      configFile,
      checkEndpoint: async () => ({ ok: true, detail: "HTTP 200" }),
      checkPing: async () => ({ status: "ok", summary: "OK echo reply" }),
      checkSSH: async () => ({ status: "ok", summary: "OK cli auth" }),
      checkCommandExists: async () => true,
      checkGarageHealth: async () => ({
        reachable: false,
        healthy: false,
        storageNodes: 0,
        storageNodesOk: 0,
      }),
    });

    const storageMetric = snapshot.metrics.find((m) => m.title === "STORAGE");
    assert(storageMetric);
    assertEquals(storageMetric.status, "warn");
    assertEquals(storageMetric.value, "NOT PROBED");
  } finally {
    await Deno.remove(configFile).catch(() => undefined);
  }
});

Deno.test("createPollingController starts and stops without duplicate loops", async () => {
  let ticks = 0;
  const poller = createPollingController(async () => {
    ticks += 1;
  }, 20);

  poller.start();
  poller.start();
  await new Promise((resolve) => setTimeout(resolve, 75));
  poller.stop();
  const afterStop = ticks;
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert(afterStop >= 2);
  assertEquals(ticks, afterStop);
  assertEquals(poller.isRunning(), false);
});

// ── Parity: step sequence matches the S3 validation protocol ─────────────────

Deno.test("buildValidateFullSteps: step count and labels match S3 validation protocol", () => {
  const steps = buildValidateFullSteps();
  assertEquals(steps.length, 8);
  assertEquals(steps[0].label, "Load cluster config");
  assertEquals(steps[1].label, "S3 API reachable");
  assertEquals(steps[2].label, "Admin API reachable");
  assertEquals(steps[3].label, "Create validation key");
  assertEquals(steps[4].label, "Create bucket & grant access");
  assertEquals(steps[5].label, "Upload test object");
  assertEquals(steps[6].label, "Download & verify object");
  assertEquals(steps[7].label, "Cleanup bucket & key");
});

Deno.test("buildValidateFullSteps: independent call sites produce isolated closure state", () => {
  const a = buildValidateFullSteps();
  const b = buildValidateFullSteps();
  // Two invocations must produce separate step arrays (independent closures).
  assert(a !== b);
  assertEquals(a.length, b.length);
});

Deno.test("buildValidatePreflightSteps: step count and labels match legacy health-report probe set", () => {
  const steps = buildValidatePreflightSteps();
  assertEquals(steps.length, 5);
  assertEquals(steps[0].label, "Load cluster config");
  assertEquals(steps[1].label, "S3 API endpoint");
  assertEquals(steps[2].label, "Admin API endpoint");
  assertEquals(steps[3].label, "AWS CLI available");
  assertEquals(steps[4].label, "curl available");
});

Deno.test("collectHealthSnapshot: snapshot shape includes required per-node probe fields", async () => {
  const configFile = await writeTempConfig([
    { name: "node0", host: "127.0.0.1" },
    { name: "node1", host: "127.0.0.2" },
  ]);

  try {
    const snapshot = await collectHealthSnapshot({
      configFile,
      checkEndpoint: async () => ({ ok: true, detail: "HTTP 200" }),
      checkPing: async () => ({ status: "ok", summary: "OK echo reply" }),
      checkSSH: async () => ({ status: "ok", summary: "OK cli auth" }),
      checkCommandExists: async () => true,
      checkGarageHealth: async () => ({
        reachable: true,
        healthy: true,
        storageNodes: 2,
        storageNodesOk: 2,
      }),
    });

    // Every node must expose the same 4 probe dimensions (S3, admin, ping, ssh)
    // that the legacy health-report workflow reports, ensuring no drift.
    for (const node of snapshot.nodes) {
      assert("s3" in node, "node must expose s3 probe");
      assert("admin" in node, "node must expose admin probe");
      assert("ping" in node, "node must expose ping probe");
      assert("ssh" in node, "node must expose ssh probe");
      assert("host" in node, "node must expose host");
      assert("status" in node, "node must expose overall status");
    }

    // Cluster metric set must cover the same dimensions the legacy report covers.
    const titles = snapshot.metrics.map((m) => m.title);
    assert(titles.includes("CLUSTER"), "metrics must include CLUSTER");
    assert(titles.includes("API"), "metrics must include API (tool availability parity)");
  } finally {
    await Deno.remove(configFile).catch(() => undefined);
  }
});
