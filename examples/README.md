# Garage S3 Examples

This directory contains practical examples demonstrating how to integrate with Garage S3.

## Directory Structure

```
examples/
├── README.md              # This file
├── aws-cli/              # AWS CLI examples
│   ├── basic-usage.sh
│   ├── sync-directory.sh
│   └── website-hosting.sh
└── nodejs/               # Node.js SDK examples
    ├── simple-upload.js
    ├── express-middleware.js
    ├── multipart-upload.js
    ├── package.json
    └── README.md
```

## Prerequisites

- Running Garage cluster (installed via the main installer)
- Garage access key and secret key created
- Network access to Garage API endpoint (default: port 3900)

### Tool-Specific Prerequisites

- **AWS CLI**: AWS CLI v2 installed
- **Node.js**: Node.js 16+ and npm

## Quick Start

1. **Get your Garage credentials:**
   ```bash
   cd /opt/garage
   docker compose exec garage-1 garage key list
   ```

2. **Set environment variables:**
   ```bash
   export GARAGE_ENDPOINT="http://192.168.1.100:3900"
   export GARAGE_REGION="garage"
   export GARAGE_ACCESS_KEY="your-access-key-here"
   export GARAGE_SECRET_KEY="your-secret-key-here"
   ```

3. **Choose your example:**
   - **AWS CLI**: See `aws-cli/` for shell script examples
   - **Node.js**: See `nodejs/` for JavaScript examples

## Example Categories

### AWS CLI Examples

Shell scripts demonstrating AWS CLI usage with Garage:

- `basic-usage.sh` - Essential S3 operations (create, upload, download, list, delete)
- `sync-directory.sh` - Backup and restore workflows
- `website-hosting.sh` - Static website deployment

**Run:**
```bash
cd aws-cli
./basic-usage.sh
```

### Node.js Examples

JavaScript examples using AWS SDK v3:

- `simple-upload.js` - Basic upload/download operations
- `express-middleware.js` - File upload API with Express.js
- `multipart-upload.js` - Large file uploads with progress tracking

**Setup:**
```bash
cd nodejs
npm install
node simple-upload.js
```

## Configuration Tips

### Path-Style Addressing

Garage uses **path-style** S3 addressing. Always configure:

**AWS CLI** (~/.aws/config):
```ini
[profile garage]
s3 =
  addressing_style = path
```

**Node.js**:
```javascript
const s3 = new S3Client({
  forcePathStyle: true  // Required!
});
```

### Endpoint URL

Always specify the full endpoint URL with protocol:

```bash
export GARAGE_ENDPOINT="http://192.168.1.100:3900"  # ✓ Correct
```

## Troubleshooting

See individual example READMEs for detailed troubleshooting:
- [AWS CLI Troubleshooting](aws-cli/basic-usage.sh) (see comments in script)
- [Node.js Troubleshooting](nodejs/README.md)

## Security Best Practices

1. **Never hardcode credentials** - Always use environment variables
2. **Use minimal permissions** - Grant only required bucket access
3. **Rotate credentials regularly** - Create new keys periodically
4. **Use HTTPS in production** - Configure TLS for Garage API
5. **Restrict network access** - Use firewall rules to limit API access
