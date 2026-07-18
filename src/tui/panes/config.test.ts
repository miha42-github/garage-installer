import { assertEquals, assertNotEquals, assert } from "@std/assert";
import { CONFIG_FIELDS } from "./config.ts";
import { loadGarageClusterConfig, saveGarageClusterConfig } from "../../wizard/services/configLoader.ts";
import type { GarageClusterFile } from "../../wizard/services/configLoader.ts";

const BASE_CONFIG: GarageClusterFile = {
  nodes: [
    { name: "espresso-1", host: "192.168.1.10" },
    { name: "cafe-1", host: "192.168.1.11" },
  ],
  cluster: {
    replicationFactor: 2,
    ports: { s3Api: 3900, admin: 3903, rpc: 3901, s3Web: 3902 },
    adminToken: "secret-token",
  },
};

// ── Field getter tests ─────────────────────────────────────────────────────

Deno.test("CONFIG_FIELDS: getters return correct values from config", () => {
  const cfg = BASE_CONFIG;
  assertEquals(CONFIG_FIELDS[0].get(cfg), "espresso-1");   // node0 name
  assertEquals(CONFIG_FIELDS[1].get(cfg), "192.168.1.10"); // node0 host
  assertEquals(CONFIG_FIELDS[2].get(cfg), "cafe-1");        // node1 name
  assertEquals(CONFIG_FIELDS[3].get(cfg), "192.168.1.11"); // node1 host
  assertEquals(CONFIG_FIELDS[4].get(cfg), "2");             // replication
  assertEquals(CONFIG_FIELDS[5].get(cfg), "3900");          // s3 api port
  assertEquals(CONFIG_FIELDS[6].get(cfg), "3903");          // admin port
  assertEquals(CONFIG_FIELDS[7].get(cfg), "3901");          // rpc port
  assertEquals(CONFIG_FIELDS[8].get(cfg), "3902");          // web port
});

Deno.test("CONFIG_FIELDS: getters return defaults when fields are absent", () => {
  const empty: GarageClusterFile = {};
  assertEquals(CONFIG_FIELDS[0].get(empty), "");
  assertEquals(CONFIG_FIELDS[4].get(empty), "2");    // replicationFactor default
  assertEquals(CONFIG_FIELDS[5].get(empty), "3900"); // s3Api default
});

// ── Setter / roundtrip tests ───────────────────────────────────────────────

Deno.test("CONFIG_FIELDS: setters produce updated config without mutating original", () => {
  const original = { ...BASE_CONFIG };
  const updated = CONFIG_FIELDS[0].set(BASE_CONFIG, "new-node");
  assertEquals(updated.nodes?.[0].name, "new-node");
  assertEquals(BASE_CONFIG.nodes?.[0].name, original.nodes?.[0].name); // immutable
  assertEquals(updated.nodes?.[1].name, "cafe-1"); // node1 unchanged
});

Deno.test("CONFIG_FIELDS: port setter converts string to number in config", () => {
  const updated = CONFIG_FIELDS[5].set(BASE_CONFIG, "4000");
  assertEquals(updated.cluster?.ports?.s3Api, 4000);
  assertEquals(updated.cluster?.ports?.admin, 3903); // others unchanged
});

Deno.test("CONFIG_FIELDS: replication setter converts string to number", () => {
  const updated = CONFIG_FIELDS[4].set(BASE_CONFIG, "3");
  assertEquals(updated.cluster?.replicationFactor, 3);
});

// ── Validation tests ───────────────────────────────────────────────────────

Deno.test("CONFIG_FIELDS: name/host validation rejects empty string", () => {
  assertNotEquals(CONFIG_FIELDS[0].validate(""), null);   // node0 name — required
  assertNotEquals(CONFIG_FIELDS[1].validate("  "), null); // node0 host — required
  assertEquals(CONFIG_FIELDS[0].validate("espresso"), null); // valid
});

Deno.test("CONFIG_FIELDS: port validation rejects out-of-range values", () => {
  assertEquals(CONFIG_FIELDS[5].validate("3900"), null);    // valid
  assertEquals(CONFIG_FIELDS[5].validate("1"), null);       // lower bound
  assertEquals(CONFIG_FIELDS[5].validate("65535"), null);   // upper bound
  assertNotEquals(CONFIG_FIELDS[5].validate("0"), null);    // below range
  assertNotEquals(CONFIG_FIELDS[5].validate("65536"), null); // above range
  assertNotEquals(CONFIG_FIELDS[5].validate("abc"), null);  // not a number
});

Deno.test("CONFIG_FIELDS: replication validation rejects out-of-range values", () => {
  assertEquals(CONFIG_FIELDS[4].validate("1"), null);
  assertEquals(CONFIG_FIELDS[4].validate("10"), null);
  assertNotEquals(CONFIG_FIELDS[4].validate("0"), null);
  assertNotEquals(CONFIG_FIELDS[4].validate("11"), null);
  assertNotEquals(CONFIG_FIELDS[4].validate("abc"), null);
});

// ── Save/load roundtrip tests ──────────────────────────────────────────────

Deno.test("saveGarageClusterConfig + loadGarageClusterConfig: roundtrip preserves all fields", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await saveGarageClusterConfig(BASE_CONFIG, tmp);
    const loaded = await loadGarageClusterConfig(tmp);
    assert(loaded !== null);
    assertEquals(loaded.nodes?.[0].name, "espresso-1");
    assertEquals(loaded.nodes?.[1].host, "192.168.1.11");
    assertEquals(loaded.cluster?.replicationFactor, 2);
    assertEquals(loaded.cluster?.ports?.s3Api, 3900);
    assertEquals(loaded.cluster?.adminToken, "secret-token");
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("saveGarageClusterConfig: edited config is saved and reloaded correctly", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".json" });
  try {
    // Simulate an edit: change node0 host via the field setter
    const edited = CONFIG_FIELDS[1].set(BASE_CONFIG, "10.0.0.1");
    await saveGarageClusterConfig(edited, tmp);
    const loaded = await loadGarageClusterConfig(tmp);
    assertEquals(loaded?.nodes?.[0].host, "10.0.0.1");
    assertEquals(loaded?.nodes?.[1].host, "192.168.1.11"); // node1 unchanged
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});
