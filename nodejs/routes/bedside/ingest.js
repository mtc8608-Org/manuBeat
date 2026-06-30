// [BEDSIDE] Telemetry ingest — the endpoint the edge agent (manuEdge) dials home to.
//
// The Pi posts batches of segments/events over HTTPS and periodic heartbeats. Auth
// is a per-device token (Bearer): we resolve the node by node_key (= agent node_id)
// and bcrypt-compare the token against bedside_nodes.token_hash. Segments are
// deduped on (node_id, stream_id, seq) for idempotent backfill, stored in the hot
// table, and broadcast to live Monitor clients over WebSocket.
//
// Contract: must match manuEdge src/manuedge/contract/. Bump SCHEMA_VERSION on both
// sides when the record shapes change.
const express = require('express');
const bcrypt  = require('bcryptjs');
const { pool } = require('../../db');
const realtime = require('../../realtime');

const router = express.Router();

const SCHEMA_VERSION = '0.1.0';

// Pull the raw Bearer token (the device token is NOT a JWT, so req.user is null).
const bearer = (req) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};

// Resolve + authenticate the node from the request body's node_id + Bearer token.
async function authNode(req, res) {
  const nodeKey = req.body?.node_id;
  const token   = bearer(req);
  if (!nodeKey || !token) {
    res.status(401).json({ error: 'node_id and device token required' });
    return null;
  }
  const { rows } = await pool.query('SELECT * FROM bedside_nodes WHERE node_key = $1', [nodeKey]);
  const node = rows[0];
  if (!node || !node.token_hash || !(await bcrypt.compare(token, node.token_hash))) {
    res.status(401).json({ error: 'invalid node or token' });
    return null;
  }
  return node;
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.socket?.remoteAddress || null;

// POST /api/bedside/ingest  { schema_version, node_id, records: [segment|event] }
router.post('/bedside/ingest', async (req, res) => {
  try {
    if (req.body?.schema_version !== SCHEMA_VERSION) {
      return res.status(400).json({ error: `unsupported schema_version (server ${SCHEMA_VERSION})` });
    }
    const node = await authNode(req, res);
    if (!node) return;

    await pool.query(
      `UPDATE bedside_nodes SET status='online', last_seen=now(), ip_address=$2 WHERE id=$1`,
      [node.id, clientIp(req)],
    );

    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    let acceptedSegments = 0, dedupedSegments = 0, events = 0;
    const broadcasts = [];

    for (const r of records) {
      if (r.type === 'segment') {
        // upsert the stream registry
        await pool.query(
          `INSERT INTO bedside_streams
             (node_id, stream_id, modality, "group", channel, units, metric, sampling_hz, source, last_seq, last_time_us, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
           ON CONFLICT (node_id, stream_id) DO UPDATE SET
             modality=EXCLUDED.modality, "group"=EXCLUDED."group", channel=EXCLUDED.channel,
             units=EXCLUDED.units, metric=EXCLUDED.metric, sampling_hz=EXCLUDED.sampling_hz,
             source=EXCLUDED.source,
             last_seq=GREATEST(bedside_streams.last_seq, EXCLUDED.last_seq),
             last_time_us=GREATEST(bedside_streams.last_time_us, EXCLUDED.last_time_us),
             updated_at=now()`,
          [node.id, r.stream_id, r.modality, r.group, r.channel ?? null, r.units ?? null,
           r.metric ?? null, r.sampling_hz, r.source ?? null, r.seq, r.start_time_us],
        );

        const ins = await pool.query(
          `INSERT INTO bedside_segments
             (node_id, stream_id, seq, start_time_us, sampling_hz, duration, samples, quality)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT (node_id, stream_id, seq) DO NOTHING
           RETURNING id`,
          [node.id, r.stream_id, r.seq, r.start_time_us, r.sampling_hz, r.duration,
           r.samples, JSON.stringify(r.quality ?? [])],
        );
        if (ins.rowCount) {
          acceptedSegments++;
          broadcasts.push({
            type: 'segment', node_key: node.node_key, stream_id: r.stream_id,
            modality: r.modality, seq: r.seq, start_time_us: r.start_time_us,
            sampling_hz: r.sampling_hz, duration: r.duration, samples: r.samples,
            quality: r.quality ?? [],
          });
        } else {
          dedupedSegments++;
        }
      } else if (r.type === 'event') {
        await pool.query(
          `INSERT INTO bedside_events (node_id, kind, code, ts_ms, duration_ms, comment, value)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [node.id, r.kind, r.code, r.ts_ms, r.duration_ms ?? null, r.comment ?? null, r.value ?? null],
        );
        events++;
      }
    }

    // broadcast after the DB writes so live viewers only see persisted data
    for (const b of broadcasts) realtime.broadcast(b);

    res.json({ ok: true, accepted: acceptedSegments, deduped: dedupedSegments, events });
  } catch (err) {
    console.error('bedside/ingest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bedside/heartbeat  { node_id, ts_ms, agent_version, cpu_temp_c, ... }
router.post('/bedside/heartbeat', async (req, res) => {
  try {
    const node = await authNode(req, res);
    if (!node) return;
    const b = req.body ?? {};
    await pool.query(
      `UPDATE bedside_nodes SET status='online', last_seen=now(), ip_address=$2, agent_version=$3 WHERE id=$1`,
      [node.id, clientIp(req), b.agent_version ?? null],
    );
    await pool.query(
      `INSERT INTO node_heartbeats
         (node_id, ts_ms, cpu_temp_c, disk_free_bytes, buffer_pending, last_sample_us, agent_version)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [node.id, b.ts_ms ?? null, b.cpu_temp_c ?? null, b.disk_free_bytes ?? null,
       b.buffer_pending ?? null, JSON.stringify(b.last_sample_us ?? {}), b.agent_version ?? null],
    );
    realtime.broadcast({ type: 'heartbeat', node_key: node.node_key,
      cpu_temp_c: b.cpu_temp_c, buffer_pending: b.buffer_pending, ts_ms: b.ts_ms });
    res.json({ ok: true });
  } catch (err) {
    console.error('bedside/heartbeat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
