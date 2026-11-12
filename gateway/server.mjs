// Glasses gateway: lets the Even G2 plugin (a cross-origin WebView) use nod's web API.
// Holds nod's owner token; each paired glasses device authenticates with its own token
// (see pair.mjs / README.md). No shared secret is baked into the app bundle anymore.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOD_URL = process.env.NOD_URL ?? 'http://localhost:4310'; // host must match NOD_PUBLIC_URL
const NOD_AUTH_TOKEN = process.env.NOD_AUTH_TOKEN;
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1'; // set to the LAN IP so the phone can reach it
const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 8788); // always bound to loopback only
if (!NOD_AUTH_TOKEN) {
  console.error('Set NOD_AUTH_TOKEN.');
  process.exit(1);
}

// ---- device store: devices.json (next to this script, or DEVICES_FILE), mode 600 ---------
// DEVICES_FILE lets a container keep it on a mounted volume.
const DEVICES_FILE = process.env.DEVICES_FILE || fileURLToPath(new URL('./devices.json', import.meta.url));
function loadDevices() {
  if (!existsSync(DEVICES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DEVICES_FILE, 'utf8')).devices ?? [];
  } catch {
    return [];
  }
}
function saveDevices() {
  writeFileSync(DEVICES_FILE, JSON.stringify({ devices }, null, 2), { mode: 0o600 });
  chmodSync(DEVICES_FILE, 0o600); // mode above only applies when the file is newly created
}
let devices = loadDevices();

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

function findDeviceByToken(token) {
  if (!token) return null;
  const hash = Buffer.from(sha256hex(token));
  for (const device of devices) {
    const stored = Buffer.from(device.tokenHash);
    if (stored.length === hash.length && timingSafeEqual(stored, hash)) return device;
  }
  return null;
}
function addDevice(name) {
  const token = randomBytes(32).toString('base64url');
  const device = { id: randomBytes(8).toString('hex'), name, tokenHash: sha256hex(token), createdAt: new Date().toISOString() };
  devices.push(device);
  saveDevices();
  return { device, token };
}
function revokeDevice(id) {
  const before = devices.length;
  devices = devices.filter((device) => device.id !== id);
  const removed = devices.length !== before;
  if (removed) saveDevices();
  return removed;
}

// ---- pairing: in-memory, nothing to persist across a restart ----------------------
// Plain, easy-to-say words so a human can compare what's on the glasses against what
// the CLI prints before approving. Not a secret: the device token is the secret.
const WORDLIST = [
  'able', 'acid', 'aged', 'also', 'area', 'army', 'away', 'baby', 'back', 'ball',
  'band', 'bank', 'base', 'bath', 'bear', 'beat', 'been', 'beer', 'bell', 'belt',
  'bend', 'best', 'bike', 'bill', 'bird', 'bite', 'blue', 'boat', 'body', 'bold',
  'bolt', 'bone', 'book', 'boot', 'born', 'boss', 'both', 'bowl', 'bulk', 'burn',
  'bush', 'busy', 'cake', 'calm', 'camp', 'card', 'care', 'case', 'cash', 'cast',
  'cave', 'chat', 'chip', 'city', 'clay', 'club', 'coal', 'coat', 'code', 'cold',
  'cook', 'cool', 'copy', 'core', 'cost', 'crew', 'crop', 'cube', 'curl', 'dark',
  'data', 'dawn', 'deal', 'debt', 'deep', 'desk', 'dial', 'dice', 'disc', 'dish',
  'dock', 'does', 'done', 'door', 'dose', 'drag', 'draw', 'drop', 'drum', 'dust',
  'duty', 'each', 'earn', 'east', 'easy', 'edge', 'envy', 'ever', 'face', 'fact',
  'fade', 'fall', 'fame', 'farm', 'fast', 'fate', 'fear', 'feed', 'feel', 'file',
  'film', 'find', 'fine', 'fire', 'firm', 'fish', 'fist', 'five', 'flag', 'flat',
  'flow', 'folk', 'food', 'fool', 'foot', 'fork', 'form', 'fort', 'four', 'free',
  'from', 'fuel', 'full', 'fund', 'gain', 'game', 'gate', 'gaze', 'gear', 'gift',
  'girl', 'give', 'glad', 'goal', 'gold', 'golf', 'good', 'gray', 'grid', 'grip',
  'grow', 'gulf', 'hair', 'half', 'hall', 'hand', 'hard', 'harm', 'hawk', 'head',
  'heap', 'heat', 'help', 'herb', 'here', 'hero', 'hike', 'hill', 'hire', 'hold',
  'hole', 'holy', 'home', 'hood', 'hook', 'hope', 'horn', 'host', 'hour', 'huge',
  'hurt', 'icon', 'idea', 'inch', 'into', 'iron', 'item', 'jazz', 'join', 'joke',
  'jump', 'june', 'junk', 'jury', 'keen', 'keep', 'kind', 'king', 'knee', 'knit',
  'know', 'lack', 'lady', 'lake', 'lamp', 'land', 'lane', 'last', 'late', 'lawn',
  'lead', 'leaf', 'lean', 'leap', 'left', 'lens', 'less', 'life', 'lift', 'like',
  'limb', 'line', 'link', 'lion', 'list', 'live', 'load', 'loan', 'lock', 'logo',
  'long', 'look', 'loop', 'loud', 'love', 'luck', 'lung', 'lure', 'made', 'mail',
  'main', 'make', 'many', 'mark', 'mask', 'mass', 'mast', 'meal', 'mean', 'meat',
  'meet', 'melt', 'mend', 'mesh', 'milk', 'mind', 'mine', 'mint', 'miss', 'mode',
  'mold', 'mood', 'moon', 'more', 'most', 'much', 'must', 'myth', 'name', 'navy',
  'near', 'neat', 'neck', 'need', 'news', 'next', 'nice', 'node', 'none', 'nook',
  'noon', 'norm', 'nose', 'note', 'numb', 'oath', 'odor', 'okay', 'once', 'open',
  'opus', 'oral', 'oven', 'over', 'pace', 'pack', 'page', 'pain', 'pair', 'palm',
  'pant', 'park', 'part', 'pass', 'past', 'path', 'peak', 'pear', 'peel', 'pick',
  'pink', 'pipe', 'plan', 'play', 'plot', 'plum', 'plus', 'poem', 'poet', 'pole',
  'pond', 'pool', 'port', 'pose', 'post', 'pour', 'pray', 'pure', 'push', 'race',
  'rack', 'rain', 'rank', 'rare', 'rate', 'read', 'real', 'reef', 'rent', 'rest',
  'rice', 'rich', 'ride', 'ring', 'rise', 'risk', 'road', 'roam', 'robe', 'rock',
  'role', 'roof', 'root', 'rope', 'rose', 'rule', 'rush', 'rust', 'safe', 'sage',
  'sail', 'salt', 'same', 'sand', 'save', 'seal', 'seat', 'seed', 'seek', 'seem',
  'seen', 'self', 'sell', 'send', 'shed', 'shoe', 'shop', 'shot', 'show', 'shut',
  'sick', 'side', 'sign', 'silk', 'sing', 'site', 'size', 'skin', 'slip', 'slow',
  'snow', 'soap', 'soft', 'soil', 'sold', 'sole', 'song', 'soon', 'sort', 'soul',
  'spin', 'spot', 'star', 'stay', 'step', 'stir', 'stop', 'sure', 'swim', 'take',
  'tale', 'talk', 'tall', 'tank', 'tape', 'task', 'team', 'tear', 'tell', 'tent',
  'term', 'test', 'than', 'that', 'them', 'then', 'they', 'thin', 'this', 'thus',
  'tide', 'time', 'tiny', 'toll', 'tone', 'tool', 'tour', 'town', 'toys', 'trap',
  'tree', 'trip', 'true', 'tube', 'tune', 'turn', 'twin', 'type', 'unit', 'upon',
  'used', 'user', 'vain', 'vast', 'very', 'vest', 'view', 'vivid', 'void', 'vote',
  'wage', 'wait', 'wake', 'walk', 'wall', 'want', 'ward', 'warm', 'wash', 'wave',
  'wear', 'week', 'well', 'west', 'what', 'when', 'whom', 'wide', 'wild', 'will',
  'wind', 'wine', 'wing', 'wire', 'wish', 'with', 'wood', 'wool', 'word', 'work',
  'worn', 'wrap', 'yard', 'yarn', 'year', 'your', 'zero', 'zinc', 'zone',
];
const MAX_PENDING_PAIRINGS = 5;
const PAIRING_TTL_MS = 2 * 60 * 1000;
const WAIT_TIMEOUT_MS = 25 * 1000;
const pairings = new Map(); // pairingId -> { name, words, expiresAt, status, result, waiters }

function sweepExpiredPairings() {
  const now = Date.now();
  for (const [id, pairing] of pairings) if (pairing.expiresAt < now) pairings.delete(id);
}
function pickWords(count = 4) {
  const random = randomBytes(count * 2);
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(WORDLIST[random.readUInt16BE(i * 2) % WORDLIST.length]);
  return picked;
}
// One pending pairing per address (a retry replaces it), and when full the oldest is evicted:
// a noisy LAN client can't lock real glasses out with 429s.
function startPairing(name, address) {
  sweepExpiredPairings();
  for (const [id, pairing] of pairings) if (pairing.status === 'pending' && pairing.address === address) pairings.delete(id);
  // Evict oldest pending only: an approved entry holds a token the glasses haven't collected yet.
  for (const [id, pairing] of pairings) {
    if (pairings.size < MAX_PENDING_PAIRINGS) break;
    if (pairing.status === 'pending') pairings.delete(id);
  }
  const pairingId = randomBytes(32).toString('base64url');
  const pairing = {
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'glasses',
    address,
    words: pickWords(),
    expiresAt: Date.now() + PAIRING_TTL_MS,
    status: 'pending',
    result: null,
    waiters: new Set(),
  };
  pairings.set(pairingId, pairing);
  return { pairingId, pairing };
}
// Approve by the words a human read off the glasses and compared to the CLI's list.
function approvePairingByWords(phrase) {
  sweepExpiredPairings();
  const target = String(phrase ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  for (const [pairingId, pairing] of pairings) {
    if (pairing.status !== 'pending') continue;
    if (pairing.words.join(' ') !== target) continue;
    const { device, token } = addDevice(pairing.name);
    pairing.status = 'approved';
    pairing.expiresAt = Date.now() + PAIRING_TTL_MS; // give the glasses time to collect the token
    pairing.result = { token, deviceId: device.id };
    for (const wake of pairing.waiters) wake();
    pairing.waiters.clear();
    return { pairingId, deviceId: device.id };
  }
  return null;
}
async function waitForPairing(pairingId) {
  sweepExpiredPairings();
  let pairing = pairings.get(pairingId);
  if (!pairing) return { status: 404, body: { error: 'unknown or expired pairing' } };
  if (pairing.status === 'approved') {
    pairings.delete(pairingId); // one-shot: the token is handed over exactly once
    return { status: 200, body: { status: 'approved', ...pairing.result } };
  }
  const timeoutMs = Math.max(0, Math.min(WAIT_TIMEOUT_MS, pairing.expiresAt - Date.now()));
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    pairing.waiters.add(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  pairing = pairings.get(pairingId);
  if (!pairing) return { status: 404, body: { error: 'unknown or expired pairing' } };
  if (pairing.status === 'approved') {
    pairings.delete(pairingId);
    return { status: 200, body: { status: 'approved', ...pairing.result } };
  }
  return { status: 200, body: { status: 'pending' } };
}

async function readJsonBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      throw Object.assign(new Error('payload too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid json'), { statusCode: 400 });
  }
}

// ---- public listener: proxied /api routes + unauthenticated /pair routes ----------
const routes = new Set([
  'POST /api/messages',
  'POST /api/speech/transcribe', // voice: text back for the glasses to confirm; sends nothing
  'POST /api/thread/stop',
  'GET /api/state',
  'GET /api/events',
  'GET /api/messages', // history, paged (read-only)
  'GET /api/models', // model picker (read)
  'PUT /api/models/selection', // model picker (write: changes which model nod uses)
  'GET /api/tasks', // task board (read)
]);
// Routes with an ID in the path (read-only).
const patterns = [/^GET \/api\/artifacts\/[0-9a-f-]{36}$/]; // pictures in presentations
const allowed = (route) => routes.has(route) || patterns.some((pattern) => pattern.test(route));
// Never forward browser-identity or hop-by-hop headers: nod rejects foreign Origin/Sec-Fetch-*.
const dropped = /^(host|origin|referer|cookie|authorization|connection|keep-alive|transfer-encoding|x-glasses-key|sec-fetch-.*)$/i;
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Glasses-Key',
  'access-control-max-age': '86400',
};
const json = (res, status, body) => res.writeHead(status, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(body));

async function handleApiProxy(req, res, url) {
  // EventSource can't set headers, so /api/events also accepts ?key=.
  const presented = req.headers['x-glasses-key'] ?? (url.pathname === '/api/events' ? url.searchParams.get('key') : null);
  if (!findDeviceByToken(presented)) return json(res, 401, { error: 'unpaired' });
  url.searchParams.delete('key');

  const headers = { authorization: `Bearer ${NOD_AUTH_TOKEN}` };
  for (const [name, value] of Object.entries(req.headers)) if (!dropped.test(name)) headers[name] = value;

  const abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
    const upstream = await fetch(NOD_URL + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === 'POST' || req.method === 'PUT' ? Readable.toWeb(req) : undefined,
      duplex: 'half',
      signal: abort.signal,
    });
    const out = { ...cors, 'cache-control': 'no-store' };
    const type = upstream.headers.get('content-type');
    if (type) out['content-type'] = type;
    if (type?.startsWith('text/event-stream')) out['x-accel-buffering'] = 'no';
    res.writeHead(upstream.status, out);
    if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    if (abort.signal.aborted) return;
    if (!res.headersSent) res.writeHead(502, cors);
    res.end(JSON.stringify({ error: 'nod is unreachable' }));
    console.error(error.message);
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://gateway');
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();

  const waitMatch = req.method === 'GET' && url.pathname.match(/^\/pair\/wait\/([^/]+)$/);
  if (req.method === 'POST' && url.pathname === '/pair/start') {
    let body;
    try {
      body = await readJsonBody(req, 1024);
    } catch (error) {
      return json(res, error.statusCode ?? 400, { error: error.message });
    }
    // Behind cloudflared every client arrives from this machine; its CF-Connecting-IP header
    // names the real client. Trust it only from here, or any LAN client could pick its "address".
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    const fromTunnel = peer === HOST || peer === '127.0.0.1' || peer === '::1';
    const address = (fromTunnel && String(req.headers['cf-connecting-ip'] ?? '').slice(0, 64)) || peer;
    const started = startPairing(body.name, address);
    return json(res, 200, {
      pairingId: started.pairingId,
      words: started.pairing.words.join(' '),
      expiresAt: new Date(started.pairing.expiresAt).toISOString(),
    });
  }
  if (waitMatch) {
    const { status, body } = await waitForPairing(decodeURIComponent(waitMatch[1]));
    return json(res, status, body);
  }
  if (allowed(`${req.method} ${url.pathname}`)) return handleApiProxy(req, res, url);
  return res.writeHead(404, cors).end();
}).listen(PORT, HOST, () => console.log(`gateway on ${HOST}:${PORT} -> ${NOD_URL}`));

// ---- admin listener: loopback only, never the LAN ---------------------------------
// Also closed to web pages on this machine: no CORS headers, JSON bodies only (a page can't
// send those without a preflight), no Origin header, and the exact loopback Host (blocks DNS
// rebinding). pair.mjs satisfies all of these.
const adminJson = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://admin');
  if (req.headers.origin || req.headers.host !== `127.0.0.1:${ADMIN_PORT}`) return adminJson(res, 403, { error: 'forbidden' });
  if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json'))
    return adminJson(res, 415, { error: 'send application/json' });
  try {
    if (req.method === 'GET' && url.pathname === '/pairings') {
      sweepExpiredPairings();
      const list = [...pairings].map(([pairingId, pairing]) => ({
        pairingId,
        name: pairing.name,
        words: pairing.words.join(' '),
        status: pairing.status,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
      }));
      return adminJson(res, 200, { pairings: list });
    }
    if (req.method === 'POST' && url.pathname === '/approve') {
      const body = await readJsonBody(req, 1024);
      const approved = approvePairingByWords(body.words);
      if (!approved) return adminJson(res, 404, { error: 'no pending pairing matches those words' });
      return adminJson(res, 200, { ok: true, ...approved });
    }
    if (req.method === 'GET' && url.pathname === '/devices') {
      return adminJson(res, 200, { devices: devices.map(({ id, name, createdAt }) => ({ id, name, createdAt })) });
    }
    if (req.method === 'POST' && url.pathname === '/revoke') {
      const body = await readJsonBody(req, 1024);
      if (!revokeDevice(body.id)) return adminJson(res, 404, { error: 'no such device' });
      return adminJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/mint') {
      const body = await readJsonBody(req, 1024);
      if (!body.name) return adminJson(res, 400, { error: 'name is required' });
      const { device, token } = addDevice(body.name);
      return adminJson(res, 200, { deviceId: device.id, token });
    }
  } catch (error) {
    return adminJson(res, error.statusCode ?? 500, { error: error.message });
  }
  return adminJson(res, 404, { error: 'not found' });
}).listen(ADMIN_PORT, '127.0.0.1', () => console.log(`gateway admin on 127.0.0.1:${ADMIN_PORT}`));
