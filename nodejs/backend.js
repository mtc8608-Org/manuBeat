require('dotenv').config();
const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const { pool, minioClient, BUCKET } = require('./db');
const { handler: graphqlHandler }   = require('./schema');

const PORT   = process.env.NODE_PORT;
const server = express();

server.use(express.json());
server.use(cors());

// ── JWT decode middleware ──────────────────────────────────────────────────────
// Runs on every request. Attaches req.user if token is present and valid.
// Always calls next() — public routes continue even without a token.
server.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    } catch (_) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
});

// ── Request logger ────────────────────────────────────────────────────────────
server.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const user = req.user?.id ?? 'anon';
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms user=${user}`);
  });
  next();
});

// ── GraphQL ───────────────────────────────────────────────────────────────────
server.all('/graphql', graphqlHandler);

// ── REST routes ───────────────────────────────────────────────────────────────
// [FRAMEWORK]
server.use('/api', require('./routes/framework/auth'));
server.use('/api', require('./routes/framework/files'));
server.use('/api', require('./routes/framework/content'));
server.use('/api', require('./routes/framework/compute'));
// [MEDICAL]
server.use('/api', require('./routes/medical/models'));
// [BEDSIDE]
server.use('/api', require('./routes/bedside/patients'));
server.use('/api', require('./routes/bedside/ingest'));

// ── Startup ───────────────────────────────────────────────────────────────────
// Start listening immediately so the container is healthy, then seed the admin
// user in the background with retries (postgres may not be ready yet).

const httpServer = server.listen(PORT, () => console.log('Server running on PORT http://localhost:' + PORT));
// [BEDSIDE] attach the live telemetry WebSocket hub to the same HTTP server
require('./realtime').attach(httpServer);

(async () => {
  const MAX = 15;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const count = await pool.query('SELECT COUNT(*) FROM users');
      if (parseInt(count.rows[0].count, 10) === 0) {
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        await pool.query(
          'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
          [process.env.ADMIN_EMAIL, hash, 'admin']
        );
        console.log('-> Admin user seeded:', process.env.ADMIN_EMAIL);
      } else {
        console.log('-> Users table already populated, skipping seed');
      }

      // ── MinIO bucket + content image seed ─────────────────────────────────
      try {
        const bucketExists = await minioClient.bucketExists(BUCKET);
        if (!bucketExists) await minioClient.makeBucket(BUCKET);
        console.log('-> MinIO bucket ready:', BUCKET);

        // Any .png under /public (recursive, except favicon.png) is seeded
        // under key seed-<basename>. The seed SQL references these stable keys
        // so content images survive a DB reset.
        const SKIP_PNGS = new Set(['favicon.png']);
        const PNG_MIME  = 'image/png';
        const getAllPngs = (dir) => {
          if (!fs.existsSync(dir)) return [];
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          const results = [];
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) results.push(...getAllPngs(full));
            else if (e.isFile() && e.name.endsWith('.png') && !SKIP_PNGS.has(e.name)) results.push(full);
          }
          return results;
        };
        const pngPaths = getAllPngs('/public');
        for (const filePath of pngPaths) {
          const filename     = path.basename(filePath);
          const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          const key          = `seed-${safeFilename}`;
          let exists = false;
          try { await minioClient.statObject(BUCKET, key); exists = true; } catch (_) {}
          if (!exists) {
            const buf = fs.readFileSync(filePath);
            await minioClient.putObject(BUCKET, key, buf, buf.length, { 'Content-Type': PNG_MIME });
            await pool.query(
              `INSERT INTO files (bucket, key, filename, mime_type, size, description)
               VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (bucket, key) DO NOTHING`,
              [BUCKET, key, filename, PNG_MIME, buf.length, 'Seeded content image']
            );
            console.log(`-> Seeded content image: ${key}`);
          }
        }
        console.log(`-> Content image seed done (${pngPaths.length} files checked)`);
      } catch (minioErr) {
        console.warn('-> MinIO seed warning:', minioErr.message);
      }
      break;
    } catch (e) {
      if (attempt === MAX) {
        console.error('-> Admin seed failed after all retries:', e.message);
      } else {
        console.log(`-> DB not ready (attempt ${attempt}/${MAX}), retrying in 2s…`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
})();
