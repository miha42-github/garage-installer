import { assert, assertEquals } from "@std/assert";
import { collectHealthSnapshot, createPollingController } from "./wizardAdapter.ts";

Deno.test("collectHealthSnapshot maps degraded node when endpoints are down", async () => {
  const statuses = new Map<string, { ok: boolean; detail: string }>([
    ["http://espresso-1:3900", { ok: false, detail: "connection refused" }],
    ["http://espresso-1:3903", { ok: false, detail: "connection refused" }],
    ["http://cafe-1:3900", { ok: true, detail: "HTTP 200" }],
    ["http://cafe-1:3903", { ok: true, detail: "HTTP 200" }],
  ]);

  const snapshot = await collectHealthSnapshot({
    configFile: "garage-cluster-config.json",
    checkEndpoint: async (url) => statuses.get(url) ?? { ok: false, detail: "missing test stub" },
    checkPing: async (host) => host === "espresso-1"
      ? { status: "ok", summary: "OK echo reply" }
      : { status: "ok", summary: "OK echo reply" },
    checkSSH: async (host) => host === "espresso-1"
      ? { status: "ok", summary: "OK cli auth" }
      : { status: "ok", summary: "OK cli auth" },
    checkCommandExists: async () => true,
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

  const clusterMetric = snapshot.metrics.find((metric) => metric.title === "CLUSTER");
  assert(clusterMetric);
  assertEquals(clusterMetric.status, "warn");
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
