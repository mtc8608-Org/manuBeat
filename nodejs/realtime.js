// [BEDSIDE] Realtime fan-out — a plain WebSocket hub for live telemetry.
//
// The Pi dials OUT over HTTPS (the ingest route); this hub pushes the resulting
// segments to browsers watching the live Monitor. graphql-http is request/response
// only, so we run a small `ws` server on the same HTTP server rather than adding
// GraphQL subscriptions.
//
// Clients connect to:  ws://<host>/ws/bedside?node=<node_key>&stream=<stream_id>
// Both filters are optional; omit to receive everything.
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const clients = new Set(); // { ws, nodeKey, streamId }

// The Express JWT middleware never runs for an upgrade request, so this hub
// authenticates itself or not at all — and what it streams is live patient
// waveforms, i.e. PHI. Same rung as the rest of the bedside domain: tier
// 'admin', checked against a live users.is_active row so deactivation revokes
// here too. Fails closed on anything unexpected.
//
// A browser cannot set headers on a WebSocket handshake, so the token rides in
// the query string (Api.ts subscribeBedside appends it). That puts it in the
// server access log — acceptable for a same-origin, short-lived dev/ops tool,
// and the alternative (Sec-WebSocket-Protocol) is no better. Revisit if the
// Monitor is ever exposed through a logging proxy.
async function authorise(req) {
  try {
    const url   = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) return null;
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (claims && !claims.tier) claims.tier = claims.role;   // legacy tokens
    if (claims?.tier !== 'admin') return null;
    const active = await pool.query('SELECT is_active FROM users WHERE id = $1::uuid', [claims.id]);
    if (!active.rows[0]?.is_active) return null;
    return { claims, nodeKey: url.searchParams.get('node'), streamId: url.searchParams.get('stream') };
  } catch (_) {
    return null;
  }
}

function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/bedside' });
  wss.on('connection', async (ws, req) => {
    const auth = await authorise(req);
    if (!auth) {
      // 1008 = policy violation. Close before registering, so an unauthorised
      // socket never enters `clients` and never receives a broadcast.
      ws.close(1008, 'Unauthorised');
      return;
    }

    const client = { ws, nodeKey: auth.nodeKey, streamId: auth.streamId };
    clients.add(client);
    ws.on('close', () => clients.delete(client));
    ws.on('error', () => clients.delete(client));
  });
  console.log('-> WebSocket hub on /ws/bedside');
}

// Publish a message to every matching client. msg should carry node_key + stream_id.
function broadcast(msg) {
  if (!clients.size) return;
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (c.nodeKey  && c.nodeKey  !== msg.node_key)  continue;
    if (c.streamId && c.streamId !== msg.stream_id) continue;
    if (c.ws.readyState === 1 /* OPEN */) {
      try { c.ws.send(data); } catch (_) { clients.delete(c); }
    }
  }
}

module.exports = { attach, broadcast };
