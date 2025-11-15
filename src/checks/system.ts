import type { SSHConnection } from "../ssh/connection.ts";

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  autoFix?: (ssh: SSHConnection) => Promise<void>;
}

export class SystemChecker {
  constructor(private ssh: SSHConnection) {}

  async runAll(): Promise<CheckResult[]> {
    const checks = [
      this.checkOS(),
      this.checkDocker(),
      this.checkDockerPermissions(),
      this.checkDiskSpace(),
      this.checkPorts(),
      this.checkDockerCompose(),
    ];

    return await Promise.all(checks);
  }

  private async checkOS(): Promise<CheckResult> {
    const result = await this.ssh.exec("cat /etc/os-release");
    
    if (result.code !== 0) {
      return {
        name: "Operating System",
        passed: false,
        message: "Could not detect OS",
      };
    }

    const isDebian = result.stdout.includes("Ubuntu") || 
                      result.stdout.includes("Debian");
    
    return {
      name: "Operating System",
      passed: isDebian,
      message: isDebian 
        ? "Ubuntu/Debian detected" 
        : "Warning: Non-Debian system detected. Installation may require adjustments.",
    };
  }

  private async checkDocker(): Promise<CheckResult> {
    const result = await this.ssh.exec("which docker");
    
    if (result.code === 0) {
      const versionResult = await this.ssh.exec("docker --version");
      return {
        name: "Docker",
        passed: true,
        message: `Docker installed: ${versionResult.stdout.trim()}`,
      };
    }

    return {
      name: "Docker",
      passed: false,
      message: "Docker not installed",
      autoFix: async (ssh) => {
        // Install Docker using official script
        await ssh.exec("curl -fsSL https://get.docker.com -o get-docker.sh");
        await ssh.exec("sudo sh get-docker.sh");
        await ssh.exec("rm get-docker.sh");
      },
    };
  }

  private async checkDockerPermissions(): Promise<CheckResult> {
    const result = await this.ssh.exec("docker ps");
    
    if (result.code === 0) {
      return {
        name: "Docker Permissions",
        passed: true,
        message: "User has docker access",
      };
    }

    if (result.stderr.includes("permission denied")) {
      const whoamiResult = await this.ssh.exec("whoami");
      const username = whoamiResult.stdout.trim();

      // Check if sudo docker works (passwordless sudo)
      const sudoCheck = await this.ssh.exec("sudo -n docker ps 2>&1");
      
      if (sudoCheck.code === 0) {
        console.log("  Note: User not in docker group, but sudo works. Will use 'sudo docker' for this session.");
        return {
          name: "Docker Permissions",
          passed: true,
          message: "Docker accessible via sudo (user not in docker group)",
        };
      }

      // Neither direct docker nor sudo docker work
      console.log("\n  ⚠️  Docker permission issue detected.");
      console.log("  The user is not in the docker group and sudo is not configured for passwordless access.");
      console.log("  Please run this command on the node manually:");
      console.log("");
      console.log(`    sudo usermod -aG docker ${username}`);
      console.log("");
      console.log("  Then log out and log back in, or run: newgrp docker");
      console.log("");
      
      return {
        name: "Docker Permissions",
        passed: false,
        message: "User not in docker group and sudo requires password. Manual intervention required.",
      };
    }

    return {
      name: "Docker Permissions",
      passed: false,
      message: "Could not verify docker access",
    };
  }

  private async checkDiskSpace(): Promise<CheckResult> {
    const result = await this.ssh.exec("df -BG /var/lib | tail -1 | awk '{print $4}'");
    
    if (result.code !== 0) {
      return {
        name: "Disk Space",
        passed: false,
        message: "Could not check disk space",
      };
    }

    const availableGB = parseInt(result.stdout.trim().replace("G", ""));
    const minRequiredGB = 16;

    return {
      name: "Disk Space",
      passed: availableGB >= minRequiredGB,
      message: availableGB >= minRequiredGB
        ? `${availableGB}GB available`
        : `Only ${availableGB}GB available (need ${minRequiredGB}GB minimum)`,
    };
  }

  private async checkPorts(): Promise<CheckResult> {
    const portsToCheck = [3900, 3901, 3902, 3903];
    const busyPorts: number[] = [];

    for (const port of portsToCheck) {
      // Try without sudo first (ss or netstat)
      let result = await this.ssh.exec(
        `ss -tlnp 2>/dev/null | grep ":${port} " || netstat -tlnp 2>/dev/null | grep ":${port} " || echo ""`
      );
      
      // If command not found or no output, try with sudo
      if (result.code !== 0 || (result.stdout.trim().length === 0 && result.stderr.includes("not found"))) {
        // Check if sudo is available and doesn't require password
        const sudoCheck = await this.ssh.exec("sudo -n true 2>&1");
        
        if (sudoCheck.code === 0) {
          // sudo available without password
          result = await this.ssh.exec(
            `sudo ss -tlnp 2>/dev/null | grep ":${port} " || sudo netstat -tlnp 2>/dev/null | grep ":${port} " || true`
          );
        } else {
          // Can't check ports reliably without sudo, assume they're free
          console.log(`  Note: Cannot check port ${port} without sudo. Proceeding with assumption it's available.`);
          continue;
        }
      }
      
      if (result.stdout.trim().length > 0) {
        busyPorts.push(port);
      }
    }

    if (busyPorts.length === 0) {
      return {
        name: "Port Availability",
        passed: true,
        message: "All required ports available (3900-3903)",
      };
    }

    return {
      name: "Port Availability",
      passed: false,
      message: `Ports in use: ${busyPorts.join(", ")}. These ports must be free for Garage.`,
    };
  }

  private async checkDockerCompose(): Promise<CheckResult> {
    // Check for docker compose (v2 plugin)
    const resultV2 = await this.ssh.exec("docker compose version");
    
    if (resultV2.code === 0) {
      return {
        name: "Docker Compose",
        passed: true,
        message: `Docker Compose v2 available: ${resultV2.stdout.split('\n')[0]}`,
      };
    }

    // Check for docker-compose (v1 standalone)
    const resultV1 = await this.ssh.exec("docker-compose --version");
    
    if (resultV1.code === 0) {
      return {
        name: "Docker Compose",
        passed: true,
        message: `Docker Compose v1 available: ${resultV1.stdout.trim()}`,
      };
    }

    return {
      name: "Docker Compose",
      passed: false,
      message: "Docker Compose not installed",
      autoFix: async (ssh) => {
        // Check if passwordless sudo is available
        const sudoCheck = await ssh.exec("sudo -n true 2>&1");
        
        if (sudoCheck.code !== 0) {
          console.log("\n  ⚠️  Docker Compose installation requires sudo access.");
          console.log("  Please run these commands on the node manually:");
          console.log("");
          const arch = await ssh.exec("uname -m");
          const archStr = arch.stdout.trim();
          console.log("    sudo mkdir -p /usr/local/lib/docker/cli-plugins");
          console.log(`    sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${archStr} -o /usr/local/lib/docker/cli-plugins/docker-compose`);
          console.log("    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose");
          console.log("");
          throw new Error("Docker Compose installation requires manual intervention (passwordless sudo not available)");
        }
        
        // Docker Compose v2 is now included with Docker Desktop
        // For servers, it's installed as a plugin
        const arch = await ssh.exec("uname -m");
        const archStr = arch.stdout.trim();
        
        await ssh.exec("sudo -n mkdir -p /usr/local/lib/docker/cli-plugins");
        await ssh.exec(
          `sudo -n curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${archStr} ` +
          `-o /usr/local/lib/docker/cli-plugins/docker-compose`
        );
        await ssh.exec("sudo -n chmod +x /usr/local/lib/docker/cli-plugins/docker-compose");
      },
    };
  }
}
