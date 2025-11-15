export class Logger {
  private logFile: string;
  private encoder = new TextEncoder();

  constructor(logFile?: string) {
    // Default to garage-installer.log in current directory
    this.logFile = logFile || "./garage-installer.log";
  }

  private async write(level: string, message: string, data?: unknown): Promise<void> {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] ${level}: ${message}`;
    
    if (data !== undefined) {
      if (typeof data === "string") {
        logLine += `\n  ${data}`;
      } else {
        logLine += `\n  ${JSON.stringify(data, null, 2)}`;
      }
    }
    
    logLine += "\n";

    try {
      await Deno.writeTextFile(this.logFile, logLine, { append: true });
    } catch (error) {
      // Silently fail if we can't write to log file
      console.error(`Failed to write to log file: ${error.message}`);
    }
  }

  async info(message: string, data?: unknown): Promise<void> {
    await this.write("INFO", message, data);
  }

  async warn(message: string, data?: unknown): Promise<void> {
    await this.write("WARN", message, data);
  }

  async error(message: string, data?: unknown): Promise<void> {
    await this.write("ERROR", message, data);
  }

  async debug(message: string, data?: unknown): Promise<void> {
    await this.write("DEBUG", message, data);
  }

  async command(cmd: string, result: { code: number; stdout: string; stderr: string }): Promise<void> {
    await this.write("COMMAND", cmd, {
      exitCode: result.code,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    });
  }

  getLogPath(): string {
    return this.logFile;
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function initLogger(logFile?: string): Logger {
  globalLogger = new Logger(logFile);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}
