import type { SSHConnection } from "../ssh/connection.ts";

export class DockerManager {
  constructor(private ssh: SSHConnection) {}

  async pullImage(image: string): Promise<void> {
    const result = await this.ssh.exec(`docker pull ${image}`);
    if (result.code !== 0) {
      throw new Error(`Failed to pull image: ${result.stderr}`);
    }
  }

  async createNetwork(name: string): Promise<void> {
    // Check if network exists
    const checkResult = await this.ssh.exec(
      `docker network ls | grep ${name} || true`
    );

    if (checkResult.stdout.includes(name)) {
      return; // Network already exists
    }

    const result = await this.ssh.exec(`docker network create ${name}`);
    if (result.code !== 0) {
      throw new Error(`Failed to create network: ${result.stderr}`);
    }
  }

  async stopContainer(name: string): Promise<void> {
    // Silently fail if container doesn't exist
    await this.ssh.exec(`docker stop ${name} 2>/dev/null || true`);
  }

  async removeContainer(name: string): Promise<void> {
    // Silently fail if container doesn't exist
    await this.ssh.exec(`docker rm ${name} 2>/dev/null || true`);
  }

  async containerExists(name: string): Promise<boolean> {
    const result = await this.ssh.exec(
      `docker ps -a | grep ${name} || echo "not_found"`
    );
    return !result.stdout.includes("not_found");
  }

  async containerRunning(name: string): Promise<boolean> {
    const result = await this.ssh.exec(
      `docker ps | grep ${name} || echo "not_running"`
    );
    return !result.stdout.includes("not_running");
  }

  async deployWithCompose(composeContent: string, workdir: string): Promise<void> {
    // Create working directory
    await this.ssh.exec(`mkdir -p ${workdir}`);

    // Write compose file
    await this.ssh.writeFile(`${workdir}/docker-compose.yml`, composeContent);

    // Deploy using docker compose
    const result = await this.ssh.exec(`cd ${workdir} && docker compose up -d`);
    
    if (result.code !== 0) {
      throw new Error(`Failed to deploy: ${result.stderr}`);
    }
  }

  async getContainerLogs(name: string, lines: number = 50): Promise<string> {
    const result = await this.ssh.exec(`docker logs --tail ${lines} ${name}`);
    return result.stdout + result.stderr;
  }

  async execInContainer(
    container: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return await this.ssh.exec(`docker exec ${container} ${command}`);
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
    const result = await this.ssh.exec(
      `docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${container}`
    );
    
    if (result.code !== 0) {
      throw new Error(`Failed to get container IP: ${result.stderr}`);
    }
    
    return result.stdout.trim();
  }
}
