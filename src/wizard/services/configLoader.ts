import { getConfigPath, migrateIfNeeded, CWD_CONFIG_FILE } from "./paths.ts";

export interface GarageClusterFile {
  nodes?: Array<{
    name: string;
    host: string;
  }>;
  cluster?: {
    replicationFactor?: number;
    ports?: {
      s3Api?: number;
      admin?: number;
      rpc?: number;
      s3Web?: number;
    };
    adminToken?: string;
  };
}

export async function saveGarageClusterConfig(config: GarageClusterFile, configFile?: string): Promise<void> {
  const { ensureAppDir } = await import("./paths.ts");
  const path = configFile ?? getConfigPath();
  await ensureAppDir();
  await Deno.writeTextFile(path, JSON.stringify(config, null, 2));
}

let configMigrationDone = false;

export async function loadGarageClusterConfig(configFile?: string): Promise<GarageClusterFile | null> {
  const resolvedPath = configFile ?? getConfigPath();

  if (!configFile && !configMigrationDone) {
    configMigrationDone = true;
    await migrateIfNeeded(resolvedPath, CWD_CONFIG_FILE);
  }

  try {
    const content = await Deno.readTextFile(resolvedPath);
    return JSON.parse(content) as GarageClusterFile;
  } catch {
    return null;
  }
}
