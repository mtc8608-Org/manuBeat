require('dotenv').config();
const { Pool } = require('pg');
const Minio = require('minio');
const multer = require('multer');

const pool = new Pool({
  user:     process.env.POSTGRES_USER,
  host:     'postgres',
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port:     process.env.PG_PORT,
});

const minioClient = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT,
  port:      parseInt(process.env.MINIO_PORT),
  useSSL:    false,
  accessKey: process.env.MINIO_USER,
  secretKey: process.env.MINIO_PASSWORD,
});

// memoryStorage buffers each upload fully into RAM, so cap what one request
// can hold: 15 MB covers any content image or LaTeX doc, 10 files bounds the
// worst case at 150 MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});
const BUCKET = process.env.MINIO_BUCKET;

module.exports = { pool, minioClient, upload, BUCKET };
