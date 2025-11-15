import type { SSHConnection } from "../ssh/connection.ts";

export class DockerManager {
  private useSudo: boolean = false;

  constructor(private ssh: SSHConnection) {}

  /**
   * Check if we need to use sudo for docker commands
   */
  async detectSudoRequirement(): Promise<void> {
    // Try docker without sudo first
    const result = await this.ssh.exec("docker ps 2>&1");
    
    if (result.code === 0) {
      this.useSudo = false;
      return;
    }

    // If it failed with permission denied, try with sudo
    if (result.stderr.includes("permission denied") || result.stdout.includes("permission denied")) {
      const sudoResult = await this.ssh.exec("sudo docker ps 2>&1");
      if (sudoResult.code === 0) {
        this.useSudo = true;
        return;
      }
    }

    // If both failed, don't use sudo (will fail with better error message)
    this.useSudo = false;
  }

  /**
   * Execute a docker command, automatically adding sudo if needed
   */
  private async dockerExec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const fullCommand = this.useSudo ? `sudo ${command}` : command;
    return await this.ssh.exec(fullCommand);
  }

  async pullImage(image: string): Promise<void> {
    const result = await this.dockerExec(`docker pull ${image}`);
    if (result.code !== 0) {
      throw new Error(`Failed to pull image: ${result.stderr}`);
    }
  }

  async createNetwork(name: string): Promise<void> {
    // Check if network exists
    const checkResult = await this.dockerExec(
      `docker network ls | grep ${name} || true`
    );

    if (checkResult.stdout.includes(name)) {
      return; // Network already exists
    }

    const result = await this.dockerExec(`docker network create ${name}`);
    if (result.code !== 0) {
      throw new Error(`Failed to create network: ${result.stderr}`);
    }
  }

  async stopContainer(name: string): Promise<void> {
    // Silently fail if container doesn't exist
    await this.dockerExec(`docker stop ${name} 2>/dev/null || true`);
  }

  async removeContainer(name: string): Promise<void> {
    // Silently fail if container doesn't exist
    await this.dockerExec(`docker rm ${name} 2>/dev/null || true`);
  }

  async containerExists(name: string): Promise<boolean> {
    // Use docker ps filter for exact name match
    const result = await this.dockerExec(
      `docker ps -a --filter "name=^${name}$" --format "{{.Names}}"`
    );
    return result.stdout.trim() === name;
  }

  async containerRunning(name: string): Promise<boolean> {
    // Use docker ps filter for exact name match (only running containers)
    const result = await this.dockerExec(
      `docker ps --filter "name=^${name}$" --format "{{.Names}}"`
    );
    return result.stdout.trim() === name;
  }

  async deployWithCompose(composeContent: string, workdir: string): Promise<void> {
    // Create working directory
    await this.ssh.exec(`mkdir -p ${workdir}`);

    // Write compose file
    await this.ssh.writeFile(`${workdir}/docker-compose.yml`, composeContent);

    // Deploy using docker compose
    const result = await this.dockerExec(`cd ${workdir} && docker compose up -d`);
    
    if (result.code !== 0) {
      throw new Error(`Failed to deploy: ${result.stderr}`);
    }
  }

  async getContainerLogs(name: string, lines: number = 50): Promise<string> {
    const result = await this.dockerExec(`docker logs --tail ${lines} ${name}`);
    return result.stdout + result.stderr;
  }

  async execInContainer(
    container: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return await this.dockerExec(`docker exec ${container} ${command}`);
  }

  async waitForHealthy(
    container: string,
    timeoutSeconds: number = 60
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      try {
        const result = await this.execInContainer(container, "garage status");
        if (result.code === 0) {
          return true;
        }
      } catch {
        // Container not ready yet
      }
      
      // Wait 2 seconds before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return false;
  }

  async getContainerIP(container: string): Promise<string> {
    const result = await this.dockerExec(
      `docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${container}`
    );
    
    if (result.code !== 0) {
      throw new Error(`Failed to get container IP: ${result.stderr}`);
    }
    
    return result.stdout.trim();
  }
}
