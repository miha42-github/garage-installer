# AWS CLI Configuration for Garage

This guide explains how to properly configure the AWS CLI to work with your Garage S3 cluster.

## Why Special Configuration is Needed

Garage requires specific AWS CLI settings that differ from standard AWS S3:

1. **Path-Style Addressing**: Garage uses path-style URLs (`http://endpoint/bucket/key`) instead of virtual-host style (`http://bucket.endpoint/key`)
2. **Custom Region**: You must specify `garage` as the region (or whatever you configured in `garage.toml`)
3. **Custom Endpoint**: Your Garage S3 API endpoint instead of AWS's S3 endpoints

## Quick Setup

After a successful installation, the installer will display your cluster's S3 API endpoints. You'll need:
- **S3 API Endpoint**: e.g., `http://node1:3900` or `http://node2:3900`
- **Access Key ID**: Created via Garage CLI or Admin API (starts with `GK`)
- **Secret Access Key**: Provided when you create the key (cannot be retrieved later!)

### Option 1: Configuration Files (Recommended)

Create or edit `~/.aws/credentials`:
```ini
[default]
aws_access_key_id = GKxxxxxxxxxxxxxxxxxxxx
aws_secret_access_key = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Create or edit `~/.aws/config`:
```ini
[default]
region = garage
endpoint_url = http://your-node:3900

[profile default]
s3 =
    addressing_style = path
```

### Option 2: Environment Variables

For temporary use or scripts:
```bash
export AWS_ACCESS_KEY_ID="GKxxxxxxxxxxxxxxxxxxxx"
export AWS_SECRET_ACCESS_KEY="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export AWS_DEFAULT_REGION="garage"
export AWS_ENDPOINT_URL="http://your-node:3900"

# Configure path-style addressing globally
aws configure set default.s3.addressing_style path
```

## Usage Examples

### List Buckets
```bash
aws s3 ls
```

### Create a Bucket
```bash
aws s3 mb s3://my-bucket
```

### Upload a File
```bash
aws s3 cp myfile.txt s3://my-bucket/
```

### Download a File
```bash
aws s3 cp s3://my-bucket/myfile.txt ./downloaded.txt
```

### Sync a Directory
```bash
aws s3 sync ./local-folder s3://my-bucket/remote-folder/
```

### List Objects in a Bucket
```bash
aws s3 ls s3://my-bucket/
```

### Delete a File
```bash
aws s3 rm s3://my-bucket/myfile.txt
```

### Delete a Bucket (must be empty)
```bash
aws s3 rb s3://my-bucket
```

## Common Issues and Solutions

### "Invalid signature" Error

**Symptoms:**
```
An error occurred (AccessDenied) when calling the PutObject operation: Forbidden: Invalid signature
```

**Solutions:**
1. Verify path-style addressing is configured:
   ```bash
   aws configure get default.s3.addressing_style
   # Should return: path
   ```
   
2. If not set, configure it:
   ```bash
   aws configure set default.s3.addressing_style path
   ```

3. Verify your credentials are correct (access key and secret key)

4. Make sure you're using the correct endpoint URL

### "Cannot satisfy location constraint" Error

**Symptoms:**
```
An error occurred (IllegalLocationConstraintException) when calling the CreateBucket operation: 
Cannot satisfy location constraint aws-global
```

**Solution:**
Ensure region is set to `garage` (or your custom region name):
```bash
aws configure set default.region garage
```

### Endpoint Not Reachable

**Symptoms:**
```
Could not connect to the endpoint URL
```

**Solutions:**
1. Verify the node is accessible: `ping your-node`
2. Check firewall rules allow port 3900
3. Verify Garage is running: `ssh user@node "docker ps | grep garage"`
4. Try the other node's endpoint if you have multiple nodes

### Access Denied for Bucket Operations

**Symptoms:**
```
An error occurred (AccessDenied) when calling the [operation]
```

**Solutions:**
1. Check bucket permissions are granted to your key:
   ```bash
   ssh user@node "docker exec garage /garage bucket info my-bucket"
   ```

2. Grant permissions if needed:
   ```bash
   ssh user@node "docker exec garage /garage bucket allow my-bucket --read --write --key YOUR_KEY_ID"
   ```

## Managing Keys and Permissions

### Creating a New Key

Keys can only be created on the Garage server via SSH:

```bash
# SSH to one of your nodes
ssh user@node

# Create a new key
docker exec garage /garage key create my-new-key

# IMPORTANT: Save the Secret Key immediately - it cannot be retrieved later!
```

**Output example:**
```
Key ID:              GKxxxxxxxxxxxxxxxxxxxx
Key name:            my-new-key
Secret key:          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Created:             2025-11-16 00:00:00.000 +00:00
```

### Granting Bucket Permissions

```bash
# Grant read/write permissions
docker exec garage /garage bucket allow my-bucket --read --write --key GKxxxxxxxxxxxxxxxxxxxx

# Grant read-only permissions
docker exec garage /garage bucket allow my-bucket --read --key GKxxxxxxxxxxxxxxxxxxxx

# Grant write-only permissions  
docker exec garage /garage bucket allow my-bucket --write --key GKxxxxxxxxxxxxxxxxxxxx
```

### Viewing Key Information

```bash
docker exec garage /garage key info my-key-name
```

**Note:** The secret key will be shown as `(redacted)` for security. It's only displayed once when the key is created.

## Advanced Configuration

### Using Multiple Profiles

You can configure multiple profiles for different keys or endpoints:

`~/.aws/credentials`:
```ini
[default]
aws_access_key_id = GK_default_key
aws_secret_access_key = default_secret

[production]
aws_access_key_id = GK_prod_key
aws_secret_access_key = prod_secret

[staging]
aws_access_key_id = GK_staging_key
aws_secret_access_key = staging_secret
```

`~/.aws/config`:
```ini
[default]
region = garage
endpoint_url = http://node1:3900
s3 =
    addressing_style = path

[profile production]
region = garage
endpoint_url = http://prod-node:3900
s3 =
    addressing_style = path

[profile staging]
region = garage
endpoint_url = http://staging-node:3900
s3 =
    addressing_style = path
```

Usage:
```bash
# Use default profile
aws s3 ls

# Use production profile
aws s3 ls --profile production

# Use staging profile
aws s3 ls --profile staging
```

### Using with Scripts

Create a helper script (`~/bin/garage-s3`):
```bash
#!/bin/bash
# Wrapper script for Garage S3 operations

export AWS_ACCESS_KEY_ID="${GARAGE_ACCESS_KEY:-GKxxxxxxxxxxxxxxxxxxxx}"
export AWS_SECRET_ACCESS_KEY="${GARAGE_SECRET_KEY:-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx}"
export AWS_DEFAULT_REGION="garage"
export AWS_ENDPOINT_URL="${GARAGE_ENDPOINT:-http://node1:3900}"

# Ensure path-style addressing
aws configure set default.s3.addressing_style path 2>/dev/null

# Pass all arguments to aws
aws "$@"
```

Make it executable:
```bash
chmod +x ~/bin/garage-s3
```

Usage:
```bash
garage-s3 s3 ls
garage-s3 s3 cp myfile.txt s3://my-bucket/
```

## Testing Your Configuration

Run these commands to verify everything works:

```bash
# Test connectivity and credentials
aws s3 ls

# Create a test bucket
aws s3 mb s3://test-bucket

# Upload a test file
echo "Hello Garage!" > test.txt
aws s3 cp test.txt s3://test-bucket/

# Download and verify
aws s3 cp s3://test-bucket/test.txt downloaded.txt
cat downloaded.txt

# Cleanup
aws s3 rm s3://test-bucket/test.txt
aws s3 rb s3://test-bucket
rm test.txt downloaded.txt
```

If all commands succeed, your AWS CLI is properly configured!

## See Also

- [Garage Documentation - S3 Compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
- [AWS CLI Command Reference](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html)
- [Garage CLI Reference](https://garagehq.deuxfleurs.fr/documentation/reference-manual/cli/)
