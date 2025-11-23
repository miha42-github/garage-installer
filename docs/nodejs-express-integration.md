# Node.js + Express Integration with Garage

**[← Back to Documentation Index](README.md)** | **[Main README](../README.md)**

This guide shows how to integrate Garage S3-compatible storage into a Node.js/Express backend serving a React frontend.

## Table of Contents
- [Garage Prerequisites](#garage-prerequisites)
- [Architecture Overview](#architecture-overview)
- [Setup and Configuration](#setup-and-configuration)
- [Bucket Management](#bucket-management)
- [Date-Based Partitioning Strategy](#date-based-partitioning-strategy)
- [Object Operations](#object-operations)
- [Cluster Health Monitoring](#cluster-health-monitoring)
- [Security Best Practices](#security-best-practices)
- [Complete Example](#complete-example)

## Garage Prerequisites

Before integrating with Node.js, you need to set up access keys and permissions in Garage. This section covers the one-time setup required.

### Prerequisites Checklist

- ✅ Garage cluster running and accessible
- ✅ SSH access to a Garage node (or Admin API access)
- ✅ Docker container name (e.g., `garage`)
- ✅ Admin privileges on the Garage cluster

### Step 1: Create an Access Key

Connect to your Garage node via SSH and create a key:

```bash
ssh mihay42@cafe-1 "docker exec garage /garage key create my-app-key"
```

**Example Output:**
```
==== ACCESS KEY INFORMATION ====

Key ID: GK88a87e7a792e4e30e54b9d45
Key name: my-app-key

Secret key: c7f3c0a6a1f4e8b2d9e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7

Created: "2025-11-17T10:30:00+00:00"
Valid until: (not set - valid forever)
Expires on: (not set - does not expire)

Can create buckets: false

Bucket permissions: (none)
```

**Important:** Save the `Key ID` and `Secret key` - you'll need these for your `.env` file.

### Step 2: Grant Bucket Creation Permission

Allow the key to create buckets:

```bash
ssh mihay42@cafe-1 "docker exec garage /garage key allow --create-bucket GK88a87e7a792e4e30e54b9d45"
```

Replace `GK88a87e7a792e4e30e54b9d45` with your actual Key ID from Step 1.

**Example Output:**
```
==== ACCESS KEY INFORMATION ====

Key ID: GK88a87e7a792e4e30e54b9d45
Key name: my-app-key

Secret key: (redacted)

Created: "2025-11-17T10:30:00+00:00"
Valid until: (not set - valid forever)
Expires on: (not set - does not expire)

Can create buckets: true

Bucket permissions: (none)
```

Note: `Can create buckets` is now `true`.

### Step 3: Create Buckets

Create the buckets your application will use:

```bash
# Create main application bucket
ssh mihay42@cafe-1 "docker exec garage /garage bucket create app-uploads"

# Create user data bucket (if using multi-tenant approach)
ssh mihay42@cafe-1 "docker exec garage /garage bucket create user-data-2025-11"
```

**Example Output:**
```
Bucket app-uploads has been created
```

### Step 4: Grant Bucket Permissions

Grant read, write, and owner permissions to your key:

```bash
# Grant permissions using bucket name and key name
ssh mihay42@cafe-1 "docker exec garage /garage bucket allow \
  --read \
  --write \
  --owner \
  app-uploads \
  --key my-app-key"
```

**Example Output:**
```
Bucket permissions updated successfully
```

**Verify Permissions:**

```bash
ssh mihay42@cafe-1 "docker exec garage /garage bucket info app-uploads"
```

**Example Output:**
```
Bucket: app-uploads
Size: 0 bytes (0 objects)
Website access: false

Global read access: false
Authorized keys:
  - my-app-key (read, write, owner)
```

### Step 5: Save Credentials

Add the credentials to your `.env` file:

```env
# From Step 1
GARAGE_ACCESS_KEY_ID=GK88a87e7a792e4e30e54b9d45
GARAGE_SECRET_ACCESS_KEY=c7f3c0a6a1f4e8b2d9e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7

# Your Garage endpoint
GARAGE_ENDPOINT=http://cafe-1:3900
GARAGE_REGION=garage
```

### Automation Alternative: Admin API

For automated deployments, you can use the Garage Admin API instead of SSH:

```bash
# Create key via Admin API
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -X POST http://cafe-1:3903/v1/key \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app-key"
  }'

# Grant bucket creation permission
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -X POST http://cafe-1:3903/v1/key/import \
  -H "Content-Type: application/json" \
  -d '{
    "accessKeyId": "GK88a87e7a792e4e30e54b9d45",
    "name": "my-app-key",
    "allow": {
      "createBucket": true
    }
  }'

# Create bucket
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -X POST http://cafe-1:3903/v1/bucket \
  -H "Content-Type: application/json" \
  -d '{
    "globalAlias": "app-uploads"
  }'

# Grant bucket permissions
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -X POST http://cafe-1:3903/v1/bucket/allow \
  -H "Content-Type: application/json" \
  -d '{
    "bucketId": "BUCKET_ID_FROM_PREVIOUS_RESPONSE",
    "accessKeyId": "GK88a87e7a792e4e30e54b9d45",
    "permissions": {
      "read": true,
      "write": true,
      "owner": true
    }
  }'
```

**Finding Admin Token:**

```bash
ssh mihay42@cafe-1 "cat /opt/garage/garage.toml | grep admin_token"
```

### Quick Reference

#### Garage CLI Commands

| Task | Command |
|------|---------|
| Create key | `docker exec garage /garage key create <name>` |
| Grant bucket creation | `docker exec garage /garage key allow --create-bucket <key-id>` |
| Create bucket | `docker exec garage /garage bucket create <bucket-name>` |
| Grant permissions | `docker exec garage /garage bucket allow --read --write --owner <bucket> --key <key-name>` |
| View key info | `docker exec garage /garage key info <key-name>` |
| View bucket info | `docker exec garage /garage bucket info <bucket-name>` |
| List buckets | `docker exec garage /garage bucket list` |
| List keys | `docker exec garage /garage key list` |

#### Admin API (Node.js fetch) - Automation

**Note:** Requires `admin_token` from `garage.toml`. Find it with:
```bash
ssh mihay42@cafe-1 "docker exec garage cat /etc/garage.toml | grep admin_token"
```

**Setup Admin API Client:**
```typescript
// src/services/admin.service.ts
export class GarageAdminService {
  private endpoint: string;
  private token: string;

  constructor() {
    this.endpoint = process.env.GARAGE_ADMIN_ENDPOINT || 'http://cafe-1:3903';
    this.token = process.env.GARAGE_ADMIN_TOKEN!;
  }

  private async request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Admin API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // Create a new access key
  async createKey(name: string) {
    const result = await this.request('/v2/CreateKey', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return {
      accessKeyId: result.accessKeyId,
      secretAccessKey: result.secretAccessKey,
      name: result.name,
    };
  }

  // Update key permissions (grant bucket creation)
  async updateKeyPermissions(accessKeyId: string, permissions: {
    createBucket?: boolean;
  }) {
    return await this.request(`/v2/UpdateKey?id=${encodeURIComponent(accessKeyId)}`, {
      method: 'POST',
      body: JSON.stringify({
        allow: {
          createBucket: permissions.createBucket,
        },
      }),
    });
  }

  // Get key information
  async getKey(search: string) {
    return await this.request(`/v2/GetKeyInfo?search=${encodeURIComponent(search)}`);
  }

  // Get key by ID
  async getKeyById(id: string) {
    return await this.request(`/v2/GetKeyInfo?id=${encodeURIComponent(id)}`);
  }

  // List all keys
  async listKeys() {
    return await this.request('/v2/ListKeys');
  }

  // Create a bucket
  async createBucket(name: string) {
    const result = await this.request('/v2/CreateBucket', {
      method: 'POST',
      body: JSON.stringify({
        globalAlias: name,
      }),
    });
    return {
      id: result.id,
      globalAlias: result.globalAliases?.[0],
    };
  }

  // Grant bucket permissions to a key
  async allowBucketAccess(bucketId: string, accessKeyId: string, permissions: {
    read?: boolean;
    write?: boolean;
    owner?: boolean;
  }) {
    return await this.request('/v2/AllowBucketKey', {
      method: 'POST',
      body: JSON.stringify({
        bucketId,
        accessKeyId,
        permissions,
      }),
    });
  }

  // Get bucket info by global alias
  async getBucket(globalAlias: string) {
    return await this.request(`/v2/GetBucketInfo?globalAlias=${encodeURIComponent(globalAlias)}`);
  }

  // Get bucket info by ID
  async getBucketById(id: string) {
    return await this.request(`/v2/GetBucketInfo?id=${encodeURIComponent(id)}`);
  }

  // List all buckets
  async listBuckets() {
    return await this.request('/v2/ListBuckets');
  }

  // Get cluster status
  async getClusterStatus() {
    return await this.request('/v2/GetClusterStatus');
  }

  // Get cluster health
  async getClusterHealth() {
    return await this.request('/v2/GetClusterHealth');
  }

  // Get cluster layout
  async getClusterLayout() {
    return await this.request('/v2/GetClusterLayout');
  }
}
```

**Usage Examples:**

**Create Key and Grant Permissions (Full Automation):**
```typescript
import { GarageAdminService } from './services/admin.service';

async function provisionNewApplication(appName: string) {
  const admin = new GarageAdminService();

  // 1. Create a new access key
  const key = await admin.createKey(`${appName}-key`);
  console.log('Created key:', key.accessKeyId);
  console.log('Secret:', key.secretAccessKey);

  // 2. Grant bucket creation permission
  await admin.updateKeyPermissions(key.accessKeyId, {
    createBucket: true,
  });
  console.log('Granted bucket creation permission');

  // 3. Create application bucket
  const bucket = await admin.createBucket(`${appName}-data`);
  console.log('Created bucket:', bucket.globalAlias);

  // 4. Grant full permissions to the key
  await admin.allowBucketAccess(bucket.id, key.accessKeyId, {
    read: true,
    write: true,
    owner: true,
  });
  console.log('Granted bucket permissions');

  return {
    accessKeyId: key.accessKeyId,
    secretAccessKey: key.secretAccessKey,
    bucketName: bucket.globalAlias,
  };
}

// Use it:
const credentials = await provisionNewApplication('my-app');
// Save credentials to your application's config
```

**Create User-Specific Bucket:**
```typescript
async function provisionUserStorage(userId: string) {
  const admin = new GarageAdminService();
  
  // Create user bucket
  const bucketName = `user-${userId}`;
  const bucket = await admin.createBucket(bucketName);
  
  // Grant permissions to existing application key
  const appKeyId = process.env.GARAGE_ACCESS_KEY_ID!;
  await admin.allowBucketAccess(bucket.id, appKeyId, {
    read: true,
    write: true,
    owner: true,
  });
  
  return bucketName;
}
```

**Check Cluster Health:**
```typescript
async function checkClusterHealth() {
  const admin = new GarageAdminService();
  const health = await admin.getClusterHealth();
  
  return {
    status: health.status, // 'healthy', 'degraded', or 'unavailable'
    connectedNodes: health.connectedNodes,
    totalNodes: health.knownNodes,
    storageNodesUp: health.storageNodesUp,
    totalStorageNodes: health.storageNodes,
  };
}
```

**Express Endpoint for Automated Provisioning:**
```typescript
// Admin endpoint to provision new tenant
app.post('/api/admin/provision-tenant', async (req, res) => {
  try {
    const { tenantId } = req.body;
    
    const admin = new GarageAdminService();
    
    // Create tenant-specific key
    const key = await admin.createKey(`tenant-${tenantId}`);
    
    // Create tenant bucket
    const bucket = await admin.createBucket(`tenant-${tenantId}-data`);
    
    // Grant permissions
    await admin.allowBucketAccess(bucket.id, key.accessKeyId, {
      read: true,
      write: true,
      owner: true,
    });
    
    // Store credentials in your database (encrypted!)
    await db.tenants.update(tenantId, {
      garageKeyId: key.accessKeyId,
      garageSecret: encrypt(key.secretAccessKey),
      garageBucket: bucket.globalAlias,
    });
    
    res.json({
      success: true,
      tenantId,
      bucketName: bucket.globalAlias,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

**Full Admin API Documentation:** [Garage Admin API Reference](https://garagehq.deuxfleurs.fr/documentation/reference-manual/admin-api/)

#### AWS CLI Commands

**Note:** Requires AWS CLI configured with Garage credentials (see `.aws/config` and `.aws/credentials` setup above).

| Task | AWS CLI Command |
|------|-----------------|
| Create bucket | `aws s3 mb s3://my-bucket` |
| List buckets | `aws s3 ls` |
| Upload file | `aws s3 cp file.txt s3://my-bucket/` |
| Download file | `aws s3 cp s3://my-bucket/file.txt ./` |
| List objects | `aws s3 ls s3://my-bucket/` |
| Delete object | `aws s3 rm s3://my-bucket/file.txt` |
| Sync directory | `aws s3 sync ./local-dir s3://my-bucket/remote-dir/` |
| Get object metadata | `aws s3api head-object --bucket my-bucket --key file.txt` |

**Note:** AWS CLI **cannot** create keys or manage bucket permissions - use Garage CLI or Admin API for those operations.

#### Node.js (AWS SDK v3) Code Examples

**Create/Check Bucket:**
```typescript
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://cafe-1:3900',
  region: 'garage',
  credentials: {
    accessKeyId: 'GK...',
    secretAccessKey: '...',
  },
  forcePathStyle: true,
});

// Create bucket (requires key to have createBucket permission)
await s3.send(new CreateBucketCommand({ Bucket: 'my-bucket' }));

// Check if bucket exists
try {
  await s3.send(new HeadBucketCommand({ Bucket: 'my-bucket' }));
  console.log('Bucket exists');
} catch (error) {
  console.log('Bucket does not exist');
}
```

**Upload Object:**
```typescript
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const fileContent = readFileSync('./file.txt');
await s3.send(new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt',
  Body: fileContent,
  ContentType: 'text/plain',
}));
```

**Download Object:**
```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';

const response = await s3.send(new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt',
}));

// Stream to file or buffer
const chunks = [];
for await (const chunk of response.Body) {
  chunks.push(chunk);
}
const fileContent = Buffer.concat(chunks);
```

**List Objects:**
```typescript
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

const response = await s3.send(new ListObjectsV2Command({
  Bucket: 'my-bucket',
  Prefix: 'folder/',
  MaxKeys: 100,
}));

for (const object of response.Contents || []) {
  console.log(`${object.Key} - ${object.Size} bytes`);
}
```

**Delete Object:**
```typescript
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

await s3.send(new DeleteObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt',
}));
```

**Generate Presigned URL:**
```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// Upload URL (expires in 5 minutes)
const uploadUrl = await getSignedUrl(
  s3,
  new PutObjectCommand({
    Bucket: 'my-bucket',
    Key: 'file.txt',
    ContentType: 'text/plain',
  }),
  { expiresIn: 300 }
);

// Download URL (expires in 1 hour)
const downloadUrl = await getSignedUrl(
  s3,
  new GetObjectCommand({
    Bucket: 'my-bucket',
    Key: 'file.txt',
  }),
  { expiresIn: 3600 }
);
```

**Admin Operations (using Admin API from Node.js):**
```typescript
// Create key via Admin API
const createKeyResponse = await fetch('http://cafe-1:3903/v1/key', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name: 'my-app-key' }),
});
const keyData = await createKeyResponse.json();
console.log('Key ID:', keyData.accessKeyId);
console.log('Secret:', keyData.secretAccessKey);

// Grant bucket permissions via Admin API
await fetch('http://cafe-1:3903/v1/bucket/allow', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    bucketId: 'bucket-id-here',
    accessKeyId: keyData.accessKeyId,
    permissions: {
      read: true,
      write: true,
      owner: true,
    },
  }),
});
```

**Note:** Node.js AWS SDK **cannot** manage keys or bucket permissions directly - use `fetch()` to call the Garage Admin API for those operations.

### Next Steps

Once you've completed these prerequisites:
1. ✅ Access key created with bucket creation permission
2. ✅ Buckets created and permissions granted
3. ✅ Credentials saved in `.env` file

You're ready to proceed with the Node.js integration below.

## Architecture Overview

```
React App → Express API → Garage S3 API
                ↓
         Admin API (health checks)
```

**Flow:**
1. React app makes requests to Express backend
2. Express authenticates user requests
3. Express uses AWS SDK to interact with Garage
4. Garage stores/retrieves objects
5. Express streams data back to React app

**Why middleware instead of direct access?**
- Secure credential management (never expose keys to client)
- Request validation and rate limiting
- Business logic and authorization
- Object URL presigning for direct uploads/downloads
- Audit logging

## Setup and Configuration

### Install Dependencies

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner express dotenv
npm install --save-dev @types/express @types/node typescript
```

**Recommended SDK: AWS SDK v3 for JavaScript**
- Modern, modular design (import only what you need)
- TypeScript support built-in
- Better performance and smaller bundle size
- Active maintenance and Garage compatibility

### Environment Configuration

Create `.env`:
```env
# Garage Configuration
GARAGE_ENDPOINT=http://your-node:3900
GARAGE_REGION=garage
GARAGE_ACCESS_KEY_ID=GKxxxxxxxxxxxxxxxxxxxx
GARAGE_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Admin API (for health checks)
GARAGE_ADMIN_ENDPOINT=http://your-node:3903
GARAGE_ADMIN_TOKEN=your-admin-token

# Application
PORT=3001
NODE_ENV=production
```

### S3 Client Setup

```typescript
// src/config/garage.ts
import { S3Client } from '@aws-sdk/client-s3';

const garageConfig = {
  endpoint: process.env.GARAGE_ENDPOINT,
  region: process.env.GARAGE_REGION || 'garage',
  credentials: {
    accessKeyId: process.env.GARAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.GARAGE_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true, // Required for Garage!
};

export const s3Client = new S3Client(garageConfig);

// Health check client
export const adminConfig = {
  endpoint: process.env.GARAGE_ADMIN_ENDPOINT,
  token: process.env.GARAGE_ADMIN_TOKEN,
};
```

**Critical Setting:** `forcePathStyle: true` - Garage requires path-style URLs (`http://endpoint/bucket/key`) instead of virtual-host style.

## Bucket Management

### Creating Buckets

```typescript
// src/services/bucket.service.ts
import { 
  CreateBucketCommand, 
  HeadBucketCommand,
  ListBucketsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { s3Client } from '../config/garage';

export class BucketService {
  /**
   * Create a bucket if it doesn't exist
   */
  async ensureBucket(bucketName: string): Promise<void> {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      console.log(`Bucket ${bucketName} already exists`);
    } catch (error: any) {
      if (error.name === 'NotFound') {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`Created bucket ${bucketName}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * List all buckets
   */
  async listBuckets(): Promise<string[]> {
    const response = await s3Client.send(new ListBucketsCommand({}));
    return response.Buckets?.map(b => b.Name!).filter(Boolean) || [];
  }

  /**
   * Delete a bucket (must be empty)
   */
  async deleteBucket(bucketName: string): Promise<void> {
    await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
  }
}
```

### Bucket Naming Strategy

For multi-tenant or organized storage:

```typescript
// src/utils/bucket-naming.ts

export class BucketNamingStrategy {
  /**
   * Generate bucket name for a specific user/tenant
   */
  static userBucket(userId: string): string {
    return `user-${userId.toLowerCase()}`;
  }

  /**
   * Generate bucket name for application data by type
   */
  static appBucket(dataType: string): string {
    return `app-${dataType.toLowerCase()}`;
  }

  /**
   * Generate bucket name for time-series data
   */
  static dateBucket(prefix: string, date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${prefix}-${year}-${month}`;
  }
}

// Usage examples:
// BucketNamingStrategy.userBucket('user123') → 'user-user123'
// BucketNamingStrategy.appBucket('uploads') → 'app-uploads'
// BucketNamingStrategy.dateBucket('logs', new Date()) → 'logs-2025-11'
```

## Date-Based Partitioning Strategy

### Why Date-Based Partitioning?

Benefits:
- **Efficient querying** - List objects within time ranges
- **Easy lifecycle management** - Delete old data by bucket
- **Performance** - Distribute load across buckets
- **Cost optimization** - Archive/delete by time period
- **Compliance** - Retention policies by time bucket

### Implementation

```typescript
// src/services/storage.service.ts
import { BucketNamingStrategy } from '../utils/bucket-naming';

export class StorageService {
  private bucketService = new BucketService();
  private bucketPrefix: string;

  constructor(bucketPrefix: string = 'data') {
    this.bucketPrefix = bucketPrefix;
  }

  /**
   * Get or create bucket for a specific date
   */
  async getBucketForDate(date: Date): Promise<string> {
    const bucketName = BucketNamingStrategy.dateBucket(this.bucketPrefix, date);
    await this.bucketService.ensureBucket(bucketName);
    return bucketName;
  }

  /**
   * Get bucket name and key for timestamped object
   */
  async getStorageLocation(objectId: string, timestamp: Date = new Date()): Promise<{
    bucket: string;
    key: string;
  }> {
    const bucket = await this.getBucketForDate(timestamp);
    
    // Further partition by day within the bucket
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    
    const key = `${year}/${month}/${day}/${objectId}`;
    
    return { bucket, key };
  }

  /**
   * List all buckets within a date range
   */
  async getBucketsInRange(startDate: Date, endDate: Date): Promise<string[]> {
    const buckets: string[] = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      buckets.push(BucketNamingStrategy.dateBucket(this.bucketPrefix, current));
      current.setMonth(current.getMonth() + 1);
    }
    
    return buckets;
  }
}
```

**Partitioning Structure Example:**
```
data-2025-11/          ← Monthly bucket
  ├── 2025/11/15/      ← Daily prefix
  │   ├── file1.jpg
  │   └── file2.pdf
  ├── 2025/11/16/
  │   └── file3.txt
  ...
```

## Object Operations

### Upload Objects

```typescript
// src/services/object.service.ts
import { PutObjectCommand, PutObjectCommandInput } from '@aws-sdk/client-s3';
import { s3Client } from '../config/garage';
import { StorageService } from './storage.service';
import { createHash } from 'crypto';
import { Readable } from 'stream';

export class ObjectService {
  private storageService = new StorageService();

  /**
   * Upload an object with automatic date-based partitioning
   */
  async uploadObject(params: {
    fileId: string;
    data: Buffer | Readable;
    contentType?: string;
    metadata?: Record<string, string>;
    timestamp?: Date;
  }): Promise<{ bucket: string; key: string; etag?: string }> {
    const { fileId, data, contentType, metadata, timestamp = new Date() } = params;
    
    // Get storage location based on timestamp
    const { bucket, key } = await this.storageService.getStorageLocation(
      fileId,
      timestamp
    );

    // Calculate MD5 hash for integrity
    const hash = createHash('md5').update(data).digest('base64');

    const uploadParams: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType || 'application/octet-stream',
      ContentMD5: hash,
      Metadata: {
        uploadedAt: timestamp.toISOString(),
        ...metadata,
      },
    };

    const result = await s3Client.send(new PutObjectCommand(uploadParams));

    return {
      bucket,
      key,
      etag: result.ETag,
    };
  }

  /**
   * Upload with automatic retry
   */
  async uploadWithRetry(
    params: Parameters<typeof this.uploadObject>[0],
    maxRetries: number = 3
  ): Promise<ReturnType<typeof this.uploadObject>> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.uploadObject(params);
      } catch (error) {
        lastError = error as Error;
        console.error(`Upload attempt ${attempt + 1} failed:`, error);
        
        if (attempt < maxRetries - 1) {
          // Exponential backoff
          await new Promise(resolve => 
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
        }
      }
    }
    
    throw lastError;
  }
}
```

### Download Objects

```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export class ObjectService {
  /**
   * Download an object
   */
  async downloadObject(bucket: string, key: string): Promise<{
    data: Readable;
    contentType?: string;
    metadata?: Record<string, string>;
    lastModified?: Date;
  }> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(command);

    return {
      data: response.Body as Readable,
      contentType: response.ContentType,
      metadata: response.Metadata,
      lastModified: response.LastModified,
    };
  }

  /**
   * Check if object exists
   */
  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get object metadata without downloading
   */
  async getObjectMetadata(bucket: string, key: string): Promise<{
    size: number;
    contentType?: string;
    lastModified?: Date;
    metadata?: Record<string, string>;
  }> {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(command);

    return {
      size: response.ContentLength || 0,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      metadata: response.Metadata,
    };
  }
}
```

### List Objects

```typescript
import { ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';

export class ObjectService {
  /**
   * List objects with pagination
   */
  async listObjects(params: {
    bucket: string;
    prefix?: string;
    maxKeys?: number;
    continuationToken?: string;
  }): Promise<{
    objects: _Object[];
    nextToken?: string;
    isTruncated: boolean;
  }> {
    const command = new ListObjectsV2Command({
      Bucket: params.bucket,
      Prefix: params.prefix,
      MaxKeys: params.maxKeys || 1000,
      ContinuationToken: params.continuationToken,
    });

    const response = await s3Client.send(command);

    return {
      objects: response.Contents || [],
      nextToken: response.NextContinuationToken,
      isTruncated: response.IsTruncated || false,
    };
  }

  /**
   * List all objects in date range (across multiple buckets)
   */
  async listObjectsInDateRange(params: {
    startDate: Date;
    endDate: Date;
    prefix?: string;
  }): Promise<Array<{ bucket: string; object: _Object }>> {
    const buckets = await this.storageService.getBucketsInRange(
      params.startDate,
      params.endDate
    );

    const results: Array<{ bucket: string; object: _Object }> = [];

    for (const bucket of buckets) {
      try {
        let continuationToken: string | undefined;
        
        do {
          const response = await this.listObjects({
            bucket,
            prefix: params.prefix,
            continuationToken,
          });

          results.push(
            ...response.objects.map(obj => ({ bucket, object: obj }))
          );

          continuationToken = response.nextToken;
        } while (continuationToken);
      } catch (error: any) {
        if (error.name !== 'NoSuchBucket') {
          throw error;
        }
        // Bucket doesn't exist yet, skip it
      }
    }

    return results;
  }
}
```

### Delete Objects

```typescript
import { 
  DeleteObjectCommand, 
  DeleteObjectsCommand,
  ObjectIdentifier,
} from '@aws-sdk/client-s3';

export class ObjectService {
  /**
   * Delete a single object
   */
  async deleteObject(bucket: string, key: string): Promise<void> {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * Delete multiple objects (batch operation)
   * More efficient than deleting one by one
   */
  async deleteObjects(
    bucket: string,
    keys: string[]
  ): Promise<{ deleted: string[]; errors: Array<{ key: string; error: string }> }> {
    if (keys.length === 0) {
      return { deleted: [], errors: [] };
    }

    // S3 batch delete limit is 1000 objects
    const BATCH_SIZE = 1000;
    const deleted: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      const objects: ObjectIdentifier[] = batch.map(key => ({ Key: key }));

      const command = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects },
      });

      const response = await s3Client.send(command);

      if (response.Deleted) {
        deleted.push(...response.Deleted.map(d => d.Key!).filter(Boolean));
      }

      if (response.Errors) {
        errors.push(
          ...response.Errors.map(e => ({
            key: e.Key!,
            error: `${e.Code}: ${e.Message}`,
          }))
        );
      }
    }

    return { deleted, errors };
  }

  /**
   * Delete all objects in a bucket (with confirmation)
   */
  async deleteAllObjects(bucket: string): Promise<number> {
    let deletedCount = 0;
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.listObjects({
        bucket,
        maxKeys: 1000,
        continuationToken,
      });

      if (listResponse.objects.length > 0) {
        const keys = listResponse.objects.map(obj => obj.Key!).filter(Boolean);
        const { deleted } = await this.deleteObjects(bucket, keys);
        deletedCount += deleted.length;
      }

      continuationToken = listResponse.nextToken;
    } while (continuationToken);

    return deletedCount;
  }

  /**
   * Delete old data based on date threshold
   */
  async deleteOldData(olderThan: Date): Promise<number> {
    const buckets = await this.storageService.getBucketsInRange(
      new Date(0), // Beginning of time
      olderThan
    );

    let totalDeleted = 0;

    for (const bucket of buckets) {
      try {
        const count = await this.deleteAllObjects(bucket);
        totalDeleted += count;
        
        // Optionally delete the bucket itself
        await this.bucketService.deleteBucket(bucket);
        console.log(`Deleted bucket ${bucket} with ${count} objects`);
      } catch (error: any) {
        if (error.name !== 'NoSuchBucket') {
          console.error(`Error deleting bucket ${bucket}:`, error);
        }
      }
    }

    return totalDeleted;
  }
}
```

### Presigned URLs

For direct client uploads/downloads:

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export class ObjectService {
  /**
   * Generate presigned URL for upload (client can upload directly)
   */
  async generateUploadUrl(params: {
    bucket: string;
    key: string;
    contentType?: string;
    expiresIn?: number; // seconds
  }): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });

    return await getSignedUrl(s3Client, command, {
      expiresIn: params.expiresIn || 3600, // 1 hour default
    });
  }

  /**
   * Generate presigned URL for download
   */
  async generateDownloadUrl(params: {
    bucket: string;
    key: string;
    expiresIn?: number;
  }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    });

    return await getSignedUrl(s3Client, command, {
      expiresIn: params.expiresIn || 3600,
    });
  }
}
```

## Cluster Health Monitoring

### Health Check Service

```typescript
// src/services/health.service.ts

export interface ClusterHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  nodes: NodeHealth[];
  layout: {
    version: number;
    roles: number;
  };
  timestamp: Date;
}

export interface NodeHealth {
  id: string;
  addr: string;
  isUp: boolean;
  lastSeenSecsAgo: number;
  hostname?: string;
  zone?: string;
}

export class HealthService {
  private adminEndpoint: string;
  private adminToken: string;

  constructor() {
    this.adminEndpoint = process.env.GARAGE_ADMIN_ENDPOINT!;
    this.adminToken = process.env.GARAGE_ADMIN_TOKEN!;
  }

  /**
   * Get cluster health status
   */
  async getClusterHealth(): Promise<ClusterHealth> {
    const [statusResponse, layoutResponse] = await Promise.all([
      this.fetchAdminAPI('/v1/status'),
      this.fetchAdminAPI('/v1/layout'),
    ]);

    const nodes: NodeHealth[] = Object.entries(statusResponse.nodes).map(
      ([id, node]: [string, any]) => ({
        id,
        addr: node.addr,
        isUp: node.is_up,
        lastSeenSecsAgo: node.last_seen_secs_ago,
        hostname: node.hostname,
        zone: node.zone,
      })
    );

    const unhealthyNodes = nodes.filter(n => !n.isUp).length;
    const status: ClusterHealth['status'] = 
      unhealthyNodes === 0 ? 'healthy' :
      unhealthyNodes < nodes.length / 2 ? 'degraded' :
      'unhealthy';

    return {
      status,
      nodes,
      layout: {
        version: layoutResponse.version,
        roles: Object.keys(layoutResponse.roles || {}).length,
      },
      timestamp: new Date(),
    };
  }

  /**
   * Check if cluster is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const health = await this.getClusterHealth();
      return health.status === 'healthy';
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }

  /**
   * Get storage metrics
   */
  async getMetrics(): Promise<{
    totalSpace: number;
    usedSpace: number;
    availableSpace: number;
    objectCount: number;
  }> {
    // Note: Garage metrics endpoint would be /metrics in Prometheus format
    // For now, approximate by querying buckets
    const buckets = await new BucketService().listBuckets();
    
    // This is a simplified version - in production you'd parse metrics endpoint
    return {
      totalSpace: 0, // Would come from metrics
      usedSpace: 0,
      availableSpace: 0,
      objectCount: 0,
    };
  }

  private async fetchAdminAPI(path: string): Promise<any> {
    const response = await fetch(`${this.adminEndpoint}${path}`, {
      headers: {
        'Authorization': `Bearer ${this.adminToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Admin API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}
```

## Security Best Practices

### 1. Credential Management

```typescript
// ❌ NEVER do this - credentials exposed!
app.get('/api/config', (req, res) => {
  res.json({
    garageEndpoint: process.env.GARAGE_ENDPOINT,
    accessKeyId: process.env.GARAGE_ACCESS_KEY_ID, // ❌ DON'T
    secretAccessKey: process.env.GARAGE_SECRET_ACCESS_KEY, // ❌ DON'T
  });
});

// ✅ Do this - use presigned URLs
app.post('/api/upload-url', authenticateUser, async (req, res) => {
  const { filename, contentType } = req.body;
  const userId = req.user.id;
  
  const location = await storageService.getStorageLocation(
    `${userId}/${filename}`,
    new Date()
  );
  
  const uploadUrl = await objectService.generateUploadUrl({
    bucket: location.bucket,
    key: location.key,
    contentType,
    expiresIn: 300, // 5 minutes
  });
  
  res.json({ uploadUrl, bucket: location.bucket, key: location.key });
});
```

### 2. Input Validation

```typescript
import { z } from 'zod';

const UploadSchema = z.object({
  filename: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._-]+$/),
  contentType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/),
  size: z.number().positive().max(100 * 1024 * 1024), // 100MB
});

app.post('/api/upload', async (req, res) => {
  try {
    const validated = UploadSchema.parse(req.body);
    // Process upload...
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});
```

### 3. Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 uploads per window
  message: 'Too many uploads, please try again later',
});

app.post('/api/upload', uploadLimiter, async (req, res) => {
  // Handle upload
});
```

### 4. Access Control

```typescript
class AccessControlService {
  /**
   * Check if user can access object
   */
  canAccessObject(userId: string, bucket: string, key: string): boolean {
    // Implement your access control logic
    // Example: user can only access their own files
    return key.startsWith(`${userId}/`);
  }

  /**
   * Get allowed bucket for user
   */
  getUserBucket(userId: string): string {
    return BucketNamingStrategy.userBucket(userId);
  }
}
```

## Complete Example

### Express API Implementation

```typescript
// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { ObjectService } from './services/object.service';
import { HealthService } from './services/health.service';
import { StorageService } from './services/storage.service';

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const objectService = new ObjectService();
const healthService = new HealthService();
const storageService = new StorageService('user-data');

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const health = await healthService.getClusterHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

// Upload endpoint (multipart)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const userId = req.headers['x-user-id'] as string; // From auth middleware
    const fileId = `${userId}/${Date.now()}-${req.file.originalname}`;

    const result = await objectService.uploadWithRetry({
      fileId,
      data: req.file.buffer,
      contentType: req.file.mimetype,
      metadata: {
        originalName: req.file.originalname,
        userId,
      },
    });

    res.json({
      success: true,
      bucket: result.bucket,
      key: result.key,
      etag: result.etag,
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed', message: error.message });
  }
});

// Get presigned upload URL
app.post('/api/upload-url', async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    const userId = req.headers['x-user-id'] as string;

    const location = await storageService.getStorageLocation(
      `${userId}/${filename}`,
      new Date()
    );

    const uploadUrl = await objectService.generateUploadUrl({
      bucket: location.bucket,
      key: location.key,
      contentType,
      expiresIn: 300,
    });

    res.json({
      uploadUrl,
      bucket: location.bucket,
      key: location.key,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// Download endpoint
app.get('/api/download/:bucket/:key(*)', async (req, res) => {
  try {
    const { bucket, key } = req.params;
    const userId = req.headers['x-user-id'] as string;

    // Validate access
    if (!key.startsWith(`${userId}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const object = await objectService.downloadObject(bucket, key);
    
    if (object.contentType) {
      res.setHeader('Content-Type', object.contentType);
    }
    
    object.data.pipe(res);
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(500).json({ error: 'Download failed' });
  }
});

// List user's files
app.get('/api/files', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : new Date(0);
    const end = endDate ? new Date(endDate as string) : new Date();

    const objects = await objectService.listObjectsInDateRange({
      startDate: start,
      endDate: end,
      prefix: `${userId}/`,
    });

    const files = objects.map(({ bucket, object }) => ({
      bucket,
      key: object.Key,
      size: object.Size,
      lastModified: object.LastModified,
      etag: object.ETag,
    }));

    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Delete endpoint
app.delete('/api/files/:bucket/:key(*)', async (req, res) => {
  try {
    const { bucket, key } = req.params;
    const userId = req.headers['x-user-id'] as string;

    if (!key.startsWith(`${userId}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await objectService.deleteObject(bucket, key);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Cleanup old data (admin endpoint)
app.post('/api/admin/cleanup', async (req, res) => {
  try {
    const { daysOld } = req.body;
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - daysOld);

    const deletedCount = await objectService.deleteOldData(threshold);
    
    res.json({ success: true, deletedCount });
  } catch (error) {
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### React Frontend Example

```typescript
// src/services/storage.api.ts
const API_BASE = 'http://localhost:3001/api';

export class StorageAPI {
  /**
   * Upload file directly (multipart)
   */
  static async uploadFile(file: File, userId: string): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: {
        'X-User-Id': userId,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    return response.json();
  }

  /**
   * Upload file via presigned URL (recommended for large files)
   */
  static async uploadViaPresignedUrl(
    file: File,
    userId: string
  ): Promise<void> {
    // Get presigned URL from backend
    const urlResponse = await fetch(`${API_BASE}/upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
      }),
    });

    const { uploadUrl } = await urlResponse.json();

    // Upload directly to Garage
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error('Upload failed');
    }
  }

  /**
   * List files
   */
  static async listFiles(userId: string, startDate?: Date, endDate?: Date) {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate.toISOString());
    if (endDate) params.append('endDate', endDate.toISOString());

    const response = await fetch(`${API_BASE}/files?${params}`, {
      headers: {
        'X-User-Id': userId,
      },
    });

    return response.json();
  }

  /**
   * Delete file
   */
  static async deleteFile(bucket: string, key: string, userId: string) {
    const response = await fetch(`${API_BASE}/files/${bucket}/${key}`, {
      method: 'DELETE',
      headers: {
        'X-User-Id': userId,
      },
    });

    return response.json();
  }

  /**
   * Get cluster health
   */
  static async getHealth() {
    const response = await fetch(`${API_BASE}/health`);
    return response.json();
  }
}
```

## Performance Tips

1. **Connection Pooling** - Reuse S3Client instance
2. **Batch Operations** - Use `deleteObjects()` instead of multiple `deleteObject()`
3. **Streaming** - Stream large files instead of buffering
4. **Presigned URLs** - Offload uploads/downloads from your server
5. **Caching** - Cache bucket lists and metadata
6. **Compression** - Compress objects before upload
7. **Parallel Uploads** - Upload multipart for large files

## Error Handling

```typescript
class GarageError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public originalError?: any
  ) {
    super(message);
    this.name = 'GarageError';
  }
}

function handleS3Error(error: any): never {
  if (error.name === 'NoSuchBucket') {
    throw new GarageError('Bucket not found', 'NOT_FOUND', 404, error);
  }
  if (error.name === 'NoSuchKey') {
    throw new GarageError('Object not found', 'NOT_FOUND', 404, error);
  }
  if (error.name === 'AccessDenied') {
    throw new GarageError('Access denied', 'FORBIDDEN', 403, error);
  }
  
  throw new GarageError(
    'Storage operation failed',
    'INTERNAL_ERROR',
    500,
    error
  );
}
```

## See Also

- [AWS SDK v3 Documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Garage S3 Compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
- [Express.js Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
