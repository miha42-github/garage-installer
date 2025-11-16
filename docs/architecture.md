# Architecture Deep Dive

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

This document provides a comprehensive technical overview of the Garage Installer's architecture, design decisions, and implementation details.

## Table of Contents
- [Design Philosophy](#design-philosophy)
- [Module Architecture](#module-architecture)
- [Core Systems](#core-systems)
- [Deployment Flow](#deployment-flow)
- [Configuration Management](#configuration-management)
- [Security Architecture](#security-architecture)
- [File Structure](#file-structure)

---

## Design Philosophy

### Why Deno?

The installer is built with Deno for several strategic reasons:

**Single Binary Distribution**
- Compile to standalone executable with `deno compile`
- No runtime dependencies required on the user's machine
- Cross-platform support (Linux, macOS, Windows) from a single codebase
- Simplified distribution and installation

**TypeScript Native**
- Built-in TypeScript support without transpilation
- No build step required for development
- Type safety throughout the codebase
- Better IDE support and developer experience

**Dependency Management**
- No npm/node_modules complexity
- Direct URL imports with versioning
- Smaller footprint
- Faster startup time

**Security by Default**
- Explicit permissions model
- No accidental file system or network access
- Audit trail of what the program can access

### Why Docker?

Docker provides the deployment foundation:

**Non-Root Execution**
- Garage runs as unprivileged user inside containers
- Better security boundary than system-level services
- Reduced attack surface

**Dependency Isolation**
- No system package conflicts
- Clean separation from host system
- Consistent environment across all platforms

**Easy Cleanup**
- Remove everything with one command
- No leftover system packages or services
- Perfect for dev/test environments

**Version Control**
- Pin exact Garage versions
- Reproducible deployments
- Easy upgrades and rollbacks

---

## Module Architecture

The installer is organized into focused modules with clear responsibilities:

### src/wizard.ts
**Role**: Orchestration and user interaction

**Responsibilities**:
- Drive the installation workflow through phases
- Present CLI prompts and collect user input
- Coordinate between all other modules
- Handle state management and resume capability
- Manage error handling and recovery flows

**Key Interfaces**:
```typescript
interface NodeConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "key" | "password";
  keyPath?: string;
  password?: string;
}

interface ClusterConfig {
  rpcSecret: string;
  adminToken: string;
  capacityPerNode: string;
  workdir: string;
  garageVersion: string;
  replicationFactor: number;
  ports: { s3Api, rpc, s3Web, admin };
}
```

**Phases**:
1. Node Configuration - Collect SSH details
2. Connectivity Test - Verify SSH access
3. Preflight Checks - System validation
4. Cluster Configuration - Capacity, version, ports
5. Deployment - Docker and Garage setup
6. Cluster Setup - Connect nodes, apply layout
7. Validation - Health checks and AWS CLI test

### src/ssh/connection.ts
**Role**: SSH communication layer

**Responsibilities**:
- Establish and maintain SSH connections
- Execute remote commands with timeout handling
- Transfer files to remote hosts
- Provide consistent error handling and contexts
- Support both key-based and password authentication

**Features**:
- Configurable command timeouts
- Automatic cleanup of connections
- Detailed error contexts for debugging
- Support for both interactive and non-interactive commands

**Example**:
```typescript
const ssh = new SSHConnection(nodeConfig);
await ssh.connect();
const result = await ssh.exec("docker ps", { timeout: 10000 });
await ssh.writeFile("/path/to/file", content);
await ssh.disconnect();
```

### src/checks/system.ts
**Role**: Preflight validation

**Responsibilities**:
- Check operating system compatibility
- Verify Docker installation
- Validate Docker permissions
- Check disk space availability
- Test port availability
- Confirm Docker Compose presence

**Check Interface**:
```typescript
interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  autoFix?: (ssh: SSHConnection) => Promise<void>;
}
```

**Current Checks**:
- **Operating System**: Ubuntu/Debian detection (warns on others)
- **Docker**: Verifies installation and version
- **Docker Permissions**: Tests if user can run docker without sudo
- **Disk Space**: Minimum 16GB in home directory
- **Port Availability**: Ports 3900-3903 must be free
- **Docker Compose**: v1 or v2 plugin presence

### src/docker/manager.ts
**Role**: Docker operations

**Responsibilities**:
- Pull Docker images
- Deploy containers using Docker Compose
- Execute commands inside containers
- Check container health and status
- Retrieve container logs
- Dynamically detect sudo requirements

**Key Features**:
- **Sudo Detection**: Automatically uses `sudo docker` when needed
- **Compose Validation**: Validates docker-compose.yml syntax before deployment
- **Health Monitoring**: Wait for containers to become healthy
- **Log Retrieval**: Get container logs for debugging

**Example**:
```typescript
const docker = new DockerManager(ssh);
await docker.pullImage("dxflrs/garage:v2.1.0");
await docker.deployWithCompose(composeYaml, "/home/user/garage");
const logs = await docker.getContainerLogs("garage", 50);
```

### src/garage/cluster.ts
**Role**: Garage-specific operations

**Responsibilities**:
- Generate Garage configuration files (garage.toml)
- Generate Docker Compose files
- Retrieve node IDs
- Connect nodes via RPC
- Apply cluster layout
- Create admin credentials
- Verify cluster health

**Configuration Generation**:
```toml
# garage.toml structure
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
replication_factor = 2

[rpc]
rpc_secret = "<cryptographically-random-secret>"
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "<node-hostname>:3901"
bootstrap_peers = ["<peer1-id>@<peer1-host>:3901", ...]

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"

[s3_web]
bind_addr = "[::]:3902"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "<admin-token>"
```

**Bootstrap Peers**:
- Not included in initial configuration (empty bootstrap_peers)
- Retrieved after node IDs are obtained
- Added to config and containers restarted
- Enables automatic node discovery

### src/state.ts
**Role**: State persistence and resume capability

**Responsibilities**:
- Save installation progress to `.garage-installer-state.json`
- Enable resume from last checkpoint
- Track completed phases
- Store node and cluster configuration
- Support rollback and cleanup

**State Structure**:
```json
{
  "version": "1.0.0",
  "nodes": [
    {
      "name": "node1",
      "host": "192.168.1.100",
      "username": "ubuntu",
      "authMethod": "key"
    }
  ],
  "cluster": {
    "garageVersion": "v2.1.0",
    "workdir": "/home/ubuntu/garage",
    "replicationFactor": 2,
    "rpcSecret": "...",
    "capacity": "100G"
  },
  "phases": {
    "nodeConfig": "completed",
    "connectivity": "completed",
    "preflightChecks": "in-progress"
  },
  "lastUpdated": "2025-11-16T10:30:00Z"
}
```

**See [State Persistence & Resume](state-persistence.md) for details.**

### src/cleanup.ts
**Role**: Rollback and cleanup management

**Responsibilities**:
- Track deployed resources (containers, files, directories)
- Provide cleanup on failure
- Support manual uninstall
- Remove containers, volumes, and configuration

**Tracked Resources**:
- Docker containers
- Configuration files (garage.toml, docker-compose.yml)
- Data directories
- Metadata directories

**Example**:
```typescript
cleanupManager.trackContainer("node1", "garage");
cleanupManager.trackFile("node1", "/home/user/garage/garage.toml");
await cleanupManager.cleanupNode("node1");
```

### src/logger.ts
**Role**: Logging and audit trail

**Responsibilities**:
- Write detailed logs to `garage-installer.log`
- Timestamp all operations
- Capture errors with stack traces
- Provide searchable audit trail

**Log Levels**:
- INFO: Normal operations
- WARN: Non-fatal issues
- ERROR: Failures and exceptions

**Example Log**:
```
2025-11-16T10:30:15.234Z [INFO] === Garage Installer Started ===
2025-11-16T10:30:16.123Z [INFO] Connecting to node1 (192.168.1.100:22)
2025-11-16T10:30:17.456Z [INFO] SSH connection successful
2025-11-16T10:30:18.789Z [ERROR] Preflight check failed: Docker not installed
```

### src/ui/display.ts & src/ui/spinner.ts
**Role**: User interface and feedback

**Responsibilities**:
- Display formatted output with colors
- Show progress spinners for long operations
- Present results in tables
- Provide clear success/error messages

**Features**:
- ANSI color support
- Animated spinners for async operations
- Table formatting for check results
- Consistent visual hierarchy

---

## Core Systems

### State Management System

The state management system enables resume capability and tracks installation progress:

**Key Features**:
1. **Checkpoint Persistence** - Saves state after each major phase
2. **Resume Detection** - Detects incomplete installations on startup
3. **Phase Tracking** - Tracks completion status per phase
4. **Configuration Storage** - Preserves node and cluster config

**States**:
- `not-started` - Phase not yet begun
- `in-progress` - Phase currently executing
- `completed` - Phase successfully finished
- `failed` - Phase encountered error

**Resume Flow**:
1. Detect `.garage-installer-state.json`
2. Load previous state
3. Show user last completed phase
4. Offer to resume or start fresh
5. Skip completed phases
6. Continue from last checkpoint

### Cleanup System

The cleanup system provides automatic rollback on failure:

**Tracking**:
- Containers: `docker stop && docker rm`
- Files: `rm -f <file>`
- Directories: `rm -rf <directory>`
- Networks: Docker network cleanup

**Cleanup Triggers**:
- Fatal error during installation
- User cancellation (Ctrl+C)
- Manual uninstall command
- Failed validation

**Cleanup Sequence**:
1. Stop and remove containers
2. Remove configuration files
3. Remove data directories
4. Clean up Docker volumes
5. Report summary of cleaned resources

### Logging System

Comprehensive logging for troubleshooting and auditing:

**Log File**: `garage-installer.log` (current directory)

**What's Logged**:
- All SSH commands executed
- All command outputs (stdout/stderr)
- All errors with stack traces
- State transitions
- User inputs (except passwords)
- Timing information

**Usage**:
```bash
# View real-time logs
tail -f garage-installer.log

# Search for errors
grep ERROR garage-installer.log

# View specific phase
grep "Phase: deployment" garage-installer.log
```

### Error Handling

Consistent error handling throughout:

**Error Contexts**:
- SSH command failures include command, exit code, stderr
- Docker errors include container name and operation
- File operations include file path
- Network errors include hostname and port

**Recovery Strategies**:
1. **Retry with exponential backoff** - Transient network issues
2. **Suggest manual fix** - Permission issues, missing software
3. **Cleanup and exit** - Fatal errors
4. **Resume from checkpoint** - Partial failures

---

## Deployment Flow

### Complete Installation Sequence

```
┌─────────────────────────────────────────────────┐
│ 1. Node Configuration                           │
│    - Collect SSH details for both nodes         │
│    - Validate input format                      │
│    - Store in state                             │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│ 2. SSH Connectivity Test                        │
│    - Attempt SSH connection                     │
│    - Test authentication                        │
│    - Verify command execution                   │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│ 3. Preflight Checks (per node)                  │
│    - Check OS compatibility                     │
│    - Verify Docker installed                    │
│    - Check Docker permissions                   │
│    - Validate disk space (16GB+)                │
│    - Test port availability (3900-3903)         │
│    - Confirm Docker Compose present             │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│ 4. Cluster Configuration                        │
│    - Generate RPC secret (crypto random)        │
│    - Generate admin token                       │
│    - Select Garage version                      │
│    - Set capacity per node                      │
│    - Configure ports (or use defaults)          │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│ 5. Deployment (per node)                        │
│    - Create working directory                   │
│    - Generate garage.toml (no bootstrap peers)  │
│    - Generate docker-compose.yml                │
│    - Pull Garage Docker image                   │
│    - Deploy container                           │
│    - Wait for container healthy                 │
│    - Get node ID                                │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│ 6. Cluster Setup                                │
│    - Update configs with bootstrap peers        │
│    - Restart containers                         │
│    - Connect nodes via garage CLI               │
│    - Apply cluster layout                       │
│    - Wait for layout convergence                │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│ 7. Validation                                   │
│    - Check cluster status                       │
│    - Verify both nodes connected                │
│    - Create admin key                           │
│    - Test S3 API with AWS CLI                   │
│    - Display success message and credentials    │
└─────────────────────────────────────────────────┘
```

### Docker Compose Deployment Strategy

**Initial Deployment** (no bootstrap peers):
```yaml
services:
  garage:
    image: dxflrs/garage:v2.1.0
    container_name: garage
    restart: unless-stopped
    network_mode: host
    user: "1000:1000"
    volumes:
      - ./garage.toml:/etc/garage.toml:ro
      - /home/user/garage/meta:/var/lib/garage/meta
      - /home/user/garage/data:/var/lib/garage/data
    environment:
      - RUST_LOG=garage=info
    command: ["/garage", "server"]
```

**Key Design Decisions**:
- `network_mode: host` - Simplifies port management, avoids Docker networking
- `user: "UID:GID"` - Non-root container for security
- Config mounted read-only - Prevents accidental modification
- Named container - Simplifies command execution

**Bootstrap Peer Update**:
1. Deploy containers without bootstrap_peers
2. Retrieve node IDs using `docker exec garage /garage node id`
3. Update garage.toml with bootstrap_peers list
4. Restart containers with `docker compose restart`

This two-phase approach avoids chicken-and-egg problem of needing node IDs before deployment.

---

## Configuration Management

### Garage Configuration (garage.toml)

**Dynamic Elements**:
- `rpc_secret` - Generated using `crypto.getRandomValues()` (32 bytes hex)
- `admin_token` - Generated similarly
- `bootstrap_peers` - Populated after node ID retrieval
- `rpc_public_addr` - Uses user-provided hostname or IP
- User ID/GID - Retrieved from remote system

**Static Elements**:
- Ports (unless customized)
- Data/metadata paths
- S3 region name ("garage")
- IPv6 support (`[::]` bind addresses)

### Layout Configuration

**Two-Node Layout**:
```bash
# Both nodes get same capacity and zone
garage layout assign -z dc1 -c 100G <node1-id>
garage layout assign -z dc1 -c 100G <node2-id>

# Apply with version increment
garage layout apply --version 1
```

**Version Handling**:
- System automatically parses current version from `garage layout show`
- Increments by 1 for each apply
- Prevents version conflicts

**Capacity Parsing**:
- Supports human-readable format (100G, 1T, 500M)
- User input validated
- Applied equally to both nodes

---

## Security Architecture

### Secrets Generation

**RPC Secret** (inter-node authentication):
```typescript
const bytes = new Uint8Array(32);
crypto.getRandomValues(bytes);
const secret = Array.from(bytes)
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');
```

**Admin Token** (Admin API access):
- Same generation method as RPC secret
- Used for bucket/key management operations
- Transmitted only over TLS in production setups

### SSH Security

**Key-Based Authentication** (preferred):
- Private key never transmitted
- Supports standard key formats (RSA, Ed25519)
- Proper key permissions enforced (chmod 600)

**Password Authentication** (fallback):
- Never written to disk
- Never logged
- Cleared from memory after use
- Used only for session establishment

**Connection Security**:
- Compatible cipher negotiation
- Host key verification
- Timeout protection (default 30s per command)

### Container Security

**Non-Root Execution**:
- Container runs as user's UID:GID
- No privileged mode
- No capability additions

**Read-Only Configuration**:
- garage.toml mounted read-only
- Prevents config tampering from inside container

**Network Isolation**:
- Host networking for simplicity (dev/test focus)
- Production should use proper Docker networks
- Admin API exposed - user must firewall

### Credential Handling

**What's Stored in State File**:
- SSH hostnames, usernames, ports
- SSH key paths (not key contents)
- Garage configuration (including secrets)

**What's Never Stored**:
- SSH passwords
- Private key contents
- User input for sensitive prompts

**State File Protection**:
- Automatically added to .gitignore
- Recommended: chmod 600 .garage-installer-state.json

---

## File Structure

### Installer Source Code

```
garage-installer/
├── mod.ts                      # Entry point
├── deno.json                   # Deno configuration & tasks
├── README.md                   # Main documentation
├── FUTURES.md                  # Roadmap & planned features
├── DOC_UPDATES.md             # Documentation improvement plan
│
├── src/
│   ├── wizard.ts              # Main orchestration (2200+ lines)
│   ├── constants.ts           # Configuration constants
│   ├── state.ts               # State persistence system
│   ├── cleanup.ts             # Cleanup & rollback manager
│   ├── logger.ts              # Logging system
│   │
│   ├── ssh/
│   │   └── connection.ts      # SSH communication layer
│   │
│   ├── checks/
│   │   └── system.ts          # Preflight validation checks
│   │
│   ├── docker/
│   │   └── manager.ts         # Docker operations wrapper
│   │
│   ├── garage/
│   │   └── cluster.ts         # Garage-specific operations
│   │
│   └── ui/
│       ├── display.ts         # Output formatting
│       └── spinner.ts         # Progress indicators
│
├── scripts/
│   └── build.sh               # Cross-platform build script
│
└── docs/
    ├── README.md              # Documentation index
    ├── architecture.md        # This file
    ├── troubleshooting.md     # Comprehensive troubleshooting
    ├── aws-cli-configuration.md
    ├── nodejs-express-integration.md
    └── state-persistence.md
```

### Deployed Structure (per node)

```
~/garage/                       # Working directory
├── docker-compose.yml          # Docker Compose config
├── garage.toml                 # Garage configuration
├── meta/                       # Metadata directory (Docker volume)
└── data/                       # Data directory (Docker volume)
```

**Container Filesystem**:
```
/etc/garage.toml               # Config (mounted read-only)
/var/lib/garage/
  ├── meta/                    # Metadata storage
  └── data/                    # Data storage
/garage                        # Garage binary
```

---

## Performance Considerations

### SSH Connection Management

**Connection Pooling**:
- One connection per node maintained throughout installation
- Reused for multiple commands
- Properly closed on completion or error

**Timeout Configuration**:
- Default command timeout: 30 seconds
- Adjustable per command
- Prevents hanging on unresponsive commands

### Parallel Execution

**Where Used**:
- Preflight checks on both nodes (parallel)
- Deployment on both nodes (parallel)
- Container health checks (parallel)

**Where Serial**:
- Cluster layout application (must be sequential)
- Bootstrap peer configuration (requires all node IDs first)

### Resource Usage

**Installer**:
- Minimal CPU usage
- ~50MB memory footprint
- Network: SSH bandwidth only
- No disk writes except logs and state file

**Deployed Garage**:
- See Garage documentation for resource requirements
- Typically 1-2GB RAM per node
- CPU usage depends on workload

---

## Extension Points

### Adding New Checks

To add a system check:

```typescript
// In src/checks/system.ts
private async checkMemory(): Promise<CheckResult> {
  const result = await this.ssh.exec("free -g | awk '/^Mem:/{print $2}'");
  const memoryGB = parseInt(result.stdout.trim());
  
  return {
    name: "System Memory",
    passed: memoryGB >= 2,
    message: memoryGB >= 2 
      ? `${memoryGB}GB RAM available` 
      : `Only ${memoryGB}GB RAM (need 2GB+)`,
  };
}

// Add to runAll()
async runAll(): Promise<CheckResult[]> {
  const checks = [
    // ... existing checks
    this.checkMemory(),
  ];
  return await Promise.all(checks);
}
```

### Adding New Phases

To add a phase to the installation:

```typescript
// In src/wizard.ts
async runMyNewPhase() {
  this.stateManager.startPhase("myNewPhase");
  
  try {
    // Your phase logic here
    
    this.stateManager.completePhase("myNewPhase");
  } catch (error) {
    this.stateManager.failPhase("myNewPhase");
    throw error;
  }
}

// Add to main run() method
await this.runMyNewPhase();
```

---

## Related Documentation

- **[Troubleshooting Guide](troubleshooting.md)** - Common issues and solutions
- **[State Persistence](state-persistence.md)** - Resume capability details
- **[Cluster Management](cluster-management.md)** - Day-2 operations *(coming soon)*
- **[AWS CLI Configuration](aws-cli-configuration.md)** - S3 API access
- **[Node.js Integration](nodejs-express-integration.md)** - Backend integration

---

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
