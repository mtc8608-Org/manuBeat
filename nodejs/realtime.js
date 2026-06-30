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

const clients = new Set(); // { ws, nodeKey, streamId }

function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/bedside' });
  wss.on('connection', (ws, req) => {
    let nodeKey = null, streamId = null;
    try {
      const url = new URL(req.url, 'http://localhost');
      nodeKey  = url.searchParams.get('node');
      streamId = url.searchParams.get('stream');
    } catch (_) { /* keep nulls = subscribe to all */ }

    const client = { ws, nodeKey, streamId };
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
