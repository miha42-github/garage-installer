import { assertEquals, assertNotEquals } from "@std/assert";
import { loadGarageClusterConfig } from "./configLoader.ts";

Deno.test("loadGarageClusterConfig returns null when file is missing", async () => {
  const missingPath = `./tmp-missing-${crypto.randomUUID()}.json`;
  const result = await loadGarageClusterConfig(missingPath);
  assertEquals(result, null);
});

Deno.test("loadGarageClusterConfig returns parsed object for valid JSON", async () => {
  const tempFile = await Deno.makeTempFile({ suffix: ".json" });

  try {
    const expected = {
      nodes: [{ name: "node1", host: "127.0.0.1" }],
      cluster: {
        ports: { s3Api: 3900, admin: 3903 },
        adminToken: "token-123",
      },
    };

    await Deno.writeTextFile(tempFile, JSON.stringify(expected));

    const result = await loadGarageClusterConfig(tempFile);
    assertNotEquals(result, null);
    assertEquals(result?.nodes?.[0]?.name, "node1");
    assertEquals(result?.cluster?.ports?.s3Api, 3900);
    assertEquals(result?.cluster?.adminToken, "token-123");
  } finally {
    await Deno.remove(tempFile).catch(() => undefined);
  }
});

Deno.test("loadGarageClusterConfig returns null for invalid JSON", async () => {
  const tempFile = await Deno.makeTempFile({ suffix: ".json" });

  try {
    await Deno.writeTextFile(tempFile, "{not-valid-json");
    const result = await loadGarageClusterConfig(tempFile);
    assertEquals(result, null);
  } finally {
    await Deno.remove(tempFile).catch(() => undefined);
  }
});
