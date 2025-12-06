import type { SSHConnection } from "../ssh/connection.ts";

export class DockerManager {
  constructor(private ssh: SSHConnection) {}

  /**
   * Execute a docker command
   * NOTE: Assumes user is already in docker group or has docker access configured
   */
  private async dockerExec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return await this.ssh.exec(command);
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

  async restartContainer(name: string): Promise<void> {
    const result = await this.dockerExec(`docker restart ${name}`);
    if (result.code !== 0) {
      throw new Error(`Failed to restart container: ${result.stderr}`);
    }
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

    // Validate compose file before deployment
    const validateResult = await this.dockerExec(`cd ${workdir} && docker compose config 2>&1`);
    
    if (validateResult.code !== 0) {
      // Parse and display validation errors
      const errorLines = validateResult.stderr.split('\n').filter(line => line.trim().length > 0);
      const errorMessage = errorLines.slice(0, 5).join('\n  '); // Show first 5 error lines
      
      throw new Error(
        `Docker Compose configuration is invalid:\n  ${errorMessage}\n\nPlease check the compose file at ${workdir}/docker-compose.yml`
      );
    }

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
        // Check if container is running
        const result = await this.dockerExec(`docker ps --filter name=${container} --filter status=running --format '{{.Names}}'`);
        
        if (result.code === 0 && result.stdout.trim() === container) {
          // Container is running, wait a bit more to ensure it's stable
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Check if it's still running
          const recheck = await this.dockerExec(`docker ps --filter name=${container} --filter status=running --format '{{.Names}}'`);
          if (recheck.code === 0 && recheck.stdout.trim() === container) {
            return true;
          }
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
