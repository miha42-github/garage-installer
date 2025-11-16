// Garage S3 - Multipart Upload Example
//
// This example demonstrates how to upload large files using multipart upload,
// which is more efficient and allows resuming interrupted uploads.
//
// Installation:
//   npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
//
// Usage:
//   node multipart-upload.js <file-path>

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream, statSync } from 'fs';
import { basename } from 'path';

// Configuration
const s3Client = new S3Client({
  endpoint: process.env.GARAGE_ENDPOINT || 'http://192.168.1.100:3900',
  region: process.env.GARAGE_REGION || 'garage',
  credentials: {
    accessKeyId: process.env.GARAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.GARAGE_SECRET_KEY || ''
  },
  forcePathStyle: true
});

const BUCKET_NAME = 'large-files';
const PART_SIZE = 5 * 1024 * 1024; // 5MB parts (minimum for S3)

// Format bytes to human-readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Upload file with multipart upload
async function uploadLargeFile(filePath) {
  try {
    // Get file info
    const stats = statSync(filePath);
    const fileName = basename(filePath);
    const fileSize = stats.size;
    
    console.log('Starting multipart upload...');
    console.log(`File: ${fileName}`);
    console.log(`Size: ${formatBytes(fileSize)}`);
    console.log(`Part size: ${formatBytes(PART_SIZE)}`);
    console.log(`Estimated parts: ${Math.ceil(fileSize / PART_SIZE)}`);
    console.log('');
    
    // Create file stream
    const fileStream = createReadStream(filePath);
    
    // Create multipart upload
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: fileStream,
        ContentType: 'application/octet-stream'
      },
      queueSize: 4, // Number of concurrent parts
      partSize: PART_SIZE,
      leavePartsOnError: false // Clean up on failure
    });
    
    // Track progress
    let lastProgress = 0;
    upload.on('httpUploadProgress', (progress) => {
      if (progress.loaded && progress.total) {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        if (percent !== lastProgress) {
          lastProgress = percent;
          const loaded = formatBytes(progress.loaded);
          const total = formatBytes(progress.total);
          process.stdout.write(`\rProgress: ${percent}% (${loaded} / ${total})`);
        }
      }
    });
    
    // Execute upload
    const result = await upload.done();
    
    console.log('\n\n✓ Upload completed successfully!');
    console.log(`ETag: ${result.ETag}`);
    console.log(`Location: ${result.Location}`);
    console.log(`Key: ${result.Key}`);
    
    return result;
  } catch (error) {
    console.error('\n✗ Upload failed:', error.message);
    throw error;
  }
}

// Abort upload (useful for cleanup)
async function abortUpload(upload) {
  try {
    await upload.abort();
    console.log('Upload aborted');
  } catch (error) {
    console.error('Failed to abort upload:', error.message);
  }
}

// Main execution
async function main() {
  console.log('Garage S3 - Multipart Upload Example\n');
  console.log(`Endpoint: ${process.env.GARAGE_ENDPOINT || 'http://192.168.1.100:3900'}`);
  console.log(`Bucket: ${BUCKET_NAME}\n`);
  
  // Check for file argument
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node multipart-upload.js <file-path>');
    console.error('Example: node multipart-upload.js ~/large-file.zip');
    process.exit(1);
  }
  
  // Check if file exists
  try {
    statSync(filePath);
  } catch (error) {
    console.error(`✗ File not found: ${filePath}`);
    process.exit(1);
  }
  
  // Upload the file
  try {
    await uploadLargeFile(filePath);
  } catch (error) {
    console.error('Upload error:', error);
    process.exit(1);
  }
}

main();
