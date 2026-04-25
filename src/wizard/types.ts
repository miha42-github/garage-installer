import type { SSHConnection } from "../ssh/connection.ts";

export interface NodeConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "key" | "password";
  keyPath?: string;
  password?: string;
  connection?: SSHConnection;
}

export interface ClusterConfig {
  rpcSecret: string;
  adminToken: string;
  capacityPerNode: string;
  dataDir: string;
  metaDir: string;
  workdir: string;
  garageVersion: string;
  replicationFactor: number;
  ports: {
    s3Api: number;
    rpc: number;
    s3Web: number;
    admin: number;
  };
}
