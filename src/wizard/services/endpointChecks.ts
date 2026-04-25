export async function commandExists(command: string): Promise<boolean> {
  try {
    const check = new Deno.Command("which", {
      args: [command],
      stdout: "null",
      stderr: "null",
    });
    const { success } = await check.output();
    return success;
  } catch {
    return false;
  }
}

export async function checkEndpointReachability(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    // We only need the status code; close the body to avoid resource leaks in tests/runtime.
    await response.body?.cancel();
    return { ok: true, detail: `HTTP ${response.status}` };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const compact = err.message.split("\n")[0].trim();
    return { ok: false, detail: compact || "request failed" };
  }
}

export async function testHostResolution(hostname: string): Promise<boolean> {
  try {
    const result = await Deno.resolveDns(hostname, "A");
    return result.length > 0;
  } catch {
    try {
      const result = await Deno.resolveDns(hostname, "AAAA");
      return result.length > 0;
    } catch {
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
        return true;
      }
      if (/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(hostname)) {
        return true;
      }
      return false;
    }
  }
}
