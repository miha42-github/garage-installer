# Node.js Examples for Garage S3

This directory contains Node.js examples demonstrating how to integrate Garage S3 into your applications.

## Prerequisites

- Node.js 16 or higher
- npm or yarn
- Running Garage cluster
- Garage access key and secret key

## Installation

```bash
cd examples/nodejs
npm install
```

## Configuration

Set environment variables before running examples:

```bash
export GARAGE_ENDPOINT="http://192.168.1.100:3900"
export GARAGE_REGION="garage"
export GARAGE_ACCESS_KEY="your-access-key"
export GARAGE_SECRET_KEY="your-secret-key"
```

## Examples

### 1. Simple Upload (`simple-upload.js`)

Basic S3 operations using AWS SDK v3.

**Features:**
- Upload text and JSON files
- Download files
- List bucket contents
- Error handling

**Run:**
```bash
node simple-upload.js
```

### 2. Express Middleware (`express-middleware.js`)

File upload API using Express and Multer.

**Features:**
- Single file upload endpoint
- Multiple files upload (max 5)
- List uploaded files
- Delete files
- File size limits (10MB)
- Error handling

**Run:**
```bash
node express-middleware.js
```

**Test:**
```bash
# Upload single file
curl -F "file=@test.txt" http://localhost:3000/upload

# Upload multiple files
curl -F "files=@file1.txt" -F "files=@file2.txt" http://localhost:3000/upload-multiple

# List files
curl http://localhost:3000/files

# Delete file
curl -X DELETE http://localhost:3000/files/1234567890-test.txt

# Health check
curl http://localhost:3000/health
```

### 3. Multipart Upload (`multipart-upload.js`)

Efficient large file uploads with progress tracking.

**Features:**
- Multipart upload for large files
- Progress bar with percentage
- Concurrent part uploads
- Automatic cleanup on failure
- Resume capability

**Run:**
```bash
node multipart-upload.js /path/to/large/file.zip
```

**When to use:**
- Files larger than 100MB
- Unreliable network connections
- Need to track upload progress
- Want to optimize upload speed

## AWS SDK v3 Configuration

All examples use AWS SDK v3 with the following configuration:

```javascript
import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  endpoint: process.env.GARAGE_ENDPOINT,
  region: process.env.GARAGE_REGION,
  credentials: {
    accessKeyId: process.env.GARAGE_ACCESS_KEY,
    secretAccessKey: process.env.GARAGE_SECRET_KEY
  },
  forcePathStyle: true  // Required for Garage
});
```

**Important:** Always set `forcePathStyle: true` when connecting to Garage.

## Common Operations

### Upload a File
```javascript
import { PutObjectCommand } from '@aws-sdk/client-s3';

const command = new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt',
  Body: fileContent
});

await s3Client.send(command);
```

### Download a File
```javascript
import { GetObjectCommand } from '@aws-sdk/client-s3';

const command = new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt'
});

const response = await s3Client.send(command);
const content = await response.Body.transformToString();
```

### List Objects
```javascript
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

const command = new ListObjectsV2Command({
  Bucket: 'my-bucket'
});

const response = await s3Client.send(command);
console.log(response.Contents);
```

## Error Handling

```javascript
try {
  await s3Client.send(command);
} catch (error) {
  if (error.name === 'NoSuchBucket') {
    console.error('Bucket does not exist');
  } else if (error.name === 'NoSuchKey') {
    console.error('Object not found');
  } else {
    console.error('S3 error:', error.message);
  }
}
```

## Troubleshooting

### SignatureDoesNotMatch

Check that your credentials are correct and that the endpoint URL is accessible.

### Connection Refused

Verify that:
- Garage is running
- Endpoint URL is correct
- Port 3900 is accessible
- No firewall blocking the connection

### Module Not Found

Run `npm install` to install dependencies.

## Additional Resources

- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Garage Documentation](https://garagehq.deuxfleurs.fr/documentation/)
- [Express.js Documentation](https://expressjs.com/)
- [Multer Documentation](https://github.com/expressjs/multer)
