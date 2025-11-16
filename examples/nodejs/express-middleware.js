// Garage S3 - Express File Upload Middleware Example
//
// This example demonstrates how to integrate Garage S3 into an Express.js
// application for handling file uploads.
//
// Installation:
//   npm install express multer @aws-sdk/client-s3 multer-s3
//
// Usage:
//   node express-middleware.js
//   Then: curl -F "file=@test.txt" http://localhost:3000/upload

import express from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

const app = express();
const PORT = 3000;

// Configure S3 client for Garage
const s3Client = new S3Client({
  endpoint: process.env.GARAGE_ENDPOINT || 'http://192.168.1.100:3900',
  region: process.env.GARAGE_REGION || 'garage',
  credentials: {
    accessKeyId: process.env.GARAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.GARAGE_SECRET_KEY || ''
  },
  forcePathStyle: true
});

const BUCKET_NAME = 'uploads';

// Configure multer to upload to S3
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: BUCKET_NAME,
    metadata: (req, file, cb) => {
      cb(null, {
        fieldName: file.fieldname,
        uploadDate: new Date().toISOString()
      });
    },
    key: (req, file, cb) => {
      // Generate unique filename
      const timestamp = Date.now();
      const filename = `${timestamp}-${file.originalname}`;
      cb(null, filename);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Middleware
app.use(express.json());

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  res.json({
    message: 'File uploaded successfully',
    file: {
      key: req.file.key,
      size: req.file.size,
      contentType: req.file.contentType,
      location: req.file.location
    }
  });
});

// Multiple files upload
app.post('/upload-multiple', upload.array('files', 5), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  
  const files = req.files.map(file => ({
    key: file.key,
    size: file.size,
    contentType: file.contentType
  }));
  
  res.json({
    message: `${files.length} files uploaded successfully`,
    files
  });
});

// List uploaded files
app.get('/files', async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME
    });
    
    const response = await s3Client.send(command);
    
    const files = response.Contents?.map(obj => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified
    })) || [];
    
    res.json({
      count: files.length,
      files
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file
app.delete('/files/:key', async (req, res) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: req.params.key
    });
    
    await s3Client.send(command);
    
    res.json({
      message: 'File deleted successfully',
      key: req.params.key
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bucket: BUCKET_NAME,
    endpoint: process.env.GARAGE_ENDPOINT
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }
    return res.status(400).json({ error: error.message });
  }
  
  res.status(500).json({ error: error.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Garage endpoint: ${process.env.GARAGE_ENDPOINT || 'http://192.168.1.100:3900'}`);
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log('\nAvailable endpoints:');
  console.log('  POST   /upload           - Upload single file');
  console.log('  POST   /upload-multiple  - Upload multiple files (max 5)');
  console.log('  GET    /files            - List all uploaded files');
  console.log('  DELETE /files/:key       - Delete a file');
  console.log('  GET    /health           - Health check');
  console.log('\nExample usage:');
  console.log('  curl -F "file=@test.txt" http://localhost:3000/upload');
});
