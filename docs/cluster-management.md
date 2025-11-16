# Cluster Management Guide

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

This guide covers day-2 operations for managing your Garage cluster after installation.

## Table of Contents
- [Cluster Status & Monitoring](#cluster-status--monitoring)
- [Managing Buckets & Keys](#managing-buckets--keys)
- [Data Operations](#data-operations)
- [Container Management](#container-management)
- [Configuration Updates](#configuration-updates)
- [Backup & Restore](#backup--restore)
- [Troubleshooting Issues](#troubleshooting-issues)
- [Scaling & Advanced Topics](#scaling--advanced-topics)

---

## Cluster Status & Monitoring

### Check Cluster Health

**Basic Status Check**:
```bash
ssh user@node1 "docker exec garage /garage status"
```

**Expected Output**:
```
==== HEALTHY NODES ====
ID                  Hostname          Address           Tags  Zone  Capacity
abc123...           node1.local       192.168.1.100     -     dc1   100 GB
def456...           node2.local       192.168.1.101     -     dc1   100 GB

==== LAYOUT ====
Version: 1
Replicas: 2

ID        Tags  Zone  Capacity
abc123... -     dc1   100 GB (100%)
def456... -     dc1   100 GB (100%)
```

**Key Health Indicators**:
- ✅ Both nodes show `is_up: true`
- ✅ `last_seen_secs_ago` < 10 seconds
- ✅ Layout version is consistent
- ✅ No error messages in output

### View Detailed Node Information

**Get Node ID**:
```bash
docker exec garage /garage node id
```

**View All Nodes**:
```bash
docker exec garage /garage status | grep -A 100 "HEALTHY NODES"
```

**Check Layout**:
```bash
docker exec garage /garage layout show
```

### Monitor Container Health

**Check Container Status**:
```bash
docker ps | grep garage
```

**View Container Logs**:
```bash
# Real-time logs
docker logs -f garage

# Last 100 lines
docker logs --tail 100 garage

# Logs with timestamps
docker logs --timestamps garage

# Logs since specific time
docker logs --since 1h garage
```

**Check Container Resource Usage**:
```bash
docker stats garage --no-stream
```

### Metrics & Monitoring

**Access Metrics Endpoint**:
```bash
curl http://node1:3903/metrics
```

**Key Metrics to Monitor**:
- `garage_block_bytes_written_total` - Data written
- `garage_block_bytes_read_total` - Data read
- `garage_rpc_request_duration_seconds` - RPC latency
- `garage_api_request_duration_seconds` - API latency
- `garage_replication_queue_length` - Pending replications

**Set Up Prometheus** (optional):
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'garage'
    static_configs:
      - targets: ['node1:3903', 'node2:3903']
```

---

## Managing Buckets & Keys

### Create Access Keys

**Create a New Key**:
```bash
docker exec garage /garage key create my-app-key
```

**Output**:
```
Key created successfully!
Access Key ID: GK123456789...
Secret Access Key: abc123def456...
```

**⚠️ Save the Secret Access Key immediately** - it won't be shown again!

### List Keys

```bash
docker exec garage /garage key list
```

### View Key Details

```bash
docker exec garage /garage key info my-app-key
```

### Create Buckets

**Create a New Bucket**:
```bash
docker exec garage /garage bucket create my-bucket
```

**List All Buckets**:
```bash
docker exec garage /garage bucket list
```

**View Bucket Details**:
```bash
docker exec garage /garage bucket info my-bucket
```

### Grant Permissions

**Allow Key to Access Bucket**:
```bash
# Read and write permissions
docker exec garage /garage bucket allow my-bucket \
  --read --write --key my-app-key

# Read-only permissions
docker exec garage /garage bucket allow my-bucket \
  --read --key readonly-key

# Owner permissions (create/delete bucket)
docker exec garage /garage bucket allow my-bucket \
  --read --write --owner --key admin-key
```

**Deny Permissions**:
```bash
docker exec garage /garage bucket deny my-bucket --key my-app-key
```

### Delete Resources

**Delete a Bucket** (must be empty):
```bash
docker exec garage /garage bucket delete my-bucket
```

**Delete a Key**:
```bash
docker exec garage /garage key delete my-app-key
```

---

## Data Operations

### Using AWS CLI

**List All Buckets**:
```bash
aws s3 ls --endpoint-url http://node1:3900
```

**List Bucket Contents**:
```bash
aws s3 ls s3://my-bucket/ --endpoint-url http://node1:3900
```

**Upload a File**:
```bash
aws s3 cp file.txt s3://my-bucket/ --endpoint-url http://node1:3900
```

**Download a File**:
```bash
aws s3 cp s3://my-bucket/file.txt ./ --endpoint-url http://node1:3900
```

**Sync a Directory**:
```bash
# Upload directory
aws s3 sync ./local-dir s3://my-bucket/remote-dir/ \
  --endpoint-url http://node1:3900

# Download directory
aws s3 sync s3://my-bucket/remote-dir/ ./local-dir \
  --endpoint-url http://node1:3900
```

**Delete a File**:
```bash
aws s3 rm s3://my-bucket/file.txt --endpoint-url http://node1:3900
```

**Delete All Files in Bucket**:
```bash
aws s3 rm s3://my-bucket/ --recursive --endpoint-url http://node1:3900
```

### Check Data Distribution

**View Block Statistics**:
```bash
docker exec garage /garage stats
```

**Check Replication Status**:
```bash
docker logs garage 2>&1 | grep -i replication
```

---

## Container Management

### Start/Stop/Restart

**Stop Garage** (on one node):
```bash
ssh user@node1
cd ~/garage
docker compose stop
```

**Start Garage**:
```bash
docker compose start
```

**Restart Garage**:
```bash
docker compose restart
```

**Full Restart** (stop, remove, recreate):
```bash
docker compose down
docker compose up -d
```

### Update Garage Version

**1. Update docker-compose.yml**:
```bash
ssh user@node1
cd ~/garage
nano docker-compose.yml
```

Change:
```yaml
image: dxflrs/garage:v2.1.0
```

To:
```yaml
image: dxflrs/garage:v2.2.0  # New version
```

**2. Pull New Image**:
```bash
docker compose pull
```

**3. Recreate Container**:
```bash
docker compose up -d
```

**4. Verify Health**:
```bash
docker exec garage /garage status
```

**5. Repeat for Node 2**

**⚠️ Upgrading Notes**:
- Upgrade one node at a time
- Check cluster health after each node
- Review Garage release notes for breaking changes
- Backup configurations before major upgrades

### View Container Details

**Inspect Container**:
```bash
docker inspect garage
```

**Check Container Filesystem**:
```bash
docker exec garage ls -la /var/lib/garage/
```

**Check Configuration**:
```bash
docker exec garage cat /etc/garage.toml
```

---

## Configuration Updates

### Update Garage Configuration

**1. Edit Configuration**:
```bash
ssh user@node1
cd ~/garage
nano garage.toml
```

**2. Restart Container** (config is mounted):
```bash
docker compose restart
```

**3. Verify Changes**:
```bash
docker logs garage --tail 50
```

### Common Configuration Changes

**Change Capacity**:
```bash
# Update layout with new capacity
docker exec garage /garage layout assign -z dc1 -c 200G <node-id>
docker exec garage /garage layout apply --version <current+1>
```

**Add Bootstrap Peers** (if adding nodes later):
```toml
# In garage.toml
[rpc]
bootstrap_peers = [
  "abc123@node1.local:3901",
  "def456@node2.local:3901",
  "ghi789@node3.local:3901"
]
```

**Change Admin Token**:
```toml
# In garage.toml
[admin]
admin_token = "new-token-here"
```

Then restart container.

### Update Docker Compose

**Edit Compose File**:
```bash
cd ~/garage
nano docker-compose.yml
```

**Common Changes**:
- Change restart policy
- Add resource limits
- Mount additional volumes
- Update environment variables

**Apply Changes**:
```bash
docker compose up -d
```

---

## Backup & Restore

### Backup Strategy

**What to Backup**:
1. **Configuration Files**:
   - `~/garage/garage.toml`
   - `~/garage/docker-compose.yml`
   - `.garage-installer-state.json` (if preserved)

2. **Metadata Directory** (critical):
   - `~/garage/meta/` 
   - Contains cluster metadata and object references
   - **Must be backed up regularly**

3. **Data Directory** (optional):
   - `~/garage/data/`
   - Contains actual object data blocks
   - Can be reconstructed from metadata if you have data redundancy

**⚠️ Important**: With a 2-node cluster and replication factor 2, losing one node means you still have all data on the remaining node.

### Backup Configuration

**Manual Backup**:
```bash
# From local machine
ssh user@node1 "cd ~/garage && tar czf - garage.toml docker-compose.yml" > node1-config-$(date +%Y%m%d).tar.gz

# Or on the node
ssh user@node1
cd ~/garage
tar czf ~/backup-config-$(date +%Y%m%d).tar.gz garage.toml docker-compose.yml
```

### Backup Metadata

**Stop Container First** (for consistency):
```bash
docker compose stop
```

**Backup Metadata Directory**:
```bash
# On the node
cd ~/garage
tar czf ~/backup-meta-$(date +%Y%m%d).tar.gz meta/

# Or remotely via SSH
ssh user@node1 "cd ~/garage && docker compose stop && tar czf - meta/" > node1-meta-$(date +%Y%m%d).tar.gz
```

**Restart Container**:
```bash
docker compose start
```

### Backup Data (Optional)

**⚠️ Warning**: This can be very large!

```bash
# On the node (with container stopped)
cd ~/garage
tar czf ~/backup-data-$(date +%Y%m%d).tar.gz data/
```

**Better Alternative**: Use S3 sync to backup to another location:
```bash
# Backup to another S3 service
aws s3 sync s3://my-bucket/ s3://backup-bucket/ \
  --source-region garage \
  --endpoint-url http://node1:3900 \
  # destination endpoint for backup location
```

### Restore from Backup

**1. Stop Container**:
```bash
cd ~/garage
docker compose stop
```

**2. Restore Configuration**:
```bash
tar xzf backup-config-20251116.tar.gz
```

**3. Restore Metadata**:
```bash
# Remove current metadata
rm -rf meta/*

# Extract backup
tar xzf backup-meta-20251116.tar.gz
```

**4. Restore Data** (if backed up):
```bash
rm -rf data/*
tar xzf backup-data-20251116.tar.gz
```

**5. Restart Container**:
```bash
docker compose up -d
```

**6. Verify Health**:
```bash
docker exec garage /garage status
```

### Automated Backups

**Example Backup Script**:
```bash
#!/bin/bash
# backup-garage.sh

BACKUP_DIR="/backups/garage"
DATE=$(date +%Y%m%d-%H%M%S)
NODE="node1"

mkdir -p "$BACKUP_DIR"

echo "Stopping Garage..."
ssh user@$NODE "cd ~/garage && docker compose stop"

echo "Backing up configuration..."
ssh user@$NODE "cd ~/garage && tar czf - garage.toml docker-compose.yml" > "$BACKUP_DIR/config-$DATE.tar.gz"

echo "Backing up metadata..."
ssh user@$NODE "cd ~/garage && tar czf - meta/" > "$BACKUP_DIR/meta-$DATE.tar.gz"

echo "Starting Garage..."
ssh user@$NODE "cd ~/garage && docker compose start"

echo "Backup complete: $BACKUP_DIR"
```

**Schedule with Cron**:
```bash
# Backup daily at 2 AM
0 2 * * * /path/to/backup-garage.sh >> /var/log/garage-backup.log 2>&1
```

---

## Troubleshooting Issues

### Node Not Responding

**Check Container Status**:
```bash
docker ps -a | grep garage
```

**If Exited** - View logs:
```bash
docker logs garage
```

**Common Issues**:
- Port conflicts
- Corrupted metadata
- Disk full
- Configuration errors

**Restart Container**:
```bash
docker compose restart
```

### Cluster Connectivity Issues

**Symptoms**:
- Nodes show as down in `garage status`
- High `last_seen_secs_ago` values

**Check RPC Connectivity**:
```bash
# From node1 to node2
ssh user@node1 "nc -zv node2 3901"

# Or test with bash TCP
ssh user@node1 "timeout 5 bash -c 'cat < /dev/null > /dev/tcp/node2/3901' && echo 'Connected' || echo 'Failed'"
```

**Check Firewall**:
```bash
# Allow RPC port
sudo ufw allow from 192.168.1.100 to any port 3901
sudo ufw allow from 192.168.1.101 to any port 3901
```

**Verify RPC Secret Matches**:
```bash
ssh user@node1 "docker exec garage grep rpc_secret /etc/garage.toml"
ssh user@node2 "docker exec garage grep rpc_secret /etc/garage.toml"
```

### Layout Issues

**View Current Layout**:
```bash
docker exec garage /garage layout show
```

**Revert Layout** (if staging exists):
```bash
docker exec garage /garage layout revert
```

**Force Layout Application** (advanced):
```bash
# Increment version manually
docker exec garage /garage layout apply --version <current+1>
```

### Data Inconsistency

**Run Repair**:
```bash
# Repair all data blocks
docker exec garage /garage repair -a

# Repair specific bucket
docker exec garage /garage repair --bucket my-bucket
```

**Check for Corruption**:
```bash
docker exec garage /garage verify
```

### Disk Space Issues

**Check Disk Usage**:
```bash
df -h | grep garage
du -sh ~/garage/data
du -sh ~/garage/meta
```

**Clean Up Docker**:
```bash
# Remove unused containers, images, volumes
docker system prune -a --volumes
```

**Increase Capacity** (if possible):
- Add more disk space to server
- Update layout with new capacity
- Rebalance cluster

For more troubleshooting, see the **[Troubleshooting Guide](troubleshooting.md)**.

---

## Scaling & Advanced Topics

### Adding a Third Node (Future)

**⚠️ Current Limitation**: The installer currently only supports 2-node clusters.

**Manual Process** (requires Garage knowledge):
1. Deploy Garage on new node
2. Update bootstrap_peers on all nodes
3. Connect new node to cluster
4. Update layout with new node
5. Apply layout changes
6. Wait for rebalancing

**Planned**: See [FUTURES.md](../FUTURES.md) for roadmap on 3+ node support.

### Changing Replication Factor

**⚠️ Warning**: Cannot be changed after initial setup without rebuilding cluster.

For 2-node cluster, replication factor must be 2 or less. Changing requires:
1. Backup all data
2. Destroy cluster
3. Reinstall with new replication factor
4. Restore data

### Performance Tuning

**Increase Worker Threads** (in garage.toml):
```toml
[rpc]
rpc_worker_threads = 4  # Default is 2
```

**Adjust Block Size** (for large files):
```toml
block_size = 2097152  # 2MB blocks instead of default 1MB
```

**Tune Metadata Engine** (advanced):
```toml
metadata_fsync = false  # Faster but less safe
```

**Restart Required** after configuration changes.

### High Availability Considerations

**Current Setup** (2-node cluster):
- ⚠️ **Not HA** - Losing 1 node makes cluster read-only
- ✅ No data loss with replication factor 2
- ⚠️ Cannot write new data until both nodes operational

**For Production HA**:
- Deploy 3+ nodes minimum
- Use replication factor 3
- Distribute across availability zones
- Set up load balancer for S3 API endpoint
- Implement monitoring and alerting

### Monitoring Best Practices

**1. Set Up Alerts**:
- Node down alerts
- Disk space warnings (< 20%)
- Replication queue length
- API error rates

**2. Regular Health Checks**:
```bash
# Daily health check script
#!/bin/bash
STATUS=$(ssh user@node1 "docker exec garage /garage status" 2>&1)
if echo "$STATUS" | grep -q "ERROR"; then
  echo "ALERT: Garage cluster unhealthy" | mail -s "Garage Alert" admin@example.com
fi
```

**3. Log Aggregation**:
- Forward Docker logs to centralized logging
- Set up log rotation
- Monitor for ERROR and WARN messages

**4. Metrics Dashboard**:
- Set up Prometheus + Grafana
- Monitor key metrics
- Track trends over time

---

## Maintenance Schedule

### Daily
- ✅ Check cluster status
- ✅ Review error logs
- ✅ Monitor disk space

### Weekly
- ✅ Backup configurations
- ✅ Backup metadata
- ✅ Review access logs
- ✅ Check for Garage updates

### Monthly
- ✅ Test restore procedure
- ✅ Review capacity usage trends
- ✅ Audit access keys and permissions
- ✅ Clean up unused buckets/keys

### Quarterly
- ✅ Consider Garage version upgrades
- ✅ Review and update monitoring
- ✅ Capacity planning review
- ✅ Security audit

---

## Quick Reference Commands

### Status & Health
```bash
docker exec garage /garage status        # Cluster status
docker logs --tail 50 garage             # Recent logs
docker stats garage --no-stream          # Resource usage
curl http://node1:3903/metrics           # Prometheus metrics
```

### Container Management
```bash
docker compose stop                      # Stop
docker compose start                     # Start
docker compose restart                   # Restart
docker compose down && docker compose up -d  # Full restart
```

### Bucket & Key Management
```bash
docker exec garage /garage key create KEY_NAME
docker exec garage /garage key list
docker exec garage /garage bucket create BUCKET_NAME
docker exec garage /garage bucket list
docker exec garage /garage bucket allow BUCKET --read --write --key KEY
```

### Data Operations (AWS CLI)
```bash
aws s3 ls --endpoint-url http://node1:3900
aws s3 cp file.txt s3://bucket/ --endpoint-url http://node1:3900
aws s3 sync local/ s3://bucket/remote/ --endpoint-url http://node1:3900
```

---

## Related Documentation

- **[Troubleshooting Guide](troubleshooting.md)** - Common issues and solutions
- **[Architecture Guide](architecture.md)** - Technical deep dive
- **[State Persistence](state-persistence.md)** - Resume capability
- **[AWS CLI Configuration](aws-cli-configuration.md)** - S3 API access
- **[Node.js Integration](nodejs-express-integration.md)** - Backend integration
- **[Garage Official Docs](https://garagehq.deuxfleurs.fr/documentation/)** - Complete Garage documentation

---

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**
