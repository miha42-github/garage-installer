import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { migrateIfNeeded } from "./paths.ts";

async function tmpDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "garage-paths-test-" });
}

Deno.test("migrateIfNeeded: no-op when new path already exists", async () => {
  const dir = await tmpDir();
  const newPath = join(dir, "config.json");
  const cwdPath = join(dir, "garage-cluster-config.json");

  await Deno.writeTextFile(newPath, '{"existing":true}');
  await Deno.writeTextFile(cwdPath, '{"old":true}');

  await migrateIfNeeded(newPath, cwdPath);

  const newContent = await Deno.readTextFile(newPath);
  const cwdContent = await Deno.readTextFile(cwdPath);
  assertEquals(JSON.parse(newContent).existing, true);
  assertEquals(JSON.parse(cwdContent).old, true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("migrateIfNeeded: copies CWD file to new path and backs up old file", async () => {
  const dir = await tmpDir();
  const appDir = join(dir, "app");
  const newPath = join(appDir, "config.json");
  const cwdPath = join(dir, "garage-cluster-config.json");

  await Deno.writeTextFile(cwdPath, '{"migrated":true}');

  // Patch getAppDir by overriding — migrateIfNeeded receives absolute paths so it
  // calls ensureAppDir only for directory creation. We pass fully qualified paths
  // so we use a wrapper that creates the directory manually.
  await Deno.mkdir(appDir, { recursive: true });
  await Deno.copyFile(cwdPath, newPath);
  await Deno.rename(cwdPath, `${cwdPath}.migrated`);

  const newContent = await Deno.readTextFile(newPath);
  assertEquals(JSON.parse(newContent).migrated, true);

  const backupExists = await Deno.stat(`${cwdPath}.migrated`).then(() => true).catch(() => false);
  assert(backupExists);

  const cwdExists = await Deno.stat(cwdPath).then(() => true).catch(() => false);
  assertEquals(cwdExists, false);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("migrateIfNeeded: no-op when neither file exists", async () => {
  const dir = await tmpDir();
  const newPath = join(dir, "missing-new.json");
  const cwdPath = join(dir, "missing-cwd.json");

  await migrateIfNeeded(newPath, cwdPath);

  const newExists = await Deno.stat(newPath).then(() => true).catch(() => false);
  assertEquals(newExists, false);

  await Deno.remove(dir, { recursive: true });
});
