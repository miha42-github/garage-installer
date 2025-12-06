# Troubleshooting Guide

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

This guide provides comprehensive solutions to common issues you might encounter when installing or managing your Garage cluster.

## Table of Contents
- [macOS Security Warning](#macos-security-warning)
- [SSH Connection Issues](#ssh-connection-issues)
- [Installing Prerequisites](#installing-prerequisites)
- [Docker Problems](#docker-problems)
- [Port Conflicts](#port-conflicts)
- [Network Connectivity](#network-connectivity)
- [Container Startup Failures](#container-startup-failures)
- [Cluster Configuration Issues](#cluster-configuration-issues)
- [AWS CLI Issues](#aws-cli-issues)
- [Recovery from Failed Installation](#recovery-from-failed-installation)

---

## macOS Security Warning

### Problem
When running the garage-installer on macOS, you may see this error:
```
"garage-installer-macos-arm64 cannot be opened because the developer cannot be verified"
```

This happens because the binary is unsigned. macOS Gatekeeper prevents execution of unverified executables for security reasons.

### Solution 1: Quick Fix (Recommended)

Run this command to remove the quarantine attribute:
```bash
xattr -d com.apple.quarantine ./garage-installer-macos-arm64
chmod +x ./garage-installer-macos-arm64
./garage-installer-macos-arm64
```

This tells macOS to trust the downloaded binary. It's safe because you've already verified it through GitHub releases.

### Solution 2: System Preferences

If the command doesn't work:

1. **Try to run the binary** (it will be blocked)
2. **Open System Settings** → Privacy & Security
3. **Scroll down** to find the security notice for garage-installer
4. **Click "Open Anyway"**
5. **Confirm** when prompted
6. Run the installer again

See: https://support.apple.com/guide/mac-help/apple-cant-check-app-for-malicious-software-mchleab3a043/

### Why This Happens

The installer is compiled as a standalone Deno binary. To eliminate this warning entirely would require:
- Apple Developer Program membership ($99/year)
- Code signing certificate
- Notarization process

This is not yet implemented but is planned for future releases.

---

## SSH Connection Issues

### "Unknown cipher" Error

**Problem:**
```
✖ Installation failed: [user@host:22] SSH connection failed: Unknown cipher
```

This occurs when the remote SSH server doesn't support the cipher algorithms that the ssh2 library can negotiate with it.

**Common Causes:**
- Remote server has very restrictive SSH cipher configuration
- Server is running very old OpenSSH with limited cipher support
- Server is running very new OpenSSH with only modern ciphers enabled
- Network appliance (firewall/proxy) filtering SSH algorithms

**Solution:**

The installer supports a wide range of ciphers including:
- Modern: `chacha20-poly1305@openssh.com`, `aes128-gcm@openssh.com`, `aes256-gcm@openssh.com`
- Standard: `aes128-ctr`, `aes192-ctr`, `aes256-ctr`
- Legacy: `aes128-cbc`, `aes192-cbc`, `aes256-cbc`, `3des-cbc`

**If you still get this error:**

1. **Check remote SSH server ciphers:**
   ```bash
   ssh -Q cipher user@remote-host
   ```

2. **Try connecting with SSH directly first:**
   ```bash
   ssh -v user@remote-host
   ```
   Look for cipher negotiation in the output (search for "ciphers_allowed").

3. **Ubuntu/Debian - Enable additional ciphers** (if server is too restrictive):
   ```bash
   # On the REMOTE server, edit SSH config:
   sudo nano /etc/ssh/sshd_config
   
   # Add this line if restrictive ciphers are set:
   Ciphers aes128-ctr,aes192-ctr,aes256-ctr,aes128-cbc,aes256-cbc,3des-cbc
   
   # Restart SSH:
   sudo systemctl restart ssh
   ```

4. **Report the issue:**
   If neither the installer nor direct SSH works, gather information:
   ```bash
   ssh -vvv user@remote-host 2>&1 | grep -i cipher
   ```
   And open an issue with the cipher names shown.

### SSH Key Not Found

**Problem:**
```
Failed to read SSH key from /home/user/.ssh/id_rsa: Permission denied
```

**Solution:**
```bash
# Ensure correct permissions on SSH key
chmod 600 ~/.ssh/id_rsa

# Ensure .ssh directory is readable
chmod 700 ~/.ssh
```

### SSH Connection Timeout

**Problem:**
```
SSH connection timeout after 30000ms
```

**Causes:**
- Network unreachable to remote host
- Firewall blocking port 22
- SSH server not running

**Solution:**
```bash
# Check if host is reachable
ping -c 3 remote-host

# Check if SSH port is open
nc -zv remote-host 22

# Or with telnet
telnet remote-host 22

# Test SSH connection directly
ssh -v user@remote-host
```

### "Permission denied (publickey)" Error

**Problem:**
```
SSH connection failed: Permission denied (publickey)
```

**Solution:**
1. Verify SSH key is correct:
   ```bash
   ssh -i ~/.ssh/id_rsa user@remote-host
   ```

2. Check remote `authorized_keys`:
   ```bash
   ssh user@remote-host "cat ~/.ssh/authorized_keys"
   ```

3. Ensure your public key is in `authorized_keys`:
   ```bash
   ssh-copy-id -i ~/.ssh/id_rsa user@remote-host
   ```

4. Check file permissions on remote:
   ```bash
   ssh user@remote-host "chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
   ```

---

## Installing Prerequisites

### Installing Docker

The installer requires Docker to be installed on both remote nodes. Since Docker installation requires sudo privileges (and often interactive password entry), you must install it manually before running the installer.

#### Ubuntu / Debian

**Recommended: Official Docker Installation**
```bash
# Update package index
sudo apt-get update

# Install dependencies
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Set up the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

**Alternative: Convenience Script**
```bash
# Download and run Docker's convenience script
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
rm get-docker.sh

# Install Docker Compose plugin
sudo apt-get update
sudo apt-get install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

**Post-Installation: Add User to Docker Group**
```bash
# Add your user to the docker group (avoids needing sudo for docker commands)
sudo usermod -aG docker $USER

# Activate the group (choose one):
# Option 1: Log out and log back in
# Option 2: Use newgrp
newgrp docker

# Verify you can run docker without sudo
docker ps
```

#### Debian-Specific Notes

For Debian, use the Debian repository instead:
```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

Then follow the same apt-get install steps as Ubuntu.

#### Other Linux Distributions

**RHEL / CentOS / Fedora:**
```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

**Arch Linux:**
```bash
sudo pacman -S docker docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

**Alpine Linux:**
```bash
sudo apk add docker docker-compose
sudo rc-update add docker boot
sudo service docker start
sudo addgroup $USER docker
```

### Installing Docker Compose

If you installed Docker using the methods above, **Docker Compose is already installed** as a plugin (`docker compose`).

**Verify Docker Compose:**
```bash
docker compose version
# Should output: Docker Compose version v2.x.x
```

**If Docker Compose is missing:**

The modern way (Docker Compose v2) is installed as a plugin:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y docker-compose-plugin

# Verify
docker compose version
```

**Legacy Docker Compose v1 (not recommended):**
```bash
# Only if you need the old standalone version
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

### Installing AWS CLI

The AWS CLI is required on your local machine to validate the Garage installation.

#### macOS
```bash
# Using Homebrew
brew install awscli

# Verify
aws --version
```

#### Linux
```bash
# Using package manager (Ubuntu/Debian)
sudo apt-get install -y awscli

# Or using pip
pip install awscli

# Or download official installer
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip

# Verify
aws --version
```

#### Windows
```powershell
# Using Chocolatey
choco install awscli

# Or download MSI installer from:
# https://awscli.amazonaws.com/AWSCLIV2.msi
```

### Verifying Prerequisites

Before running the installer, verify all prerequisites are installed:

```bash
# On remote nodes
ssh user@node1 "docker --version && docker compose version"
ssh user@node2 "docker --version && docker compose version"

# On local machine
aws --version
```

Expected output:
```
Docker version 24.0.0 or higher
Docker Compose version v2.20.0 or higher
aws-cli/2.x.x or higher
```

---

## SSH Connection Issues

### "Connection refused" or "Connection timeout"

**Symptoms:**
```
Error: SSH connection failed to node1
```

**Causes & Solutions:**

1. **SSH server not running on remote host**
   ```bash
   # On the remote host
   sudo systemctl status sshd
   sudo systemctl start sshd
   sudo systemctl enable sshd
   ```

2. **Wrong SSH port**
   - Default is 22, but your server might use a different port
   - Check: `sudo ss -tlnp | grep sshd`
   - Specify custom port in installer when prompted

3. **Firewall blocking connection**
   ```bash
   # On remote host - allow SSH
   sudo ufw allow 22/tcp
   # Or for custom port
   sudo ufw allow YOUR_PORT/tcp
   ```

4. **Network connectivity issue**
   ```bash
   # Test basic connectivity
   ping -c 3 your-node-hostname
   
   # Test SSH port specifically
   telnet your-node-hostname 22
   # Or use nc
   nc -zv your-node-hostname 22
   ```

### "Permission denied (publickey)"

**Causes & Solutions:**

1. **SSH key not authorized on remote host**
   ```bash
   # Copy your public key to remote host
   ssh-copy-id -i ~/.ssh/id_rsa.pub user@hostname
   
   # Or manually add to authorized_keys
   cat ~/.ssh/id_rsa.pub | ssh user@hostname "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
   ```

2. **Wrong key file path**
   - Verify the key path you entered: `ls -la ~/.ssh/`
   - Make sure you're pointing to the PRIVATE key (id_rsa, id_ed25519)
   - NOT the public key (id_rsa.pub, id_ed25519.pub)

3. **Incorrect key permissions**
   ```bash
   # Private key must be 600
   chmod 600 ~/.ssh/id_rsa
   
   # .ssh directory should be 700
   chmod 700 ~/.ssh
   
   # On remote host, authorized_keys should be 600
   ssh user@hostname "chmod 600 ~/.ssh/authorized_keys"
   ```

4. **SELinux or AppArmor blocking**
   ```bash
   # On remote host - check SELinux
   getenforce
   # If enforcing, temporarily disable to test
   sudo setenforce 0
   
   # Restore proper SELinux contexts
   restorecon -R -v ~/.ssh
   ```

### "setAutoPadding not supported" or Cipher Errors

**This issue has been fixed in the installer.** The installer automatically uses compatible SSH ciphers.

If you still see this error:

1. **Update your SSH server configuration**
   ```bash
   # On remote host, add to /etc/ssh/sshd_config
   Ciphers aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com
   
   # Restart SSH
   sudo systemctl restart sshd
   ```

2. **Check OpenSSH version**
   ```bash
   ssh -V
   # Should be OpenSSH 7.0+
   ```

### "Host key verification failed"

**Symptoms:**
```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

**Causes & Solutions:**

1. **Host was reinstalled or IP reused**
   ```bash
   # Remove old host key
   ssh-keygen -R hostname
   # Or for specific IP
   ssh-keygen -R 192.168.1.100
   
   # Then reconnect (will prompt to accept new key)
   ```

2. **Man-in-the-middle attack (rare)**
   - If you didn't reinstall the host, investigate before proceeding
   - Contact your network administrator

---

## Docker Problems

### "Docker not installed"

**The installer does NOT automatically install Docker** because it requires sudo privileges and interactive password entry.

**Solution:** Install Docker manually on both nodes before running the installer. See the [Installing Prerequisites](#installing-prerequisites) section above for detailed instructions.

**Quick check if Docker is installed:**
```bash
docker --version
docker compose version
```

### "Docker Compose not installed"

**Solution:** Install Docker Compose on both nodes. If you installed Docker using modern methods, Docker Compose should already be installed as a plugin. See [Installing Prerequisites](#installing-prerequisites) for details.

### "Permission denied" when running Docker commands

**Symptoms:**
```
Got permission denied while trying to connect to the Docker daemon socket
```

**Causes & Solutions:**

1. **User not in docker group (most common)**
   ```bash
   # Add user to docker group
   sudo usermod -aG docker $USER
   
   # Activate the group (choose one):
   # Option A: Re-login (logout and login again)
   # Option B: Use newgrp
   newgrp docker
   # Option C: The installer will use 'sudo docker' for this session
   ```

2. **Docker daemon not running**
   ```bash
   sudo systemctl status docker
   sudo systemctl start docker
   sudo systemctl enable docker
   ```

3. **Docker socket permissions issue**
   ```bash
   # Check socket permissions
   ls -l /var/run/docker.sock
   
   # Should be: srw-rw---- 1 root docker
   # If not:
   sudo chmod 660 /var/run/docker.sock
   sudo chown root:docker /var/run/docker.sock
   ```

### Cannot pull Docker images

**Symptoms:**
```
Error response from daemon: Get "https://registry-1.docker.io/v2/": ...
```

**Causes & Solutions:**

1. **No internet access**
   ```bash
   # Test connectivity
   ping -c 3 8.8.8.8
   curl -I https://hub.docker.com
   ```

2. **Docker Hub rate limiting**
   - Docker Hub limits anonymous pulls to 100 per 6 hours
   - Solution: Login with Docker Hub account
   ```bash
   docker login
   ```

3. **Proxy configuration needed**
   ```bash
   # Create or edit /etc/systemd/system/docker.service.d/http-proxy.conf
   sudo mkdir -p /etc/systemd/system/docker.service.d
   
   sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf > /dev/null <<EOF
   [Service]
   Environment="HTTP_PROXY=http://proxy.example.com:8080"
   Environment="HTTPS_PROXY=https://proxy.example.com:8080"
   Environment="NO_PROXY=localhost,127.0.0.1"
   EOF
   
   sudo systemctl daemon-reload
   sudo systemctl restart docker
   ```

---

## Port Conflicts

### "Ports in use: 3900, 3901, 3902, 3903"

**Symptoms:**
Preflight checks report ports are busy.

**Find what's using the ports:**
```bash
# Method 1: Using ss
sudo ss -tlnp | grep ':3900'

# Method 2: Using netstat
sudo netstat -tlnp | grep ':3900'

# Method 3: Using lsof
sudo lsof -i :3900
```

**Solutions:**

1. **Stop conflicting service**
   ```bash
   # If you see another service using the port
   sudo systemctl stop service-name
   
   # Or kill specific process
   sudo kill -9 PID
   ```

2. **Use custom ports (Advanced)**
   - During installer configuration, choose custom ports
   - Make sure to update firewall rules accordingly

3. **Remove old Garage installation**
   ```bash
   # If you have a previous Garage installation
   docker stop garage
   docker rm garage
   
   # Or using compose
   cd ~/garage
   docker compose down
   ```

---

## Network Connectivity

### Nodes cannot reach each other

**Symptoms:**
```
✖ Cannot reach node2 from node1 (ping failed)
```

**Causes & Solutions:**

1. **Firewall blocking inter-node communication**
   ```bash
   # On both nodes, allow Garage RPC port (3901)
   sudo ufw allow from NODE1_IP to any port 3901
   sudo ufw allow from NODE2_IP to any port 3901
   
   # Or allow all traffic between nodes
   sudo ufw allow from NODE1_IP
   ```

2. **Wrong hostname or IP**
   - Verify you can resolve hostnames:
   ```bash
   # From node1
   ping -c 3 node2-hostname
   
   # Or use IP directly
   ping -c 3 192.168.1.101
   ```

3. **Network segmentation**
   - Ensure both nodes are on the same network or have routing between them
   ```bash
   # Check routing
   ip route
   traceroute node2-hostname
   ```

4. **ICMP (ping) blocked but TCP works**
   - The installer uses ping for testing
   - Your firewall might block ICMP but allow TCP
   - Test actual port:
   ```bash
   # Test if port 3901 is reachable
   nc -zv node2-hostname 3901
   # Or
   telnet node2-hostname 3901
   ```

### Nodes have network but can't sync

**Check cluster status:**
```bash
ssh user@node1
docker exec garage /garage status
```

**Look for:**
- Both nodes should show `is_up: true`
- `last_seen_secs_ago` should be < 10

**If nodes show as down:**
1. Check RPC port connectivity (3901)
2. Verify RPC secret matches on both nodes
3. Check container logs:
   ```bash
   docker logs garage
   ```

---

## Container Startup Failures

### Container exits immediately after starting

**Check logs:**
```bash
docker logs garage
```

**Common causes:**

1. **Configuration file error**
   ```bash
   # Validate TOML syntax
   cd ~/garage
   docker run --rm -v $PWD:/data dxflrs/garage:v2.1.0 /garage --config /data/garage.toml --help
   ```

2. **Permission issues on data directories**
   ```bash
   # Check ownership
   ls -la ~/garage/data ~/garage/meta
   
   # Fix if needed (use your UID)
   id -u  # Get your UID
   sudo chown -R YOUR_UID:YOUR_GID ~/garage/data ~/garage/meta
   ```

3. **Port already in use**
   - See [Port Conflicts](#port-conflicts) section

### Container won't stop

**Force stop:**
```bash
docker stop -t 2 garage  # Give it 2 seconds
docker kill garage       # Force kill if needed
```

**If still stuck:**
```bash
# Restart Docker daemon
sudo systemctl restart docker
```

### "No space left on device"

**Check disk space:**
```bash
df -h
```

**Solutions:**
1. Free up space
2. Clean Docker resources:
   ```bash
   docker system prune -a --volumes
   ```
3. Change Garage data directory to larger partition

---

## Cluster Configuration Issues

### "Failed to get node ID"

**Causes & Solutions:**

1. **Container not running**
   ```bash
   docker ps -a | grep garage
   docker logs garage
   ```

2. **Garage binary issue**
   ```bash
   # Test garage command directly
   docker exec garage /garage --version
   ```

### "Failed to connect nodes"

**Symptoms:**
```
Error: Failed to connect nodes: already connected
```

**This is usually harmless** - nodes were already connected from a previous attempt.

**If genuinely failing:**
1. Check network connectivity (port 3901)
2. Verify RPC secret matches on both nodes:
   ```bash
   docker exec garage grep rpc_secret /etc/garage.toml
   ```

### "Failed to apply layout"

**Symptoms:**
```
Error: Failed to apply layout: Invalid version
```

**Causes & Solutions:**

1. **Version mismatch**
   - The installer automatically handles this
   - If you see this, try re-running the configuration step

2. **Manual fix:**
   ```bash
   # Check current layout
   docker exec garage /garage layout show
   
   # Note the version number, increment by 1
   docker exec garage /garage layout apply --version X
   ```

### Cluster stuck in "Degraded" state

**Check status:**
```bash
docker exec garage /garage status
```

**Common causes:**
1. **One node is down** - Restart it
2. **Layout not applied** - Run: `docker exec garage /garage layout show`
3. **Replication factor too high** - With 2 nodes, max replication is 2

---

## AWS CLI Issues

### "Invalid signature" errors

**This has been fixed in the installer** - it now automatically configures path-style addressing.

**Manual fix if needed:**
```bash
# Add to ~/.aws/config
[default]
region = garage

[profile default]
s3 =
    addressing_style = path
```

**Or set per-command:**
```bash
aws configure set default.s3.addressing_style path
```

### "Invalid location constraint" errors

**Solution:**
```bash
# Set region to 'garage'
aws configure set default.region garage
```

### AWS CLI not found

**Install AWS CLI:**
```bash
# macOS
brew install awscli

# Ubuntu/Debian
sudo apt-get install awscli

# Python pip
pip install awscli
```

### Cannot access endpoint from local machine

**Symptoms:**
```
Could not connect to the endpoint URL: "http://node1:3900/"
```

**Causes & Solutions:**

1. **Endpoint not accessible from your machine**
   ```bash
   # Test connectivity
   curl http://node1:3900/
   # Should return XML error (AccessDenied is normal)
   ```

2. **Use IP instead of hostname**
   ```bash
   aws s3 ls --endpoint-url http://192.168.1.100:3900
   ```

3. **Firewall blocking port 3900**
   ```bash
   # On Garage nodes
   sudo ufw allow 3900/tcp
   ```

4. **Use SSH tunnel if can't open firewall**
   ```bash
   # Forward local port 3900 to remote
   ssh -L 3900:localhost:3900 user@node1
   
   # Then use localhost
   aws s3 ls --endpoint-url http://localhost:3900
   ```

For comprehensive AWS CLI configuration, see [AWS CLI Configuration Guide](aws-cli-configuration.md).

---

## Recovery from Failed Installation

### Using State Files

The installer saves its progress to `.garage-installer-state.json`. You can use this to resume or clean up.

**Resume interrupted installation:**
1. Re-run the installer
2. It will detect the state file
3. Choose "Resume installation from last checkpoint"

**Clean up after failed installation:**
1. Re-run the installer
2. The cleanup manager will detect partial deployments
3. It will offer to remove:
   - Containers
   - Configuration files
   - Data directories

**Manual cleanup if needed:**
```bash
# On each node
ssh user@node

# Stop and remove container
docker stop garage
docker rm garage

# Remove configuration and data
rm -rf ~/garage

# Check for any leftover volumes
docker volume ls | grep garage
docker volume rm VOLUME_NAME
```

### State file is corrupted

**Symptoms:**
```
Error: Failed to parse state file
```

**Solution:**
```bash
# Delete the state file and start fresh
rm .garage-installer-state.json
```

### "Already configured" - can't reinstall

**Solution:**
1. Run the uninstall process first
2. Or manually remove existing installation (see Manual cleanup above)
3. Then re-run installer

---

## Getting More Help

### Enable Detailed Logging

The installer writes to `garage-installer.log` in the current directory.

```bash
# View the log
tail -f garage-installer.log

# Search for errors
grep ERROR garage-installer.log
```

### Check Garage Logs

```bash
# View real-time logs
docker logs -f garage

# View recent logs
docker logs --tail 100 garage

# Look for specific errors
docker logs garage 2>&1 | grep -i error
```

### Garage Status Command

```bash
# Comprehensive cluster status
docker exec garage /garage status

# Layout information
docker exec garage /garage layout show

# Key and bucket information
docker exec garage /garage bucket list
docker exec garage /garage key list
```

### Common Log Messages Explained

**"Fsyncing to disk..." (INFO)**
- Normal - Garage is persisting data

**"Metadata engine is initialized" (INFO)**
- Normal - Garage started successfully

**"Connection refused" when connecting to RPC**
- Other node is not reachable on port 3901
- Check firewall and network connectivity

**"Layout version mismatch"**
- Nodes have different layout versions
- Run `garage layout show` on both nodes
- Apply the layout with correct version

### Community Support

- **Documentation**: https://garagehq.deuxfleurs.fr/documentation/
- **Matrix Chat**: #garage:deuxfleurs.fr
- **GitHub Issues**: https://github.com/miha42-github/garage-installer/issues
- **Garage Project Issues**: https://git.deuxfleurs.fr/Deuxfleurs/garage/issues

---

## Prevention Tips

### Before Installation

1. ✅ Verify SSH access to both nodes
2. ✅ Ensure nodes can reach each other
3. ✅ Check ports 3900-3903 are available
4. ✅ Verify at least 16GB free disk space
5. ✅ Update system packages:
   ```bash
   sudo apt-get update && sudo apt-get upgrade
   ```

### After Installation

1. ✅ Save your credentials securely
2. ✅ Document your configuration
3. ✅ Test basic S3 operations
4. ✅ Set up monitoring (Admin API on port 3903)
5. ✅ Plan backup strategy

### Regular Maintenance

1. 📅 Check cluster status weekly: `docker exec garage /garage status`
2. 📅 Review logs for errors: `docker logs garage | grep -i error`
3. 📅 Monitor disk space: `df -h`
4. 📅 Keep Garage updated (check releases)

---

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
