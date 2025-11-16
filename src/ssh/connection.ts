import { Client } from "ssh2";
import type { NodeConfig } from "../wizard.ts";
import { getLogger } from "../logger.ts";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class SSHConnection {
  private client: Client;
  private config: NodeConfig;
  private connected: boolean = false;
  private defaultTimeout: number = 30000; // 30 seconds
  private logger = getLogger();

  constructor(config: NodeConfig) {
    this.config = config;
    this.client = new Client();
  }

  /**
   * Get a descriptive identifier for this connection (for error messages)
   */
  private getConnectionContext(): string {
    return `${this.config.username}@${this.config.host}:${this.config.port}`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: this.defaultTimeout,
        // Use only ciphers fully supported in Deno's Node.js compatibility layer
        algorithms: {
          cipher: [
            'aes128-ctr',
            'aes256-ctr',
            'aes128-cbc',
            'aes256-cbc',
          ],
        },
      };

      if (this.config.authMethod === "key") {
        try {
          const keyData = Deno.readTextFileSync(this.config.keyPath!);
          connectionConfig.privateKey = keyData;
        } catch (error: any) {
          reject(new Error(
            `[${this.getConnectionContext()}] Failed to read SSH key from ${this.config.keyPath}: ${error.message}`
          ));
          return;
        }
      } else {
        connectionConfig.password = this.config.password;
      }

      this.client.on("ready", () => {
        this.connected = true;
        resolve();
      });

      this.client.on("error", (err: any) => {
        reject(new Error(
          `[${this.getConnectionContext()}] SSH connection failed: ${err.message}`
        ));
      });

      this.client.on("timeout", () => {
        reject(new Error(
          `[${this.getConnectionContext()}] SSH connection timeout after ${this.defaultTimeout}ms`
        ));
      });

      this.client.connect(connectionConfig);
    });
  }

  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    if (!this.connected) {
      throw new Error(`[${this.getConnectionContext()}] Not connected`);
    }

    const timeout = timeoutMs || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      let timedOut = false;
      
      // Set timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error(
          `[${this.getConnectionContext()}] Command timeout after ${timeout}ms: ${command.substring(0, 50)}...`
        ));
      }, timeout);

      this.client.exec(command, (err: any, stream: any) => {
        if (err) {
          clearTimeout(timeoutHandle);
          reject(new Error(
            `[${this.getConnectionContext()}] Exec failed: ${err.message}`
          ));
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("close", (code: number) => {
          clearTimeout(timeoutHandle);
          if (!timedOut) {
            const result = { stdout, stderr, code };
            // Log the command execution
            this.logger.command(`[${this.config.name}] ${command}`, result).catch(() => {});
            resolve(result);
          }
        });

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  async test(): Promise<void> {
    const result = await this.exec("echo 'connection_test'");
    if (result.code !== 0 || !result.stdout.includes("connection_test")) {
      throw new Error(
        `[${this.getConnectionContext()}] Connection test failed`
      );
    }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    if (!this.connected) {
      throw new Error(`[${this.getConnectionContext()}] Not connected`);
    }

    // Read file asynchronously
    const fileData = await Deno.readFile(localPath);

    return new Promise((resolve, reject) => {
      this.client.sftp((err: any, sftp: any) => {
        if (err) {
          reject(new Error(
            `[${this.getConnectionContext()}] SFTP failed: ${err.message}`
          ));
          return;
        }

        const writeStream = sftp.createWriteStream(remotePath);

        writeStream.on("close", () => {
          resolve();
        });

        writeStream.on("error", (error: any) => {
          reject(new Error(
            `[${this.getConnectionContext()}] Upload failed (${localPath} -> ${remotePath}): ${error.message}`
          ));
        });

        // Write the file data buffer and close the stream
        writeStream.write(fileData);
        writeStream.end();
      });
    });
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!this.connected) {
      throw new Error(`[${this.getConnectionContext()}] Not connected`);
    }

    return new Promise((resolve, reject) => {
      this.client.sftp((err: any, sftp: any) => {
        if (err) {
          reject(new Error(
            `[${this.getConnectionContext()}] SFTP failed: ${err.message}`
          ));
          return;
        }

        const readStream = sftp.createReadStream(remotePath);
        const chunks: Uint8Array[] = [];

        readStream.on("data", (chunk: Buffer) => {
          chunks.push(new Uint8Array(chunk));
        });

        readStream.on("close", () => {
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          Deno.writeFileSync(localPath, result);
          resolve();
        });

        readStream.on("error", (error: any) => {
          reject(new Error(
            `[${this.getConnectionContext()}] Download failed (${remotePath} -> ${localPath}): ${error.message}`
          ));
        });
      });
    });
  }

  async fileExists(remotePath: string): Promise<boolean> {
    const result = await this.exec(`test -f ${remotePath} && echo "exists"`);
    return result.stdout.trim() === "exists";
  }

  async directoryExists(remotePath: string): Promise<boolean> {
    const result = await this.exec(`test -d ${remotePath} && echo "exists"`);
    return result.stdout.trim() === "exists";
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    // Write content using heredoc to avoid escaping issues
    const command = `cat > ${remotePath} << 'EOF_MARKER'
${content}
EOF_MARKER`;
    
    const result = await this.exec(command);
    if (result.code !== 0) {
      throw new Error(
        `[${this.getConnectionContext()}] Failed to write file ${remotePath}: ${result.stderr}`
      );
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      this.client.end();
      this.connected = false;
    }
  }
}
