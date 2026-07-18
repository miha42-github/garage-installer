import { join } from "@std/path";

const APP_DIR_NAME = ".garage-installer";

export const CWD_STATE_FILE = ".garage-installer-state.json";
export const CWD_CONFIG_FILE = "garage-cluster-config.json";

export function getAppDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return join(home, APP_DIR_NAME);
}

export function getStatePath(): string {
  return join(getAppDir(), "state.json");
}

export function getConfigPath(): string {
  return join(getAppDir(), "config.json");
}

export async function ensureAppDir(): Promise<void> {
  await Deno.mkdir(getAppDir(), { recursive: true });
}

export async function migrateIfNeeded(newPath: string, cwdPath: string): Promise<void> {
  try {
    await Deno.stat(newPath);
    return;
  } catch { /* new path absent — check for CWD file */ }

  try {
    await Deno.stat(cwdPath);
  } catch {
    return;
  }

  await ensureAppDir();
  await Deno.copyFile(cwdPath, newPath);
  try {
    await Deno.rename(cwdPath, `${cwdPath}.migrated`);
  } catch { /* cross-device rename; original stays but migration succeeded */ }
}
