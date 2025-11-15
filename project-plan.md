# Garage Cluster Installer - Project Plan

## Overview
Interactive CLI wizard in Deno that sets up a two-node Garage cluster with:
- SSH key management and node connectivity
- Pre-flight system checks
- Docker-based deployment (non-root)
- Automated configuration
- Single compiled binary for easy distribution

## Architecture Decisions

### Why Deno?
- Single binary compilation (deno compile)
- Built-in TypeScript support
- No npm/node_modules hell
- Built-in SSH client support
- Good CLI libraries available
- Cross-platform (Linux, macOS, Windows)

### Why Docker?
- Non-root execution
- Dependency isolation (no system package conflicts)
- Easy cleanup/uninstall
- Consistent environment
- Version pinning
- Better security boundary

### Deployment Model
```
[User's Machine]
    └── garage-installer binary
        ├── SSH to Node 1
        │   ├── Preflight checks
        │   ├── Docker setup
        │   └── Deploy container
        └── SSH to Node 2
            ├── Preflight checks
            ├── Docker setup
            └── Deploy container
        └── Configure cluster
            ├── Connect nodes
            ├── Apply layout
            └── Verify health
```

## Wizard Flow

### Phase 1: Welcome & Preflight
1. Welcome message
2. Check if running from correct location
3. Verify local requirements:
   - SSH client available
   - Network connectivity
   - Sufficient permissions

### Phase 2: Node Discovery
1. Ask for Node 1 details:
   - Hostname/IP
   - SSH port (default 22)
   - Username
   - Auth method (password/key)
2. Test SSH connectivity to Node 1
3. Repeat for Node 2
4. Offer to setup SSH keys between nodes

### Phase 3: Node Preflight Checks
For each node:
1. Check OS (Ubuntu/Debian preferred)
2. Check Docker installed (offer to install)
3. Check Docker permissions (offer to add user to docker group)
4. Check available disk space
5. Check required ports available (3900-3903)
6. Check network connectivity between nodes

### Phase 4: Configuration
1. Ask for storage capacity per node
2. Generate RPC secret
3. Ask for additional settings:
   - Custom ports? (default no)
   - Data directory location
   - Metadata directory location
   - Enable metrics? (default yes)

### Phase 5: Deployment
1. Show summary of configuration
2. Confirm deployment
3. Deploy Docker containers to both nodes:
   - Pull Garage image
   - Create volumes
   - Generate configs
   - Start containers
4. Show progress with spinners/progress bars

### Phase 6: Cluster Configuration
1. Wait for nodes to be healthy
2. Connect nodes to each other
3. Configure cluster layout
4. Apply layout
5. Verify cluster health

### Phase 7: Post-Install
1. Display cluster status
2. Show how to create first bucket
3. Display S3 endpoint URLs
4. Offer to create test bucket/key
5. Save configuration to file
6. Display management commands

## Technical Components

### SSH Management
```typescript
- SSHConnection class
  - connect(host, port, user, auth)
  - executeCommand(cmd)
  - uploadFile(local, remote)
  - downloadFile(remote, local)
  - testConnectivity()
```

### Preflight Checks
```typescript
- SystemCheck class
  - checkOS()
  - checkDocker()
  - checkPorts()
  - checkDiskSpace()
  - checkNetworking()
```

### Docker Management
```typescript
- DockerManager class
  - pullImage()
  - createVolume()
  - createContainer()
  - startContainer()
  - getContainerStatus()
  - getContainerLogs()
```

### Garage Management
```typescript
- GarageCluster class
  - generateRPCSecret()
  - generateConfig()
  - deployNode()
  - connectNodes()
  - applyLayout()
  - getStatus()
```

### UI Components
```typescript
- Interactive prompts (cliffy)
- Progress indicators
- Color-coded output
- Table displays for status
- Confirmation dialogs
```

## Docker Compose Strategy

Instead of raw docker commands, use docker-compose for easier management:

```yaml
version: '3.8'
services:
  garage:
    image: dxflrs/garage:v2.1.0
    container_name: garage
    restart: unless-stopped
    network_mode: host
    user: "1000:1000"  # Non-root
    volumes:
      - ./garage.toml:/etc/garage.toml:ro
      - garage-meta:/var/lib/garage/meta
      - garage-data:/var/lib/garage/data
    environment:
      - RUST_LOG=garage=info

volumes:
  garage-meta:
    driver: local
  garage-data:
    driver: local
```

## Security Considerations

1. **SSH Key Management**
   - Generate keys if needed
   - Use ed25519 (modern, secure)
   - Store keys in ~/.ssh/garage-cluster/
   - Set proper permissions (600)

2. **Docker Security**
   - Run as non-root user inside container
   - Use read-only config mounts
   - No privileged mode
   - Limited capabilities

3. **Network Security**
   - Warn if nodes on public IPs
   - Suggest firewall rules
   - Generate strong RPC secret

4. **Credential Storage**
   - Never store passwords in plain text
   - Use SSH keys preferentially
   - Warn about saving config files

## Error Handling

### Graceful Failures
- If SSH fails: retry with detailed error
- If Docker not installed: offer installation
- If ports busy: show what's using them
- If insufficient space: show requirements
- If nodes can't connect: network diagnostics

### Rollback Capability
- Track deployment state
- Offer cleanup on failure
- Save logs for debugging
- Provide manual recovery steps

## File Structure

```
garage-installer/
├── deno.json                  # Deno config
├── mod.ts                     # Main entry point
├── src/
│   ├── wizard.ts             # Main wizard flow
│   ├── ssh/
│   │   ├── connection.ts     # SSH connectivity
│   │   └── keygen.ts         # Key generation
│   ├── checks/
│   │   ├── system.ts         # System preflight
│   │   └── docker.ts         # Docker checks
│   ├── docker/
│   │   ├── manager.ts        # Docker operations
│   │   └── compose.ts        # Compose file generation
│   ├── garage/
│   │   ├── cluster.ts        # Cluster management
│   │   ├── config.ts         # Config generation
│   │   └── commands.ts       # Garage CLI wrapper
│   └── ui/
│       ├── prompts.ts        # Interactive prompts
│       ├── display.ts        # Status displays
│       └── progress.ts       # Progress indicators
├── templates/
│   ├── garage.toml.template
│   └── docker-compose.yml.template
└── scripts/
    └── build.sh              # Compile script
```

## Dependencies (Deno)

```typescript
// deno.json
{
  "tasks": {
    "dev": "deno run --allow-all mod.ts",
    "compile": "deno compile --allow-all --output=garage-installer mod.ts"
  },
  "imports": {
    "cliffy": "https://deno.land/x/cliffy@v1.0.0-rc.3/mod.ts",
    "ssh2": "npm:ssh2@1.15.0",
    "colors": "https://deno.land/std@0.208.0/fmt/colors.ts"
  }
}
```

## Build & Distribution

```bash
# Development
deno task dev

# Compile for Linux
deno compile --allow-all --target x86_64-unknown-linux-gnu \
  --output=dist/garage-installer-linux-x64 mod.ts

# Compile for macOS
deno compile --allow-all --target x86_64-apple-darwin \
  --output=dist/garage-installer-macos-x64 mod.ts

# Compile for Windows
deno compile --allow-all --target x86_64-pc-windows-msvc \
  --output=dist/garage-installer-windows-x64.exe mod.ts
```

## Usage

```bash
# Download single binary
wget https://github.com/user/garage-installer/releases/latest/download/garage-installer-linux-x64

# Make executable
chmod +x garage-installer-linux-x64

# Run
./garage-installer-linux-x64

# That's it - fully interactive wizard from here
```

## Testing Strategy

1. **Unit Tests**: Individual components
2. **Integration Tests**: SSH connectivity, Docker operations
3. **E2E Tests**: Full wizard flow on test VMs
4. **Manual Testing**: Real hardware validation

## Documentation

1. README.md with quick start
2. ARCHITECTURE.md with technical details
3. TROUBLESHOOTING.md for common issues
4. Video walkthrough (optional)

## Future Enhancements

1. Support for 3+ node clusters
2. Cluster upgrade wizard
3. Backup/restore functionality
4. Web UI option
5. Monitoring setup (Prometheus/Grafana)
6. TLS/SSL certificate management
7. Cloud provider integration (AWS, GCP, etc.)

## Implementation Priority

Phase 1 (MVP):
- Basic wizard flow
- SSH connectivity
- Docker deployment
- Cluster setup

Phase 2 (Polish):
- Better error handling
- Preflight checks
- Progress indicators
- Status displays

Phase 3 (Advanced):
- SSH key management
- Rollback capability
- Test suite
- Documentation

