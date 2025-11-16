# Quick Reference Guide

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

Quick command reference for common Garage Installer and cluster management tasks.

## Table of Contents
- [Installation](#installation)
- [Cluster Status](#cluster-status)
- [Container Management](#container-management)
- [Bucket & Key Management](#bucket--key-management)
- [AWS CLI Operations](#aws-cli-operations)
- [Troubleshooting](#troubleshooting)
- [Backup & Restore](#backup--restore)

---

## Installation

### Run Installer

```bash
# Download and run
wget https://github.com/miha42-github/garage-installer/releases/latest/download/garage-installer-linux-x64
chmod +x garage-installer-linux-x64
./garage-installer-linux-x64
```

### Resume Installation

```bash
# If interrupted, just re-run
./garage-installer-linux-x64
# Select: "Resume installation from last checkpoint"
```

### Uninstall

```bash
./garage-installer-linux-x64
# Select: "Uninstall"
```

---

## Cluster Status

### Check Cluster Health

```bash
ssh user@node1 "docker exec garage /garage status"
```

### View Node ID

```bash
docker exec garage /garage node id
```

### Check Layout

```bash
docker exec garage /garage layout show
```

### View Container Logs

```bash
# Real-time
docker logs -f garage

# Last 50 lines
docker logs --tail 50 garage

# With timestamps
docker logs --timestamps garage
```

### Check Container Status

```bash
docker ps | grep garage
```

### Resource Usage

```bash
docker stats garage --no-stream
```

### Metrics Endpoint

```bash
curl http://node1:3903/metrics
```

---

## Container Management

### Stop/Start/Restart

```bash
cd ~/garage

# Stop
docker compose stop

# Start
docker compose start

# Restart
docker compose restart

# Full restart (recreate)
docker compose down && docker compose up -d
```

### Update Garage Version

```bash
# Edit compose file
nano ~/garage/docker-compose.yml
# Change: image: dxflrs/garage:v2.2.0

# Pull new image
docker compose pull

# Recreate container
docker compose up -d

# Verify
docker exec garage /garage --version
```

### View Configuration

```bash
docker exec garage cat /etc/garage.toml
```

---

## Bucket & Key Management

### Create Access Key

```bash
docker exec garage /garage key create my-key
# Save the Secret Access Key shown!
```

### List Keys

```bash
docker exec garage /garage key list
```

### Key Info

```bash
docker exec garage /garage key info my-key
```

### Create Bucket

```bash
docker exec garage /garage bucket create my-bucket
```

### List Buckets

```bash
docker exec garage /garage bucket list
```

### Bucket Info

```bash
docker exec garage /garage bucket info my-bucket
```

### Grant Permissions

```bash
# Read + Write
docker exec garage /garage bucket allow my-bucket \
  --read --write --key my-key

# Read only
docker exec garage /garage bucket allow my-bucket \
  --read --key readonly-key

# Owner (create/delete bucket)
docker exec garage /garage bucket allow my-bucket \
  --read --write --owner --key admin-key
```

### Revoke Permissions

```bash
docker exec garage /garage bucket deny my-bucket --key my-key
```

### Delete Resources

```bash
# Delete bucket (must be empty)
docker exec garage /garage bucket delete my-bucket

# Delete key
docker exec garage /garage key delete my-key
```

---

## AWS CLI Operations

### Configure AWS CLI

```bash
# One-time setup
aws configure set aws_access_key_id YOUR_ACCESS_KEY
aws configure set aws_secret_access_key YOUR_SECRET_KEY
aws configure set default.region garage
aws configure set default.s3.addressing_style path
```

### List Buckets

```bash
aws s3 ls --endpoint-url http://node1:3900
```

### List Objects in Bucket

```bash
aws s3 ls s3://my-bucket/ --endpoint-url http://node1:3900
```

### Upload File

```bash
aws s3 cp file.txt s3://my-bucket/ --endpoint-url http://node1:3900
```

### Download File

```bash
aws s3 cp s3://my-bucket/file.txt ./ --endpoint-url http://node1:3900
```

### Sync Directory

```bash
# Upload
aws s3 sync ./local-dir s3://my-bucket/remote/ \
  --endpoint-url http://node1:3900

# Download
aws s3 sync s3://my-bucket/remote/ ./local-dir \
  --endpoint-url http://node1:3900
```

### Create Bucket (via AWS CLI)

```bash
aws s3 mb s3://my-bucket --endpoint-url http://node1:3900
```

### Delete File

```bash
aws s3 rm s3://my-bucket/file.txt --endpoint-url http://node1:3900
```

### Delete All Files in Bucket

```bash
aws s3 rm s3://my-bucket/ --recursive --endpoint-url http://node1:3900
```

### Delete Bucket (via AWS CLI)

```bash
# Must be empty first
aws s3 rb s3://my-bucket --endpoint-url http://node1:3900
```

---

## Troubleshooting

### Check SSH Connection

```bash
ssh user@node1 "echo 'Connection OK'"
```

### Check Docker

```bash
ssh user@node1 "docker --version"
ssh user@node1 "docker compose version"
```

### Check Ports

```bash
# Check if port is listening
ssh user@node1 "sudo ss -tlnp | grep 3900"

# Check if port is open (from remote)
nc -zv node1 3900
```

### Test Node Connectivity

```bash
# From node1 to node2
ssh user@node1 "nc -zv node2 3901"
# Or
ssh user@node1 "timeout 5 bash -c 'cat < /dev/null > /dev/tcp/node2/3901' && echo 'Connected' || echo 'Failed'"
```

### Check Disk Space

```bash
ssh user@node1 "df -h | grep garage"
ssh user@node1 "du -sh ~/garage/data ~/garage/meta"
```

### Find Container Logs with Errors

```bash
docker logs garage 2>&1 | grep -i error
docker logs garage 2>&1 | grep -i warn
```

### Check Firewall

```bash
# Ubuntu/Debian
sudo ufw status
sudo ufw allow 3900/tcp
sudo ufw allow 3901/tcp
```

### Verify RPC Secret

```bash
# Should match on both nodes
ssh user@node1 "docker exec garage grep rpc_secret /etc/garage.toml"
ssh user@node2 "docker exec garage grep rpc_secret /etc/garage.toml"
```

### Restart Everything

```bash
# On each node
cd ~/garage
docker compose restart

# Wait 30 seconds, then check status
docker exec garage /garage status
```

### Check Replication

```bash
docker exec garage /garage stats
```

### Repair Data

```bash
# Repair all
docker exec garage /garage repair -a

# Repair specific bucket
docker exec garage /garage repair --bucket my-bucket
```

---

## Backup & Restore

### Backup Configuration

```bash
# From local machine
ssh user@node1 "cd ~/garage && tar czf - garage.toml docker-compose.yml" \
  > node1-config-$(date +%Y%m%d).tar.gz
```

### Backup Metadata

```bash
# Stop container first
ssh user@node1 "cd ~/garage && docker compose stop"

# Backup
ssh user@node1 "cd ~/garage && tar czf - meta/" \
  > node1-meta-$(date +%Y%m%d).tar.gz

# Restart
ssh user@node1 "cd ~/garage && docker compose start"
```

### Restore Configuration

```bash
# Upload backup
scp node1-config-20251116.tar.gz user@node1:~/

# Extract
ssh user@node1 "cd ~/garage && tar xzf ~/node1-config-20251116.tar.gz"
```

### Restore Metadata

```bash
# Stop container
ssh user@node1 "cd ~/garage && docker compose stop"

# Clear and restore
ssh user@node1 "cd ~/garage && rm -rf meta/* && tar xzf ~/node1-meta-20251116.tar.gz"

# Restart
ssh user@node1 "cd ~/garage && docker compose up -d"
```

---

## Common Workflows

### Daily Health Check

```bash
#!/bin/bash
echo "=== Garage Cluster Health Check ==="
echo "Date: $(date)"
echo ""
echo "Node Status:"
ssh user@node1 "docker exec garage /garage status" | grep "is_up"
echo ""
echo "Disk Usage:"
ssh user@node1 "df -h | grep garage"
echo ""
echo "Recent Errors:"
ssh user@node1 "docker logs --since 24h garage 2>&1 | grep -i error | tail -5"
```

### Change Node Capacity

```bash
# Get current layout
docker exec garage /garage layout show

# Update capacity (note the version)
docker exec garage /garage layout assign \
  -z dc1 -c 200G <node-id>

# Apply with incremented version
docker exec garage /garage layout apply --version <current+1>

# Verify
docker exec garage /garage layout show
```

### Add Firewall Rules

```bash
# Allow Garage ports
sudo ufw allow 3900/tcp  # S3 API
sudo ufw allow 3901/tcp  # RPC
sudo ufw allow 3902/tcp  # S3 Web (optional)
sudo ufw allow 3903/tcp  # Admin/Metrics

# Allow from specific IPs only
sudo ufw allow from 192.168.1.0/24 to any port 3901
```

### Monitor Metrics with Watch

```bash
# Live cluster status
watch -n 5 'ssh user@node1 "docker exec garage /garage status"'

# Live container stats
watch -n 2 'docker stats garage --no-stream'
```

---

## Environment Variables

### Useful Aliases

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Garage aliases
alias garage-status='ssh user@node1 "docker exec garage /garage status"'
alias garage-logs='ssh user@node1 "docker logs --tail 50 garage"'
alias garage-restart='ssh user@node1 "cd ~/garage && docker compose restart"'
alias garage-keys='ssh user@node1 "docker exec garage /garage key list"'
alias garage-buckets='ssh user@node1 "docker exec garage /garage bucket list"'

# AWS CLI with endpoint
alias s3='aws s3 --endpoint-url http://node1:3900'
```

Usage after adding aliases:
```bash
garage-status
garage-logs
s3 ls
s3 cp file.txt s3://my-bucket/
```

### AWS CLI Environment Variables

```bash
# Alternative to aws configure
export AWS_ACCESS_KEY_ID="your_access_key"
export AWS_SECRET_ACCESS_KEY="your_secret_key"
export AWS_DEFAULT_REGION="garage"
export AWS_ENDPOINT_URL="http://node1:3900"

# Use path-style addressing
export AWS_S3_ADDRESSING_STYLE="path"

# Then use aws s3 commands without --endpoint-url
aws s3 ls
```

---

## Emergency Procedures

### Node Down - Emergency

```bash
# 1. Check if container is running
docker ps -a | grep garage

# 2. If stopped, check logs
docker logs garage

# 3. Try starting
docker compose start

# 4. If that fails, recreate
docker compose down
docker compose up -d

# 5. Check cluster status
docker exec garage /garage status
```

### Cluster Read-Only - Both Nodes Up

```bash
# 1. Check layout status
docker exec garage /garage layout show

# 2. Check for pending layout changes
docker exec garage /garage layout revert  # If needed

# 3. Check logs for errors
docker logs garage 2>&1 | grep -i error

# 4. Verify RPC connectivity
nc -zv node2 3901  # From node1
```

### Out of Disk Space

```bash
# 1. Check usage
df -h | grep garage
du -sh ~/garage/data

# 2. Clean Docker
docker system prune -a --volumes

# 3. If still full, consider:
# - Delete old data from buckets
# - Add more disk space
# - Move garage directories to larger partition
```

---

## Useful One-Liners

```bash
# Count objects in bucket
aws s3 ls s3://my-bucket/ --recursive --endpoint-url http://node1:3900 | wc -l

# Total size of bucket
aws s3 ls s3://my-bucket/ --recursive --summarize --human-readable --endpoint-url http://node1:3900

# Find large files
aws s3 ls s3://my-bucket/ --recursive --endpoint-url http://node1:3900 | sort -k3 -n -r | head -20

# Check if Garage is responding
curl -I http://node1:3900/ 2>&1 | head -1

# Get node IDs quickly
ssh user@node1 "docker exec garage /garage node id"
ssh user@node2 "docker exec garage /garage node id"

# Check last restart time
docker inspect garage | jq '.[0].State.StartedAt'

# Monitor log in real-time for errors
docker logs -f garage 2>&1 | grep --line-buffered -i error
```

---

## Related Documentation

- **[Troubleshooting Guide](troubleshooting.md)** - Comprehensive problem resolution
- **[Cluster Management](cluster-management.md)** - Detailed operations guide
- **[AWS CLI Configuration](aws-cli-configuration.md)** - Complete AWS CLI setup
- **[Architecture](architecture.md)** - Technical implementation
- **[Main README](../README.md)** - Project overview

---

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
