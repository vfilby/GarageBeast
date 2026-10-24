#!/usr/bin/env node
// Zero-dependency static server + WebSocket relay + behaviour "brain" for the garage eyes.
//   node server.js [port]           (default 8000)
//   env: SLEEP_AFTER=10  seconds without motion before the eyes doze off
//        OFF_AFTER=20    seconds without any motion (slits stage) before the eyes go dark
//        COOLDOWN=5      seconds after a manual command during which tracker/protect commands are dropped
//        GROWL_EVERY=20  minimum seconds between wake growls (pages opened with ?sound=1 play them); SOUND=0 starts muted
//        RUMBLE="6 10"   while awake, after the growl: a soft sound every 6–10 s (random). The first of a visit is a sniff, and
//                        the eyes squint while they sniff; later ones are purrs / breaths with the odd sniff. RUMBLE=0 = off
//        BURST="0 4 7"   extra growls while the eyes hold a target: count, then min–max seconds apart. Off by default: one growl
//                        per wake is plenty, back-to-back growls are a bit much (user verdict 2026-09-19)
//        PJ_HOSTS="left-projector right-projector"  projectors to poll over PJLink (empty = no polling)
//        PJ_PASSWORD=admin  PJLink password (= the projector web Admin password)   PJ_POLL=10  seconds between polls
// Serves this directory over HTTP; any WebSocket client connecting to the same port gets every JSON
// message sent by any other client (controller/tracker/bridge -> eyes).
//
// The server is the leader: it owns the idle behaviour (sleep/wake timer, idle saccades, blinks,
// slumber twitches) and the current style/mood/auto state, and emits those as ordinary commands
// tagged src:'brain'. Every eye window is a follower that only interpolates and renders, so any
// number of windows stay in step. On connect a client gets {cmd:'sync'} with the current state.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +(process.argv[2] || 8000);
const SLEEP_AFTER = +(process.env.SLEEP_AFTER || 10);
const OFF_AFTER = +(process.env.OFF_AFTER || 20);
const COOLDOWN = +(process.env.COOLDOWN ?? 5);
const GROWL_EVERY = +(process.env.GROWL_EVERY ?? 20);
const [RUMBLE_MIN, RUMBLE_MAX = RUMBLE_MIN] = (process.env.RUMBLE ?? '6 10').split(/\s+/).map(Number);
const [BURST_N, BURST_MIN = 4, BURST_MAX = Math.max(BURST_MIN, 7)] = (process.env.BURST ?? '0 4 7').split(/\s+/).map(Number);
const BURST_WINDOW = 30;   // "shortly after waking": growls not used up this many seconds after the wake are dropped
const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
               '.json': 'application/json', '.txt': 'text/plain', '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4',
               '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };   // audio: the growl samples in sounds/

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ...B, clients: clients.size, sleepAfter: SLEEP_AFTER, offAfter: OFF_AFTER, cooldown: COOLDOWN, now: now() }));
  }
  if (url.pathname === '/report' && req.method === 'POST') return report(req, res);
  let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'control.html' : url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    // Range requests so a <video> can seek/buffer (Chromium refuses to loop or scrub a source without them).
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
                           'Content-Range': `bytes ${start}-${end}/${st.size}` });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
});

// POST /report — a test page (video.html) posts its measurements as JSON; logged to stdout and appended to
// video/reports.jsonl (best effort: the deployed site dir is mounted read-only, so the append may fail silently).
function report(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }
    const line = JSON.stringify({ at: new Date().toISOString(), from: req.socket.remoteAddress, ...j });
    console.log('report', line);
    fs.appendFile(path.join(ROOT, 'video', 'reports.jsonl'), line + '\n', () => {});
    res.writeHead(204); res.end();
  });
}

// --- minimal WebSocket (RFC 6455, text frames only) ---
const clients = new Set();
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(socket);
  socket.write(frame(Buffer.from(JSON.stringify(syncMessage()))));
  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = buf[1] & 0x80, maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      if (masked) { const m = buf.slice(maskOff, maskOff + 4); payload = payload.map((b, i) => b ^ m[i % 4]); }
      buf = buf.slice(off + len);
      if (op === 8) { socket.end(); return; }                       // close
      if (op === 9) { socket.write(frame(payload, 0x8a)); continue; } // ping -> pong
      if (op === 1 && fin) inbound(payload, socket);
    }
  });
  const drop = () => { clients.delete(socket); };
  socket.on('close', drop); socket.on('error', drop); socket.on('end', drop);
});

function frame(payload, first = 0x81) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([first, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = first; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = first; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
function broadcast(payload, from) {
  const f = frame(payload);
  for (const c of clients) {
    if (c === from || c.destroyed) continue;
    // send-only clients (tracker, bridge) may never read; don't let their backlog grow without bound
    if (c.writableLength > 512 * 1024) { c.destroy(); clients.delete(c); continue; }
    c.write(f);
  }
}
// every brain message carries the server clock so pages can phase-lock their cosmetic cycles (lid breathing,
// glow pulse, flicker, spiral) to one time base instead of each page's own load time
const emit = m => broadcast(Buffer.from(JSON.stringify({ ...m, t: +now().toFixed(3) })), null);

// --- brain: the one place idle behaviour and shared state are decided ---
const now = () => performance.now() / 1000;
const rnd = (a, b) => a + Math.random() * (b - a);
const B = {
  mode: 'off',           // off | asleep | waking | awake   (clients handle the dozing->asleep lid transition themselves)
                         // off = dark screens; any motion lifts them to asleep (slits); a person (look/wake) opens them
  lastMotion: -1e9, lastStir: -1e9, lastManual: -1e9, wakeT0: 0,
  override: 0,           // until this time, external look commands suppress idle saccades
  nextSaccade: 0, nextBlink: 0,
  auto: true,
  style: null,           // null = whatever each page chose via ?style=
  lid: null,             // last {cmd:'mood'} / {cmd:'lid'} message, replayed to new clients
  halo: null,            // glow toggle; null = each page's ?halo= default
  blank: false,          // eyes off: pages draw solid black; everything else (tracking, sleep/wake, style) keeps running
  sound: process.env.SOUND !== '0', volume: 1, softVolume: 0.6,   // wake growl: mute and level for every ?sound=1 page, set from the control page
  lastGrowl: -1e9, lastFile: null, lastRumble: null, nextRumble: 0,
  growlEvery: GROWL_EVERY, rumble: [RUMBLE_MIN, RUMBLE_MAX], burst: [BURST_N, BURST_MIN, BURST_MAX],   // timing, adjustable live from the control page ({cmd:'sound'}); env = the defaults
  burstLeft: 0, nextBurst: 0, softCount: 0, squintUntil: 0,
  pages: { left: null, right: null },   // which page each projector window should show (URL template, see nav.js); null = whatever it loaded
  video: null,           // {name, t0}: the show show.html plays and the server-clock time its background loop started; null = black
  event: null,           // {name, t0, until}: the event clip currently layered over the background (video/shows.json "events")
  nextEvent: 0,          // server time the brain drops the next random event into the running show
  xmas: null,            // {loop, cycle, loops, next}: the canvas loop xmas.html draws; cycle > 0 = the brain steps through `loops`
};                       // every `cycle` seconds (one clock, so both doors change together). Paused while a show runs.
// video/shows.json: which shows exist, their events and how often to play one. Read on every `video` command so an
// edited manifest is picked up without a restart (the pages fetch the same file).
function shows() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'video', 'shows.json'), 'utf8')); } catch { return {}; } }
function scheduleEvent(t, sh) { const [a, b] = Array.isArray(sh.every) && sh.every.length === 2 ? sh.every : [20, 50]; B.nextEvent = t + rnd(a, b); }
function playEvent(t, name, src) {
  const sh = B.video && shows()[B.video.name]; const ev = sh && sh.events && sh.events[name];
  if (!ev) return false;
  B.event = { name, t0: +t.toFixed(3), until: t + (+ev.seconds || 15) };
  scheduleEvent(B.event.until, sh);
  console.log(`event ${name} (${src || 'brain'})`);
  emit({ cmd: 'event', name, t0: B.event.t0, src: src || 'brain' });
  return true;
}
const MOTION_CMDS = new Set(['look', 'motion', 'wake', 'sleep']);   // the commands a person sends that take over from the sensors

// wake growls: whatever audio sits in sounds/ (read per growl, so files can be dropped in live). The brain picks, so every page
// and every controller's monitor plays the same one; never the same file twice running.
const SOUND_RE = /^[\w.-]+\.(mp3|ogg|wav|m4a)$/i;
// Files named rumble-* are the other pool: the soft sound made now and then while awake, in rotation with the synth rumble.
// Files named fx-* are on-demand effects: never picked by the brain, only played when a controller names them.
const soundFiles = () => { try { return fs.readdirSync(path.join(ROOT, 'sounds')).filter(f => SOUND_RE.test(f)).sort().map(f => 'sounds/' + f); } catch { return []; } };
const isRumble = f => f.startsWith('sounds/rumble-');
const isFx = f => f.startsWith('sounds/fx-');
const growlFiles = () => soundFiles().filter(f => !isRumble(f) && !isFx(f));
const fxFiles = () => soundFiles().filter(isFx);
const rumbleFiles = () => soundFiles().filter(isRumble);
const pickFrom = (options, last) => { const pool = options.length > 1 ? options.filter(f => f !== last) : options; return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null; };
const pickGrowl = () => B.lastFile = pickFrom(growlFiles(), B.lastFile);
const SOFT_VOICES = ['synth', 'sniff'];   // synthesised in growl.js: the purr, and the scent-catching sniff
const pickRumble = () => B.lastRumble = pickFrom([...SOFT_VOICES, ...rumbleFiles()], B.lastRumble);
const growlMessage = (file, soft) => { const m = { cmd: 'growl', src: 'brain' }; if (soft) m.soft = true; if (file === 'sniff') m.voice = 'sniff'; else if (file && file !== 'synth') m.file = file; return m; };

function stir(t) {           // "something moved": dark eyes come up to slits; never opens them further
  B.lastStir = t;
  if (B.mode === 'off') { B.mode = 'asleep'; B.nextSaccade = t + rnd(2, 6); emit({ cmd: 'off', on: false, src: 'brain' }); }
}
function motion(t) {         // a person (tracker look, Protect person, manual wake): open and track
  stir(t); B.lastMotion = t;
  if (B.mode === 'asleep') {
    B.mode = 'waking'; B.wakeT0 = t; B.nextSaccade = t + 1.5; B.nextBlink = t + rnd(1.5, 3);
    B.burstLeft = 0; B.softCount = 0; B.nextRumble = t + rnd(4, 6);   // the sniff comes once the growl is over
    // the eyes open with a growl — but someone hovering at the edge of detection re-wakes them every ~12 s, and the
    // neighbours hear every one, so at most one per GROWL_EVERY
    // The sound of one visit: wake and growl ... snuffling, squinting ... purring ... sleeping. One growl as the eyes open (more
    // only if BURST asks for them), then the soft sounds below. A rate-limited wake is silent until its first sniff.
    if (B.sound && t - B.lastGrowl > B.growlEvery) {
      B.lastGrowl = t; emit(growlMessage(pickGrowl()));
      B.burstLeft = Math.round(B.burst[0]); B.nextBurst = t + rnd(B.burst[1], B.burst[2]);
    }
  }
}
function syncMessage() {
  const m = { cmd: 'sync', src: 'brain', awake: B.mode === 'awake' || B.mode === 'waking', off: B.mode === 'off', auto: B.auto, t: +now().toFixed(3) };
  if (B.style) m.style = B.style;
  if (B.lid) m.lid = B.lid;
  if (B.halo !== null) m.halo = B.halo;
  m.blank = B.blank;
  m.sound = B.sound; m.volume = B.volume; m.softVolume = B.softVolume; m.sounds = growlFiles(); m.rumbles = rumbleFiles(); m.effects = fxFiles(); m.growlEvery = B.growlEvery; m.rumble = B.rumble; m.burst = B.burst;
  if (B.pages.left || B.pages.right) m.pages = B.pages;
  if (B.video) m.video = B.video;
  if (B.event && B.event.until > now()) m.event = { name: B.event.name, t0: B.event.t0 };
  if (B.xmas) m.xmas = { loop: B.xmas.loop, cycle: B.xmas.cycle };
  if (B.projectors.length) m.projectors = projectorStatus();
  return m;
}

// --- projectors: PJLink Class 1 status poll (Casio XJ-F211WN, see docs-projector-control.md) ---
// PJ_HOSTS names the units (pill label = host minus "-projector"). Every PJ_POLL seconds each unit gets one short
// session (POWR INPT ERST LAMP); the answer lives in B.projectors, goes out in sync and {cmd:'projectors'} (so the
// control page pills stay live) and is dumped by /state. Gotchas baked in: lines end in "\r" only; only the first
// command of a session carries md5(nonce + password); the projector allows one session at a time (a refused connect
// while pjlink.py runs just leaves the last answer standing); the LAN reboots ~47 s after power-on, so a missed poll is
// reported as an age ("no answer 30s"), never as a verdict. Replies are data from an IoT box: bounded, never eval'd.
const net = require('net');
const PJ_HOSTS = (process.env.PJ_HOSTS || '').split(/\s+/).filter(Boolean);
const PJ_PASSWORD = process.env.PJ_PASSWORD || 'admin';
const PJ_POLL = +(process.env.PJ_POLL || 10);
const PJ_POWER = { '0': 'standby', '1': 'on', '2': 'cooling', '3': 'warming' };
const PJ_INPUTS = { '11': 'RGB1', '12': 'RGB2', '13': 'RGB3', '21': 'Video', '31': 'HDMI1', '32': 'HDMI2', '43': 'USB', '44': 'Network', '45': 'USB2' };
const PJ_ERST = ['fan', 'lamp', 'temp', 'cover', 'filter', 'other'];   // ERST digits, 0 ok / 1 warning / 2 error
B.projectors = PJ_HOSTS.map(host => ({ name: host.replace(/-?projector-?/, '') || host, host, power: null, input: null, errors: [], lamp: null, seen: null, error: null }));

function pjlink(host, cmds, timeout = 4000) {   // one session: connect, answer the greeting, run cmds, resolve their reply bodies
  return new Promise((resolve, reject) => {
    const s = net.connect(4352, host);
    const out = []; let buf = '', greeted = false;
    const fail = e => { s.destroy(); reject(e); };
    s.setTimeout(timeout, () => fail(new Error('timeout')));
    s.on('error', fail);
    s.on('data', d => {
      buf += d.toString('latin1');
      if (buf.length > 4096) return fail(new Error('reply too long'));
      let nl;
      while ((nl = buf.indexOf('\r')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!greeted) {
          greeted = true;
          let prefix = '';
          if (line.startsWith('PJLINK 1 ')) prefix = crypto.createHash('md5').update(line.split(' ')[2] + PJ_PASSWORD).digest('hex');
          else if (!line.startsWith('PJLINK 0')) return fail(new Error('unexpected greeting ' + line.slice(0, 40)));
          s.write(prefix + '%1' + cmds[0] + '\r');
          continue;
        }
        if (line === 'PJLINK ERRA') return fail(new Error('authentication failed'));
        out.push(line.includes('=') ? line.slice(line.indexOf('=') + 1, 80) : line.slice(0, 80));   // "%1POWR=1" -> "1"
        if (out.length < cmds.length) s.write('%1' + cmds[out.length] + '\r');
        else { s.end(); resolve(out); }
      }
    });
  });
}
function projectorStatus() {   // what pages get: the last answer plus its age, so a missed poll shows as "no answer Ns"
  const t = now();
  return B.projectors.map(p => ({ name: p.name, host: p.host, power: p.power, input: p.input, errors: p.errors, lamp: p.lamp,
                                  age: p.seen === null ? null : +(t - p.seen).toFixed(1), error: p.error }));
}
async function pollProjectors() {
  for (const p of B.projectors) {
    try {
      const [powr, inpt, erst, lamp] = await pjlink(p.host, ['POWR ?', 'INPT ?', 'ERST ?', 'LAMP ?']);
      p.power = PJ_POWER[powr] || powr;
      p.input = inpt.startsWith('ERR') ? null : (PJ_INPUTS[inpt] || inpt);   // standby answers ERR3 (unavailable) for the input
      p.errors = /^[0-2]{6}$/.test(erst) ? [...erst].map((c, i) => c === '0' ? null : `${PJ_ERST[i]} ${c === '2' ? 'error' : 'warning'}`).filter(Boolean) : [];
      p.lamp = +lamp.split(' ')[0] || null;
      p.seen = now(); p.error = null;
    } catch (e) { p.error = e.code || e.message; }
  }
  emit({ cmd: 'projectors', src: 'brain', projectors: projectorStatus() });
}
if (PJ_HOSTS.length) { const loop = () => pollProjectors().finally(() => setTimeout(loop, PJ_POLL * 1000)); loop(); }

// a client's command: gate sensors behind manual override, fold it into the brain state, then relay it.
// Only a person's look/motion/wake/sleep starts the override; style, mood, glow, blank, blink, auto and lid leave tracking running.
function inbound(payload, from) {   // (payload is reassigned when the brain normalises a message before relaying it)
  let m = null;
  try { m = JSON.parse(payload); } catch {}
  if (!m || !m.cmd) return broadcast(payload, from);
  const t = now();
  const sensor = m.src === 'tracker' || m.src === 'protect';
  if (sensor) { if (t - B.lastManual < COOLDOWN) return; }
  else if (m.src !== 'brain' && MOTION_CMDS.has(m.cmd)) B.lastManual = t;
  switch (m.cmd) {
    case 'look': B.override = t + (+m.hold >= 0 ? +m.hold : 3); if (!m.quiet) motion(t); break;
    case 'motion': stir(t); break;
    case 'wake': motion(t); break;
    case 'sleep': stir(t); B.mode = 'asleep'; B.lastMotion = -1e9; B.nextSaccade = t + rnd(3, 9); break;
    case 'auto': B.auto = !!m.on; break;
    case 'mood': case 'lid': B.lid = m; break;
    case 'halo': B.halo = !!m.on; break;
    case 'blank': B.blank = !!m.on; break;
    case 'sound': {
      const sec = v => Math.max(0, Math.min(600, +v || 0));
      B.sound = !!m.on; if (m.volume !== undefined && m.volume !== null) B.volume = Math.max(0, Math.min(1, +m.volume || 0));
      if (m.softVolume !== undefined && m.softVolume !== null) B.softVolume = Math.max(0, Math.min(1, +m.softVolume || 0));
      if (m.growlEvery !== undefined) B.growlEvery = sec(m.growlEvery);
      if (Array.isArray(m.rumble)) { const a = sec(m.rumble[0]); B.rumble = [a, Math.max(a, sec(m.rumble[1]))]; B.nextRumble = Math.min(B.nextRumble, t + B.rumble[0]); }
      if (Array.isArray(m.burst)) { const a = sec(m.burst[1]); B.burst = [Math.max(0, Math.min(10, Math.round(+m.burst[0] || 0))), a, Math.max(a, sec(m.burst[2]))]; }
      m.growlEvery = B.growlEvery; m.rumble = B.rumble; m.burst = B.burst;   // relay what was actually taken, so other controllers show the truth
      payload = Buffer.from(JSON.stringify(m));
      break;
    }
    case 'growl':                  // a controller's test: the brain fills in the file (or checks the one asked for) and sends it to
                                   // everyone, the sender too, so its monitor plays the same one. A wake growl restarts the rate limit.
      if (m.soft) return emit(growlMessage(SOFT_VOICES.includes(m.file) || rumbleFiles().includes(m.file) ? m.file : pickRumble(), true));
      B.lastGrowl = t;
      if (fxFiles().includes(m.file)) return emit(growlMessage(m.file));
      return emit(growlMessage(growlFiles().includes(m.file) ? (B.lastFile = m.file) : pickGrowl()));   // a controller's test growl: relayed as is, and it restarts the rate limit
    case 'style': B.style = m.name; break;
    case 'video': {      // show.html: play show `name` (video/shows.json), every window phase-locked to loop start t0 on the
      const name = m.name == null ? null : String(m.name);                   // server clock. Re-sending restarts it. name:null = black.
      if (name !== null && !/^[\w-]{1,64}$/.test(name)) return;
      B.video = name === null ? null : { name, t0: +t.toFixed(3) };
      B.event = null;
      const sh = name !== null && shows()[name];
      if (sh && sh.events) scheduleEvent(t, sh); else B.nextEvent = 0;
      console.log(`video ${name === null ? 'off' : name + ' t0=' + B.video.t0}`);
      return emit({ cmd: 'video', name, t0: B.video ? B.video.t0 : null, src: m.src });   // emit: the sender sees the stamped copy too
    }
    case 'event': {      // drop an event of the running show in now (the brain does this on its own every `every` seconds)
      if (typeof m.name !== 'string' || !/^[\w-]{1,64}$/.test(m.name)) return;
      playEvent(t, m.name, m.src || 'controller');
      return;
    }
    case 'xmas': {       // xmas.html: draw canvas loop `loop`; cycle:N (with the page's `loops` list; the server knows no themes)
      const ok = n => typeof n === 'string' && /^[\w-]{1,32}$/.test(n);      // = step through them every N seconds, cycle:0 = hold
      const x = B.xmas || (B.xmas = { loop: null, cycle: 0, loops: [], next: 0 });
      if (m.loop !== undefined) { if (!ok(m.loop)) return; x.loop = m.loop; }
      if (Array.isArray(m.loops)) x.loops = m.loops.filter(ok).slice(0, 32);
      if (m.cycle !== undefined) x.cycle = Math.max(0, Math.min(3600, +m.cycle || 0));
      x.next = t + x.cycle;
      return emit({ cmd: 'xmas', loop: x.loop, cycle: x.cycle, src: m.src });   // emit: every controller sees the settled state
    }
    case 'navigate': {   // steer projector windows to another page (nav.js). Relative URLs only: the relay is open on the LAN,
      const url = typeof m.url === 'string' ? m.url.trim() : '';   // so nobody can send a kiosk off this host
      if (!url || url.length > 512 || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return;
      for (const o of (m.out === 'left' || m.out === 'right' ? [m.out] : ['left', 'right'])) B.pages[o] = url;
      console.log(`navigate ${m.out || 'all'} -> ${url}`);
      break;
    }
  }
  broadcast(payload, from);
}

setInterval(() => {
  const t = now();
  if (B.squintUntil && t > B.squintUntil) {   // the sniff's squint is the brain's own: put back whatever mood / lid the controller last set
    B.squintUntil = 0;
    emit(B.lid ? { ...B.lid, src: 'brain' } : { cmd: 'mood', name: 'normal', src: 'brain' });
  }
  if (B.video && B.nextEvent && t > B.nextEvent) {           // the show's random events: never the same one twice in a row
    const sh = shows()[B.video.name]; const names = sh && sh.events ? Object.keys(sh.events) : [];
    if (!names.length) B.nextEvent = 0;
    else { const pick = names.length > 1 && B.event ? names.filter(n => n !== B.event.name) : names; playEvent(t, pick[Math.floor(Math.random() * pick.length)], 'brain'); }
  }
  if (B.event && B.event.until < t) B.event = null;
  if (B.xmas && B.xmas.cycle && !B.video && B.xmas.loops.length > 1 && t > B.xmas.next) {   // canvas loops: next theme on both doors
    const x = B.xmas; x.loop = x.loops[(x.loops.indexOf(x.loop) + 1) % x.loops.length]; x.next = t + x.cycle;
    emit({ cmd: 'xmas', loop: x.loop, cycle: x.cycle, src: 'brain' });
  }
  if (B.mode === 'waking' && t - B.wakeT0 > 1.2) B.mode = 'awake';
  if (B.mode === 'awake' && t - B.lastMotion > SLEEP_AFTER) {
    B.mode = 'asleep'; B.nextSaccade = t + rnd(3, 9);
    emit({ cmd: 'sleep', src: 'brain' });
  }
  if (B.mode === 'asleep' && t - B.lastStir > OFF_AFTER) {
    B.mode = 'off';
    emit({ cmd: 'off', on: true, src: 'brain' });
  }
  if (B.mode === 'asleep') {
    // slumber: rare small twitch, eye drifting down; quiet = does not wake the eye
    if (t > B.nextSaccade) {
      emit({ cmd: 'look', x: +rnd(-0.15, 0.15).toFixed(3), y: +rnd(0.2, 0.45).toFixed(3), hold: 0, quiet: true, src: 'brain' });
      B.nextSaccade = t + rnd(3, 9);
    }
  } else if (B.mode === 'awake') {
    // idle: random saccades biased across the driveway, occasional glance toward one side or the centre
    if (B.auto && t > B.override && t > B.nextSaccade) {
      const r = Math.random();
      let x, y;
      if (r < 0.15) { x = 0; y = 0; }
      else if (r < 0.3) { x = Math.random() < 0.5 ? -0.9 : 0.9; y = rnd(-0.2, 0.2); }
      else { x = rnd(-1, 1); y = rnd(-0.5, 0.5); }
      emit({ cmd: 'look', x: +x.toFixed(3), y: +y.toFixed(3), hold: 0, quiet: true, src: 'brain' });
      B.nextSaccade = t + rnd(0.8, 4.5);
    }
    // sound while awake: the optional burst while an outside look holds the gaze, and the soft sounds. The first soft sound of
    // a visit is always the sniff (catching the scent), and the eyes squint while they sniff.
    if (t - B.wakeT0 > BURST_WINDOW) B.burstLeft = 0;
    if (B.sound && B.burstLeft > 0 && t < B.override && t > B.nextBurst) {
      B.burstLeft--; B.lastGrowl = t; B.nextBurst = t + rnd(B.burst[1], B.burst[2]);
      B.nextRumble = Math.max(B.nextRumble, t + 4);
      emit(growlMessage(pickGrowl()));
    }
    if (B.sound && B.rumble[0] > 0 && t > B.nextRumble && t - B.lastGrowl > 4) {   // never on top of a growl
      const pick = B.softCount++ === 0 ? (B.lastRumble = 'sniff') : pickRumble();
      emit(growlMessage(pick, true));
      if (pick === 'sniff') { emit({ cmd: 'mood', name: 'squint', src: 'brain' }); B.squintUntil = t + rnd(2.6, 3.4); }
      B.nextRumble = t + rnd(B.rumble[0], B.rumble[1]);
    }
    if (t > B.nextBlink) {
      emit({ cmd: 'blink', dur: +rnd(0.22, 0.32).toFixed(3), src: 'brain' });
      B.nextBlink = t + rnd(2.5, 7);
    }
  }
}, 50);

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`Garage eyes server on port ${PORT}  (sleep after ${SLEEP_AFTER}s, dark after ${OFF_AFTER}s, manual cooldown ${COOLDOWN}s, growl ${B.sound ? `at most every ${GROWL_EVERY}s` : 'muted'})`);
  console.log(PJ_HOSTS.length ? `  projectors: polling ${PJ_HOSTS.join(', ')} over PJLink every ${PJ_POLL}s` : '  projectors: PJ_HOSTS unset, not polling');
  for (const ip of ips) {
    console.log(`  projector:  http://${ip}:${PORT}/index.html?eye=both`);
    console.log(`  controller: http://${ip}:${PORT}/control.html`);
    console.log(`  christmas:  http://${ip}:${PORT}/xmas-control.html`);
  }
});
