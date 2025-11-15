import { Client } from "ssh2";
import type { NodeConfig } from "../wizard.ts";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class SSHConnection {
  private client: Client;
  private config: NodeConfig;
  private connected: boolean = false;

  constructor(config: NodeConfig) {
    this.config = config;
    this.client = new Client();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
      };

      if (this.config.authMethod === "key") {
        try {
          const keyData = Deno.readTextFileSync(this.config.keyPath!);
          connectionConfig.privateKey = keyData;
        } catch (error) {
          reject(new Error(`Failed to read SSH key: ${error.message}`));
          return;
        }
      } else {
        connectionConfig.password = this.config.password;
      }

      this.client.on("ready", () => {
        this.connected = true;
        resolve();
      });

      this.client.on("error", (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      this.client.connect(connectionConfig);
    });
  }

  async exec(command: string): Promise<ExecResult> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`Exec failed: ${err.message}`));
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("close", (code: number) => {
          resolve({ stdout, stderr, code });
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
      throw new Error("Connection test failed");
    }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP failed: ${err.message}`));
          return;
        }

        const readStream = Deno.readFileSync(localPath);
        const writeStream = sftp.createWriteStream(remotePath);

        writeStream.on("close", () => {
          resolve();
        });

        writeStream.on("error", (error) => {
          reject(new Error(`Upload failed: ${error.message}`));
        });

        writeStream.write(readStream);
        writeStream.end();
      });
    });
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP failed: ${err.message}`));
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

        readStream.on("error", (error) => {
          reject(new Error(`Download failed: ${error.message}`));
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
      throw new Error(`Failed to write file: ${result.stderr}`);
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      this.client.end();
      this.connected = false;
    }
  }
}
