/**
 * Default configuration constants for Garage cluster installer
 */

export const DEFAULT_PORTS = {
  s3Api: 3900,
  rpc: 3901,
  s3Web: 3902,
  admin: 3903,
} as const;

export const DEFAULT_PATHS = {
  workdir: "/opt/garage",
  dataDir: "/var/lib/garage/data",
  metaDir: "/var/lib/garage/meta",
} as const;

export const DEFAULT_GARAGE_VERSION = "v2.1.0";

export const DEFAULT_REPLICATION_FACTOR = 2;

export const DEFAULT_CAPACITY = "10G";

export const SSH_DEFAULTS = {
  port: 22,
  timeout: 30000, // 30 seconds
} as const;

export const DOCKER_DEFAULTS = {
  healthCheckTimeout: 30, // seconds
  healthCheckInterval: 2, // seconds
} as const;

export const SYSTEM_REQUIREMENTS = {
  minDiskSpaceGB: 16,
} as const;
