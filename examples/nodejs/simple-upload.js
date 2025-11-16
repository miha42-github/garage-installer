// Garage S3 - Simple File Upload Example (Node.js)
//
// This example demonstrates basic S3 operations using the AWS SDK v3
// with a Garage cluster.
//
// Installation:
//   npm install @aws-sdk/client-s3
//
// Usage:
//   node simple-upload.js

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

// Configuration
const config = {
  endpoint: process.env.GARAGE_ENDPOINT || 'http://192.168.1.100:3900',
  region: process.env.GARAGE_REGION || 'garage',
  credentials: {
    accessKeyId: process.env.GARAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.GARAGE_SECRET_KEY || ''
  },
  forcePathStyle: true // Required for Garage
};

// Create S3 client
const s3Client = new S3Client(config);

const BUCKET_NAME = 'test-bucket';

// Upload a file
async function uploadFile(fileName, content) {
  console.log(`Uploading: ${fileName}`);
  
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: content,
    ContentType: 'text/plain'
  });
  
  try {
    const response = await s3Client.send(command);
    console.log('✓ Upload successful:', response.ETag);
    return response;
  } catch (error) {
    console.error('✗ Upload failed:', error.message);
    throw error;
  }
}

// Download a file
async function downloadFile(fileName) {
  console.log(`Downloading: ${fileName}`);
  
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName
  });
  
  try {
    const response = await s3Client.send(command);
    const content = await response.Body.transformToString();
    console.log('✓ Download successful');
    return content;
  } catch (error) {
    console.error('✗ Download failed:', error.message);
    throw error;
  }
}

// List objects in bucket
async function listObjects() {
  console.log('Listing objects...');
  
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME
  });
  
  try {
    const response = await s3Client.send(command);
    console.log(`✓ Found ${response.KeyCount} objects:`);
    response.Contents?.forEach(obj => {
      console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
    });
    return response.Contents;
  } catch (error) {
    console.error('✗ List failed:', error.message);
    throw error;
  }
}

// Main execution
async function main() {
  console.log('Garage S3 - Simple Upload Example\n');
  console.log(`Endpoint: ${config.endpoint}`);
  console.log(`Bucket: ${BUCKET_NAME}\n`);
  
  try {
    // Upload text
    await uploadFile('hello.txt', 'Hello from Garage S3!');
    
    // Upload JSON
    const jsonData = JSON.stringify({ message: 'Test data', timestamp: new Date().toISOString() });
    await uploadFile('data.json', jsonData);
    
    // List all objects
    console.log('');
    await listObjects();
    
    // Download and display
    console.log('');
    const content = await downloadFile('hello.txt');
    console.log('File content:', content);
    
    console.log('\n✓ All operations completed!');
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    process.exit(1);
  }
}

main();
