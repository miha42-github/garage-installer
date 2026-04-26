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

export async function loadGarageClusterConfig(configFile = "garage-cluster-config.json"): Promise<GarageClusterFile | null> {
  try {
    const content = await Deno.readTextFile(configFile);
    return JSON.parse(content) as GarageClusterFile;
  } catch {
    return null;
  }
}
