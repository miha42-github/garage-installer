import { assertEquals, assertMatch } from "@std/assert";
import {
  checkEndpointReachability,
  commandExists,
  testHostResolution,
} from "./endpointChecks.ts";

Deno.test("commandExists returns true for known command and false for random command", async () => {
  const shouldExist = await commandExists("sh");
  const shouldNotExist = await commandExists(`cmd-does-not-exist-${crypto.randomUUID()}`);

  assertEquals(shouldExist, true);
  assertEquals(shouldNotExist, false);
});

Deno.test("checkEndpointReachability returns ok true for a reachable local endpoint", async () => {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, () => {
    return new Response("ok", { status: 200 });
  });

  try {
    const addr = server.addr as Deno.NetAddr;
    const result = await checkEndpointReachability(`http://127.0.0.1:${addr.port}`);
    assertEquals(result.ok, true);
    assertEquals(result.detail, "HTTP 200");
  } finally {
    await server.shutdown();
  }
});

Deno.test("checkEndpointReachability returns ok false for an unreachable local endpoint", async () => {
  const result = await checkEndpointReachability("http://127.0.0.1:9");
  assertEquals(result.ok, false);
  assertMatch(result.detail, /failed|refused|network|request/i);
});

Deno.test("testHostResolution accepts literal IPs and rejects invalid hostname", async () => {
  const ipv4 = await testHostResolution("127.0.0.1");
  const ipv6 = await testHostResolution("::1");
  const invalid = await testHostResolution(`invalid-host-${crypto.randomUUID()}.example.invalid`);

  assertEquals(ipv4, true);
  assertEquals(ipv6, true);
  assertEquals(invalid, false);
});
