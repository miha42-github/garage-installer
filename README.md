# Garage Cluster Installer

**One binary. Two nodes. Zero hassle.**

Interactive wizard that deploys a production-ready Garage S3-compatible object storage cluster on two Ubuntu nodes using Docker.

## Features

- ✅ Interactive CLI wizard - no config files needed
- ✅ Automated SSH connectivity and key management
- ✅ Pre-flight system checks with auto-fix
- ✅ Docker-based deployment (non-root)
- ✅ Complete cluster configuration
- ✅ Single compiled binary - no dependencies
- ✅ Cross-platform (Linux, macOS, Windows)

## Quick Start

### Download

```bash
# Linux
wget https://github.com/YOUR_USERNAME/garage-installer/releases/latest/download/garage-installer-linux-x64
chmod +x garage-installer-linux-x64

# macOS
wget https://github.com/YOUR_USERNAME/garage-installer/releases/latest/download/garage-installer-macos-x64
chmod +x garage-installer-macos-x64
```

### Run

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

### Remote Nodes (where Garage will run)
- Ubuntu 20.04+ or Debian 11+ (recommended)
- SSH server running
- Same user account on both nodes
- At least 16GB disk space per node
- Ports 3900-3903 available

**The installer will automatically:**
- Install Docker if not present
- Install Docker Compose if not present
- Configure Docker permissions
- Set up all required directories
- Deploy and configure Garage cluster

## What Gets Installed

On each node:
```
/opt/garage/
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

After successful installation, you can:

### Create a bucket
```bash
ssh user@node1
docker exec garage garage bucket create my-bucket
```

### Create access key
```bash
docker exec garage garage key create my-key
```

### Grant permissions
```bash
docker exec garage garage bucket allow my-bucket --read --write --key my-key
```

### Get credentials
```bash
docker exec garage garage key info my-key
# Save the Access Key ID and Secret Access Key
```

### Use with AWS CLI
```bash
aws configure set aws_access_key_id YOUR_ACCESS_KEY
aws configure set aws_secret_access_key YOUR_SECRET_KEY
aws configure set default.region garage

# Test
echo "Hello Garage" > test.txt
aws s3 cp test.txt s3://my-bucket/ --endpoint-url http://NODE_IP:3900
aws s3 ls s3://my-bucket/ --endpoint-url http://NODE_IP:3900
```

## Management

### Check cluster status
```bash
ssh user@node1
docker exec garage garage status
```

### View logs
```bash
docker logs -f garage
```

### Restart Garage
```bash
cd /opt/garage
docker compose restart
```

### Stop Garage
```bash
cd /opt/garage
docker compose stop
```

### Update Garage version
Edit `/opt/garage/docker-compose.yml`, change image version, then:
```bash
docker compose pull
docker compose up -d
```

## Troubleshooting

### SSH connection fails
- Verify SSH credentials
- Check firewall rules (port 22)
- Ensure SSH key permissions are 600

### Docker installation fails
- Check internet connectivity on nodes
- Verify package manager works
- May need to manually install Docker first

### Ports already in use
- Check what's using ports: `sudo ss -tlnp | grep 3900`
- Stop conflicting services
- Or modify ports in configuration

### Nodes can't see each other
- Verify network connectivity: `ping node2` from node1
- Check firewall allows port 3901
- Ensure correct IP addresses configured

### Container won't start
- Check logs: `docker logs garage`
- Verify directory permissions
- Check disk space: `df -h`

## Development

### Prerequisites
- Deno 1.40+

### Run from source
```bash
git clone https://github.com/YOUR_USERNAME/garage-installer.git
cd garage-installer
deno task dev
```

### Build
```bash
# Linux binary
deno task compile-linux

# macOS binary
deno task compile-macos

# All platforms
deno task build-all
```

Binaries will be in `dist/` directory.

## Architecture

```
garage-installer (Deno binary)
    │
    ├── SSH to Node 1
    │   ├── Pre-flight checks (OS, Docker, ports, disk)
    │   ├── Auto-fix issues (install Docker, etc.)
    │   ├── Deploy container (docker-compose)
    │   └── Start Garage
    │
    ├── SSH to Node 2
    │   ├── Pre-flight checks
    │   ├── Auto-fix issues
    │   ├── Deploy container
    │   └── Start Garage
    │
    └── Configure cluster
        ├── Get node IDs
        ├── Connect nodes
        ├── Assign zones
        ├── Apply layout
        └── Verify health
```

## Security

- Runs Garage as non-root user inside Docker
- Uses read-only config mounts
- Generates cryptographically secure RPC secret
- SSH keys preferred over passwords
- No credentials stored on disk (except config backup)

## Limitations

- Two-node clusters are **read-only on single node failure**
- Not suitable for production (use 3+ nodes)
- Perfect for dev/test/learning
- Can scale to 3+ nodes manually after installation

## Roadmap

- [ ] Support for 3+ node clusters
- [ ] TLS/SSL certificate management
- [ ] Monitoring setup (Prometheus/Grafana)
- [ ] Backup/restore wizard
- [ ] Web UI option
- [ ] Cloud provider support (AWS, GCP, Azure)
- [ ] Upgrade wizard

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Platform Notes

### Windows
The installer runs on Windows 10/11 with the following considerations:

**Requirements:**
- PowerShell or Windows Terminal recommended
- SSH client (OpenSSH is included in Windows 10 1809+)
- SSH keys should be in Windows format (`C:\Users\YourName\.ssh\id_rsa`)

**Known Compatibility:**
- ✅ SSH connections work natively
- ✅ Compiled binary runs without WSL
- ✅ IPv4 and IPv6 support
- ⚠️ Path separators are handled automatically by Deno
- ⚠️ ANSI colors may not display in older terminals (use Windows Terminal)

**Running on Windows:**
```powershell
.\garage-installer-windows-x64.exe
```

Default SSH key path will be `%USERPROFILE%\.ssh\id_rsa`.

### Linux & macOS
Full native support. Default SSH key path: `~/.ssh/id_rsa`.

## License

MIT License - see LICENSE file

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

But for learning, testing, or development? This is the easiest way to get started with Garage.
