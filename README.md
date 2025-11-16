# Garage Cluster Installer

**One binary. Two nodes. Zero hassle.**

Interactive wizard that deploys a two-node dev/test Garage S3-compatible object storage cluster on Ubuntu/Debian nodes using Docker.

## Features

- ✅ Interactive CLI wizard - no config files needed
- ✅ Automated SSH connectivity and key management
- ✅ Pre-flight system checks with auto-fix
- ✅ Docker-based deployment (non-root)
- ✅ State persistence with resume capability
- ✅ Single compiled binary - no dependencies
- ✅ Cross-platform (Linux, macOS, Windows)
- ✅ Automatic rollback on failure
- ✅ IPv6 and dual-stack support
- ✅ Comprehensive logging and troubleshooting

## Documentation

📚 **[Complete Documentation →](docs/README.md)**

- **Configuration Guides**
  - [AWS CLI Configuration](docs/aws-cli-configuration.md) - Setup and usage with Garage
  - [Node.js + Express Integration](docs/nodejs-express-integration.md) - Backend integration patterns
  
- **Operations**
  - [Troubleshooting Guide](docs/troubleshooting.md) - Comprehensive problem resolution
  - [State Persistence & Resume](docs/state-persistence.md) - Checkpoint and recovery

- **Project Information**
  - [Future Roadmap](FUTURES.md) - Planned features and improvements
  - [Contributing](CONTRIBUTING.md) - How to contribute
  - [Changelog](CHANGELOG.md) - Version history

## Why This Installer?

### Why Deno?
- **Single binary** - Compile to standalone executable, no runtime needed
- **TypeScript native** - Built-in support, no build step
- **No dependencies hell** - No npm/node_modules, cleaner deployment
- **Cross-platform** - Works on Linux, macOS, Windows out of the box

### Why Docker?
- **Non-root execution** - Better security boundary
- **Dependency isolation** - No system package conflicts
- **Easy cleanup** - Remove everything with one command
- **Consistent environment** - Same setup across all platforms
- **Version pinning** - Control exactly what gets deployed

### Deployment Model
```
[Your Machine]
    └── garage-installer binary
        ├── SSH to Node 1
        │   ├── Preflight checks
        │   ├── Docker setup
        │   └── Deploy container
        ├── SSH to Node 2
        │   ├── Preflight checks
        │   ├── Docker setup
        │   └── Deploy container
        └── Configure Cluster
            ├── Connect nodes
            ├── Apply layout
            └── Verify health
```

## Quick Start
**NOTE**: binaries for the installer aren't yet available. This practically means that you must pull the source code, make sure that Deno is installed, and run from source.  Instructions for installing Deno can be found below in the [Development > Prerequisites](https://github.com/miha42-github/garage-installer/blob/main/README.md#prerequisites-1).

```bash
git clone https://github.com/miha42-github/garage-installer.git
cd garage-installer
deno task dev
```

### Download
**WARNING**: Not yet available documentation in this section is not correct.

```bash
# Linux
wget https://github.com/miha42-github/garage-installer/releases/latest/download/garage-installer-linux-x64
chmod +x garage-installer-linux-x64

# macOS
wget https://github.com/miha42-github/garage-installer/releases/latest/download/garage-installer-macos-x64
chmod +x garage-installer-macos-x64
```

### Run
**WARNING**: Not yet available documentation in this section is not correct.

```bash
./garage-installer-linux-x64
```

That's it! The wizard will guide you through:

1. **Node Discovery** - Enter SSH details for both nodes
2. **Connectivity Test** - Verify SSH access
3. **Pre-flight Checks** - System validation with auto-fix
4. **Configuration** - Storage capacity and settings
5. **Deployment** - Docker container setup
6. **Cluster Setup** - Node connection and layout
7. **Verification** - Health checks and endpoint display

## Prerequisites

### Local Machine (where you run the installer)
- SSH client
- Network access to both nodes
- SSH credentials (key or password)
- **AWS CLI** (required for validation) - `brew install awscli` or `pip install awscli`
- **No other dependencies needed** - the installer is a single binary

### Remote Nodes (where Garage will run)
- Ubuntu 20.04+ or Debian 11+ (recommended)
- SSH server running
- Same user account on both nodes
- **Docker installed** - See [installation guide](docs/troubleshooting.md#installing-prerequisites)
- **Docker Compose installed** - See [installation guide](docs/troubleshooting.md#installing-prerequisites)
- User added to `docker` group (non-root Docker access)
- At least 16GB disk space per node
- Ports 3900-3903 available
- Internet access to pull Docker images

> **Note:** Docker and Docker Compose require manual installation on the remote nodes before running the installer. The installer cannot install them automatically as this requires sudo privileges with interactive password entry. See the [Installing Prerequisites](docs/troubleshooting.md#installing-prerequisites) section in the troubleshooting guide for detailed instructions.

**The installer will automatically:**
- Verify Docker and Docker Compose are installed
- Download Garage Docker image from Docker Hub
- Configure Docker permissions (detect if sudo is needed)
- Set up all required directories
- Deploy and configure Garage cluster

## What Gets Installed

On each node, the installer will:
1. **Download Garage Docker image** - `dxflrs/garage:v2.1.0` (default, configurable)
2. **Create directory structure:**
```
~/garage/
├── docker-compose.yml
├── garage.toml
└── [Docker volumes for data/metadata]
```

Docker containers:
- `garage` - Garage S3 server (non-root, host networking)

Ports used:
- 3900: S3 API endpoint
- 3901: RPC (inter-node communication)
- 3902: S3 website hosting
- 3903: Admin API / Prometheus metrics

## Post-Installation

After successful installation, you'll have access to Garage's S3 API.

**💡 For complete integration examples, see the [examples/](examples/) directory (AWS CLI and Node.js).**

### Quick Start with AWS CLI

```bash
# Configure (credentials provided by installer)
aws configure set aws_access_key_id YOUR_ACCESS_KEY
aws configure set aws_secret_access_key YOUR_SECRET_KEY
aws configure set default.region garage
aws configure set default.s3.addressing_style path

# Create bucket and upload
aws s3 mb s3://my-bucket --endpoint-url http://NODE_IP:3900
echo "Hello Garage" > test.txt
aws s3 cp test.txt s3://my-bucket/ --endpoint-url http://NODE_IP:3900
```

📚 **See [AWS CLI Configuration Guide](docs/aws-cli-configuration.md) for complete setup instructions.**

### Management Commands

```bash
# Check cluster status
ssh user@node1 "docker exec garage /garage status"

# View logs
ssh user@node1 "docker logs garage"

# Restart cluster
ssh user@node1 "cd ~/garage && docker compose restart"
```

📚 **For day-2 operations, see the [Troubleshooting Guide](docs/troubleshooting.md).**

## Troubleshooting

**Common issues and quick fixes:**

### SSH Connection Fails
```bash
# Check SSH access
ssh user@hostname

# Verify key permissions
chmod 600 ~/.ssh/id_rsa
```

### Docker Permission Denied
```bash
# Add user to docker group (requires re-login)
sudo usermod -aG docker $USER
```

### Ports Already in Use
```bash
# Find what's using the port
sudo ss -tlnp | grep 3900
```

### Nodes Can't Reach Each Other
```bash
# Test connectivity
ping node2-hostname

# Check firewall (allow port 3901 for RPC)
sudo ufw allow 3901/tcp
```

📚 **For comprehensive troubleshooting, see the [Troubleshooting Guide](docs/troubleshooting.md).**

## Development

### Prerequisites

**Deno 1.40+** is required to build from source.

Install Deno:
```bash
# macOS / Linux
curl -fsSL https://deno.land/install.sh | sh

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex

# Or via package managers:
# macOS: brew install deno
# Linux: snap install deno
# Windows: choco install deno
```

See https://deno.land/manual/getting_started/installation for more options.

### Run from source
```bash
git clone https://github.com/miha42-github/garage-installer.git
cd garage-installer
deno task dev
```

### Build
```bash
# Linux binary
deno task compile-linux

# macOS binary
deno task compile-macos

# Windows binary
deno task compile-windows

# All platforms
deno task build-all
```

Binaries will be in `dist/` directory.

## Security Considerations

The installer follows security best practices:

- **Non-root containers** - Garage runs as unprivileged user inside Docker
- **Read-only configs** - Configuration files mounted read-only
- **Secure secrets** - RPC secret generated using cryptographic randomness
- **SSH key preference** - Prefers SSH keys over passwords
- **No credential storage** - Passwords never written to disk
- **Minimal permissions** - Only requests what's needed

**Network Security:**
- Installer warns if nodes are on public IPs
- All inter-node communication encrypted via Garage's built-in RPC
- Admin API (port 3903) bound to all interfaces - use firewall rules to restrict

## Limitations & Use Cases

### Two-Node Clusters
- ⚠️ **Not production-ready** - Requires 3+ nodes for fault tolerance
- ✅ **Perfect for dev/test** - Fast setup, easy teardown
- ✅ **Learning Garage** - Understand S3 operations
- ⚠️ **Read-only on failure** - If one node dies, cluster is read-only

### When to Use This
- Development and testing
- Learning S3-compatible storage
- Proof of concept deployments
- Local testing environments

### When NOT to Use This
- Production workloads (use 3+ nodes)
- Business-critical data storage
- High availability requirements

## What's Next?

After installing your cluster:

1. **Try it out** - Upload and download files with AWS CLI
2. **Integrate** - Connect your applications using the [Node.js + Express guide](docs/nodejs-express-integration.md)
3. **Monitor** - Access metrics endpoint on port 3903
4. **Plan ahead** - See [FUTURES.md](FUTURES.md) for roadmap and upcoming features

📚 **See [FUTURES.md](FUTURES.md)** for the complete development roadmap and planned features.

## Support & Community

- **Documentation**: https://garagehq.deuxfleurs.fr/documentation/
- **Garage Project**: https://garagehq.deuxfleurs.fr/
- **Matrix Chat**: #garage:deuxfleurs.fr
- **Issues**: https://github.com/miha42-github/garage-installer/issues

## Credits

- **Garage S3** - Deuxfleurs (https://garagehq.deuxfleurs.fr)
- **Funding** - EU Next Generation Internet Program
- **Installer** - Community-driven

---

**Remember**: This installer creates a two-node cluster for development and testing. For production, deploy at least 3 nodes in different physical locations for proper fault tolerance.

Garage itself is licensed under AGPLv3.

## Credits

- **Garage** - Deuxfleurs (https://garagehq.deuxfleurs.fr)
- **Funding** - EU Next Generation Internet Program
- **Installer** - Community-driven

## Support

- Documentation: https://garagehq.deuxfleurs.fr/documentation/
- Matrix: #garage:deuxfleurs.fr
- Issues: https://github.com/YOUR_USERNAME/garage-installer/issues

---

**Remember**: This installer creates a two-node cluster. It's not production-ready. For production, deploy at least 3 nodes in different physical locations.

But for learning, testing, or development? This is a quick way to get started with Garage.
