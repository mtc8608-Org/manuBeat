require('dotenv').config();
const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');
const { pool, minioClient, BUCKET } = require('./db');
const { handler: graphqlHandler }   = require('./schema');

const PORT   = process.env.NODE_PORT;
const server = express();

// The default body cap is 100 kB and applies to /graphql too, where a large CMS
// save (updateComponent with an HTML-heavy content tree) can exceed it and 413.
// Deliberate limit rather than an inherited one; file uploads do not pass
// through here — multer has its own caps in db.js.
// [BEDSIDE] Telemetry ingest is the one route that legitimately exceeds 2 MB: a
// full manuEdge batch is uplink.batch_records (200) segments of up to
// sampler.max_samples (1000) JSON floats each, ~2.4 MB worst case, and a 413
// there nacks the batch and wedges the Pi in a retry loop. Mounted BEFORE the
// global parser on purpose — body-parser skips a request whose body is already
// parsed, so the first matching parser wins and everything else stays at 2 MB.
server.use('/api/bedside/ingest', express.json({ limit: '16mb' }));
server.use(express.json({ limit: '2mb' }));

// No CORS middleware on purpose. The PWA calls API_BASE '/api' and '/graphql'
// origin-relative: in dev the vite proxy forwards them, in production Caddy
// serves the built PWA and the API from the same host. Nothing is ever
// cross-origin, so a permissive `cors()` only widened who could call the API
// from a browser. Re-add it scoped to an explicit origin list if an app ever
// serves its frontend from a different host — never bare `cors()`.

// Exactly one reverse-proxy hop (Caddy) in front of node in production, so
// req.ip must come from its X-Forwarded-For — the login rate limiter keys on
// it, and without this every client would share the proxy's IP (one attacker
// could lock everyone out). Harmless in dev, where there is no proxy.
server.set('trust proxy', 1);

// ── JWT decode middleware ──────────────────────────────────────────────────────
// Runs on every request. Attaches req.user if token is present, valid, and the
// account is still active. Always calls next() — public routes continue without
// a token; it is the routes and the GraphQL gate that reject.
//
// The is_active lookup is what makes deactivation take effect: tokens live 7
// days and carry the tier as a claim, so without a DB check a deactivated user
// keeps full access until expiry. Doing it here covers REST and GraphQL in one
// place. Costs one indexed lookup per authenticated request — if that ever
// shows up in profiling, cache it with a short TTL rather than dropping it.
// Fails closed: any error (bad token, DB down) leaves req.user null.
server.use(async (req, res, next) => {
  req.user = null;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const claims = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      // All auth checks compare req.user.tier (the roles-table tier resolved
      // at login). Tokens issued before the tier claim existed carry only the
      // role name — for the three system roles name === tier, so fall back.
      if (claims && !claims.tier) claims.tier = claims.role;
      const active = await pool.query('SELECT is_active FROM users WHERE id = $1::uuid', [claims.id]);
      if (active.rows[0]?.is_active) req.user = claims;
    } catch (_) {
      req.user = null;
    }
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
// [SURVEYS]
server.use('/api', require('./routes/surveys/stats'));
// [MEDICAL]
server.use('/api', require('./routes/medical/models'));
// [BEDSIDE]
server.use('/api', require('./routes/bedside/patients'));
server.use('/api', require('./routes/bedside/ingest'));

// ── Startup ───────────────────────────────────────────────────────────────────
// Start listening immediately so the container is healthy, then seed the admin
// user in the background with retries (postgres may not be ready yet).

if (!/^[0-9a-fA-F]{64}$/.test(process.env.SECRETS_MASTER_KEY ?? '')) {
  console.warn('-> SECRETS_MASTER_KEY missing or not 64 hex chars — the user_secrets keychain is disabled (generate one with `openssl rand -hex 32` and add it to .env)');
}

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
            // is_public: these are Landing/CMS images and must render for
            // anonymous visitors (see the files table comment in 01-init-db.sql).
            await pool.query(
              `INSERT INTO files (bucket, key, filename, mime_type, size, description, is_public)
               VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT (bucket, key) DO NOTHING`,
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
