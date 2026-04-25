import { assertEquals, assert } from "@std/assert";
import {
  findAvailableSSHKeys,
  findFirstAvailableSSHKey,
  getCommonSSHKeyPaths,
  getDefaultSSHUsername,
} from "./sshDefaults.ts";

Deno.test("getDefaultSSHUsername uses USER env fallback", () => {
  const original = Deno.env.get("USER");

  try {
    Deno.env.set("USER", "test-user");
    assertEquals(getDefaultSSHUsername(), "test-user");

    Deno.env.delete("USER");
    assertEquals(getDefaultSSHUsername(), "ubuntu");
  } finally {
    if (original === undefined) Deno.env.delete("USER");
    else Deno.env.set("USER", original);
  }
});

Deno.test("getCommonSSHKeyPaths returns expected key paths", () => {
  const home = "/tmp/example-home";
  const paths = getCommonSSHKeyPaths(home);

  assertEquals(paths[0], `${home}/.ssh/id_ed25519`);
  assertEquals(paths[1], `${home}/.ssh/id_rsa`);
  assertEquals(paths[2], `${home}/.ssh/id_ecdsa`);
});

Deno.test("findAvailableSSHKeys and findFirstAvailableSSHKey detect existing keys", async () => {
  const tempHome = await Deno.makeTempDir();
  const sshDir = `${tempHome}/.ssh`;

  try {
    await Deno.mkdir(sshDir, { recursive: true });
    await Deno.writeTextFile(`${sshDir}/id_rsa`, "PRIVATE KEY");

    const available = await findAvailableSSHKeys(tempHome);
    assertEquals(available.length, 1);
    assertEquals(available[0], `${sshDir}/id_rsa`);

    const first = await findFirstAvailableSSHKey(tempHome);
    assertEquals(first, `${sshDir}/id_rsa`);
  } finally {
    await Deno.remove(tempHome, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("findFirstAvailableSSHKey returns empty string when none exist", async () => {
  const tempHome = await Deno.makeTempDir();

  try {
    const first = await findFirstAvailableSSHKey(tempHome);
    assertEquals(first, "");
  } finally {
    await Deno.remove(tempHome, { recursive: true }).catch(() => undefined);
  }
});
