const SSH_KEY_FILENAMES = ["id_ed25519", "id_rsa", "id_ecdsa"];

export function getDefaultSSHUsername(): string {
  return Deno.env.get("USER") || "ubuntu";
}

export function getCommonSSHKeyPaths(homeDir = Deno.env.get("HOME") || ""): string[] {
  return SSH_KEY_FILENAMES.map((fileName) => `${homeDir}/.ssh/${fileName}`);
}

export async function findAvailableSSHKeys(homeDir = Deno.env.get("HOME") || ""): Promise<string[]> {
  const keyPaths = getCommonSSHKeyPaths(homeDir);
  const availableKeys: string[] = [];

  for (const keyPath of keyPaths) {
    try {
      await Deno.stat(keyPath);
      availableKeys.push(keyPath);
    } catch {
      // Key file does not exist, skip.
    }
  }

  return availableKeys;
}

export async function findFirstAvailableSSHKey(homeDir = Deno.env.get("HOME") || ""): Promise<string> {
  const availableKeys = await findAvailableSSHKeys(homeDir);
  return availableKeys[0] || "";
}
