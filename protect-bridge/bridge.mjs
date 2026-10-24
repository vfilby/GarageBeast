#!/usr/bin/env node
// UniFi Protect -> garage-eyes bridge. Zero dependencies, Node 22+.
// Logs into the Protect console with a local account, follows the classic update
// websocket, and sends {cmd:'motion'} (stir: dark eyes to slits) to the eyes relay whenever the driveway
// camera reports a smart detection, or {cmd:'wake'} (open) when the detection includes a person.
// Optional coarse {cmd:'look'} per Protect zone.
// Env: PROTECT_HOST PROTECT_USER PROTECT_PASS CAMERA_ID (overrides config.camera) RELAY_URL (ws://halloween-eyes:8000) BRIDGE_CONFIG (config.json)
import zlib from 'node:zlib';
import fs from 'node:fs';

const HOST = process.env.PROTECT_HOST;
const USER = process.env.PROTECT_USER, PASS = process.env.PROTECT_PASS;
const RELAY = process.env.RELAY_URL || 'ws://halloween-eyes:8000';
const CFG = JSON.parse(fs.readFileSync(process.env.BRIDGE_CONFIG || 'config.json', 'utf8'));
if (process.env.CAMERA_ID) CFG.camera = process.env.CAMERA_ID;
if (!HOST || !USER || !PASS || !CFG.camera) { console.error('PROTECT_HOST, PROTECT_USER, PROTECT_PASS and CAMERA_ID (or config.camera) are required'); process.exit(1); }
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---- relay client (reconnecting, small send queue) ----
let relay = null; const pending = [];
function relayConnect() {
  const ws = new WebSocket(RELAY);
  ws.onopen = () => { relay = ws; log('relay connected', RELAY); while (pending.length) ws.send(pending.shift()); };
  ws.onclose = () => { if (relay) log('relay closed'); relay = null; setTimeout(relayConnect, 2000); };
  ws.onerror = () => {};
}
function send(msg) {
  const s = JSON.stringify(msg);
  if (relay && relay.readyState === 1) relay.send(s); else if (pending.length < 20) pending.push(s);
}
relayConnect();

// ---- Protect session ----
async function login() {
  const r = await fetch(`https://${HOST}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, rememberMe: true }),
  });
  if (!r.ok) throw new Error(`login failed: HTTP ${r.status}`);
  const csrf = r.headers.get('x-csrf-token');
  const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return { csrf, cookie };
}
// Protect ws frames: [8-byte header][action json][8-byte header][data json]; header byte1=format(1=json), byte2=deflated, bytes4-7=size
function decode(buf) {
  const out = []; let off = 0;
  while (off + 8 <= buf.length) {
    const fmt = buf[off + 1], defl = buf[off + 2], size = buf.readUInt32BE(off + 4);
    let p = buf.subarray(off + 8, off + 8 + size); if (defl) p = zlib.inflateSync(p);
    out.push(fmt === 1 ? JSON.parse(p.toString()) : p.toString()); off += 8 + size;
  }
  return out;
}

// ---- event handling ----
const events = new Map();          // event id -> {type, smart, t}
let lastMotion = 0;
function onEvent(action, data) {
  if (action.modelKey !== 'event') return;
  const cam = action.recordId || data.camera;
  if (cam !== CFG.camera) return;
  let ev = events.get(action.id);
  if (!ev) { ev = { type: data.type, smart: data.smartDetectTypes || [], t: Date.now() }; events.set(action.id, ev); }
  if (data.type) ev.type = data.type;
  if (data.smartDetectTypes) ev.smart = data.smartDetectTypes;
  if (data.end) { events.delete(action.id); return; }          // event over; the eyes doze on their own timer
  if (!CFG.event_types.includes(ev.type)) return;
  if (ev.type !== 'motion' && !ev.smart.some(t => CFG.wake_types.includes(t))) return;
  const zs = data.metadata?.zonesStatus || data.metadata?.loiterStatus || {};
  const active = Object.entries(zs).filter(([, z]) => z.status === 'enter' || z.status === 'moving').map(([id]) => id);
  if (active.length && active.every(id => CFG.zones?.[id]?.wake === false)) return;   // only in muted zones
  const now = Date.now();
  if (now - lastMotion >= (CFG.min_interval_ms ?? 1000)) {
    const cmd = ev.smart.includes('person') ? 'wake' : 'motion';   // a person opens the eyes; anything else only stirs them
    send({ cmd, src: 'protect', zones: active.map(id => CFG.zones?.[id]?.name || id) }); lastMotion = now;
    log(cmd, ev.type, ev.smart.join(',') || '-', 'zones', active.map(id => CFG.zones?.[id]?.name || id).join(',') || '-');
  }
  if (CFG.zone_look) for (const id of active) {
    const l = CFG.zones?.[id]?.look;
    if (l) { send({ cmd: 'look', x: l[0], y: l[1], hold: CFG.look_hold ?? 3, src: 'protect', zone: CFG.zones[id].name || id }); break; }
  }
}
setInterval(() => { const cut = Date.now() - 10 * 60e3; for (const [id, ev] of events) if (ev.t < cut) events.delete(id); }, 60e3);

// ---- main loop: login, subscribe, reconnect on any failure ----
let backoff = 2000;
async function run() {
  for (;;) {
    try {
      const { csrf, cookie } = await login();
      log('logged in to', HOST);
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://${HOST}/proxy/protect/ws/updates`, { headers: { Cookie: cookie, 'X-CSRF-Token': csrf } });
        ws.binaryType = 'arraybuffer';
        let idle = null;
        const kick = () => { clearTimeout(idle); idle = setTimeout(() => { log('no updates for 120s, reconnecting'); ws.close(); }, 120e3); };
        ws.onopen = () => { log('protect updates websocket open'); backoff = 2000; kick(); };
        ws.onmessage = m => {
          kick();
          try { const [action, data] = decode(Buffer.from(m.data)); onEvent(action, data); }
          catch (e) { log('decode error', e.message); }
        };
        ws.onerror = e => reject(new Error('websocket error ' + (e.message || '')));
        ws.onclose = e => { clearTimeout(idle); resolve(e.code); };
      });
      log('websocket closed');
    } catch (e) {
      log('error:', e.message);
      await new Promise(r => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 60e3);
      continue;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
run();
