import type { SSHConnection } from "../ssh/connection.ts";

// ── Result types ─────────────────────────────────────────────────────────────

export interface CreatedKey {
  accessKeyId: string;
  secretAccessKey: string;
  name: string;
  canCreateBuckets: boolean;
}

// ── GarageAdmin ───────────────────────────────────────────────────────────────

/**
 * Thin wrapper around the Garage CLI running inside the "garage" Docker
 * container on a remote node.  Every operation issues:
 *
 *   docker exec garage /garage <subcommand>
 *
 * over the existing persistent SSH connection.
 */
export class GarageAdmin {
  constructor(private ssh: SSHConnection) {}

  // ── Bucket operations ──────────────────────────────────────────────────────

  /** Returns raw CLI output – caller handles display. */
  async listBuckets(): Promise<string> {
    const r = await this.exec("bucket list");
    if (r.code !== 0) throw new Error(stripNoise(r.stderr) || "Failed to list buckets");
    return r.stdout;
  }

  async createBucket(name: string): Promise<void> {
    const r = await this.exec(`bucket create ${name}`);
    if (r.code !== 0 && !r.stderr.includes("already exists")) {
      throw new Error(stripNoise(r.stderr) || `Failed to create bucket "${name}"`);
    }
  }

  async bucketInfo(name: string): Promise<string> {
    const r = await this.exec(`bucket info ${name}`);
    if (r.code !== 0) {
      throw new Error(stripNoise(r.stderr) || `Bucket "${name}" not found`);
    }
    return r.stdout;
  }

  async deleteBucket(name: string): Promise<void> {
    const r = await this.exec(`bucket delete ${name} --yes`);
    if (r.code !== 0) {
      throw new Error(stripNoise(r.stderr) || `Failed to delete bucket "${name}"`);
    }
  }

  // ── Key / user operations ─────────────────────────────────────────────────

  async listKeys(): Promise<string> {
    const r = await this.exec("key list");
    if (r.code !== 0) throw new Error(stripNoise(r.stderr) || "Failed to list keys");
    return r.stdout;
  }

  /**
   * Creates a new key and parses the secret out of the creation output (the
   * only time the secret is visible).  The secret is never persisted beyond
   * the returned object – caller must display it and discard.
   */
  async createKey(name: string): Promise<CreatedKey> {
    const r = await this.exec(`key create ${name}`);
    if (r.code !== 0 && !r.stderr.includes("already exists")) {
      throw new Error(stripNoise(r.stderr) || "Failed to create key");
    }

    const accessKeyMatch = r.stdout.match(/Key ID:\s+(\S+)/i);
    const secretKeyMatch = r.stdout.match(/Secret key:\s+(\S+)/i);
    const canCreateMatch  = r.stdout.match(/Can create buckets:\s+(true|false)/i);

    if (!accessKeyMatch || !secretKeyMatch) {
      throw new Error(
        `Could not parse key credentials.\nRaw output:\n${r.stdout}`
      );
    }

    return {
      accessKeyId:      accessKeyMatch[1].trim(),
      secretAccessKey:  secretKeyMatch[1].trim(),
      name,
      canCreateBuckets: canCreateMatch?.[1] === "true",
    };
  }

  async keyInfo(nameOrId: string): Promise<string> {
    const r = await this.exec(`key info ${nameOrId}`);
    if (r.code !== 0) {
      throw new Error(stripNoise(r.stderr) || `Key "${nameOrId}" not found`);
    }
    return r.stdout;
  }

  async deleteKey(nameOrId: string): Promise<void> {
    const r = await this.exec(`key delete ${nameOrId} --yes`);
    if (r.code !== 0) {
      throw new Error(stripNoise(r.stderr) || `Failed to delete key "${nameOrId}"`);
    }
  }

  // ── Permission operations ─────────────────────────────────────────────────

  async allowBucket(
    bucket: string,
    keyId: string,
    opts: { read?: boolean; write?: boolean; owner?: boolean }
  ): Promise<void> {
    const flags = [
      opts.read  ? "--read"  : "",
      opts.write ? "--write" : "",
      opts.owner ? "--owner" : "",
    ].filter(Boolean).join(" ");

    if (!flags) throw new Error("At least one permission flag (read/write/owner) is required");

    const r = await this.exec(`bucket allow ${bucket} ${flags} --key ${keyId}`);
    if (r.code !== 0) {
      throw new Error(stripNoise(r.stderr) || "Failed to grant permissions");
    }
  }

  async denyBucket(bucket: string, keyId: string): Promise<void> {
    const r = await this.exec(`bucket deny ${bucket} --key ${keyId}`);
    if (r.code !== 0) {
      throw new Error(stripNoise(r.stderr) || "Failed to revoke permissions");
    }
  }

  async allowCreateBucket(keyId: string): Promise<void> {
    const r = await this.exec(`key allow --create-bucket ${keyId}`);
    if (r.code !== 0) {
      throw new Error(stripNoise(r.stderr) || "Failed to grant bucket-creation permission");
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async exec(cmd: string) {
    return await this.ssh.exec(`docker exec garage /garage ${cmd}`);
  }
}

/**
 * The Garage CLI emits INFO log lines to stderr on every invocation; strip
 * those so error messages shown to the user are clean.
 *
 * Example noise:
 *   2026-03-15T20:28:48.629305Z  INFO garage_net::netapp: Connected to …
 */
function stripNoise(raw: string): string {
  return raw
    .split("\n")
    .filter((l) => !l.match(/^\d{4}-\d{2}-\d{2}T.*INFO|.*garage_net/))
    .join("\n")
    .trim();
}
