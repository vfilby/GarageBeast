#!/usr/bin/env node
// Render stills and short clips of the eye pages with headless Chrome, driven by the real relay brain.
// Zero deps beyond Node 22 (global fetch/WebSocket), Google Chrome and ffmpeg.
//
//   node video/render.mjs                 # everything in SHOTS -> video/out/
//   node video/render.mjs hero styles     # only the named shots
//
// Why not `chrome --screenshot --virtual-time-budget`: the virtual clock starves requestAnimationFrame,
// so anything frame-stepped looks broken (see README build notes: Christmas loops). This opens a real
// headless tab, waits real seconds and pulls frames with Page.startScreencast; a second WebSocket client
// plays the controller and sends style/look/blink commands on a timeline.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'video', 'out');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8765, DEBUG_PORT = 9333;
const WXGA = { width: 1280, height: 800 };        // the projectors are WXGA
const TALL = { width: 1080, height: 1920 };       // TikTok / Reels / Shorts

// A shot: page params, viewport, an optional timeline of relay commands [t seconds, message], and either
// `still: t` (PNG at t seconds) or `clip: seconds` (MP4). Every shot starts awake in the named style.
const SHOTS = {
  // --- stills for the blog post ---
  hero:        { eye: 'both', style: 'monster', view: WXGA, still: 6.0, timeline: [[0.5, { cmd: 'look', x: 0.15, y: 0.1, hold: 30 }]] },
  human:       { eye: 'both', style: 'human',   view: WXGA, still: 6.0, timeline: [[0.5, { cmd: 'look', x: -0.2, y: 0.05, hold: 30 }]] },
  sauron:      { eye: 'both', style: 'sauron',  view: WXGA, still: 6.0, timeline: [[0.5, { cmd: 'look', x: 0.3, y: 0, hold: 30 }]] },
  hal:         { eye: 'both', style: 'hal',     view: WXGA, still: 6.0 },
  jack:        { eye: 'both', style: 'jack',    view: WXGA, still: 6.0, timeline: [[0.5, { cmd: 'look', x: -0.3, y: 0.2, hold: 30 }]] },
  ghost:       { eye: 'both', style: 'ghost',   view: WXGA, still: 6.0, timeline: [[0.5, { cmd: 'look', x: 0.25, y: -0.1, hold: 30 }]] },
  hypno:       { eye: 'both', style: 'hypno',   view: WXGA, still: 6.0 },
  tiku:        { eye: 'both', style: 'tiku',    view: WXGA, still: 6.0, timeline: [[0.5, { cmd: 'look', x: -0.2, y: 0.05, hold: 30 }]] },
  asleep:      { eye: 'both', style: 'monster', view: WXGA, still: 6.0, timeline: [[0.2, { cmd: 'sleep' }]] },
  tall:        { eye: 'right', style: 'monster', view: TALL, still: 6.0, timeline: [[0.5, { cmd: 'look', x: 0.2, y: 0.1, hold: 30 }]] },
  // --- clips for the videos ---
  wake:        { eye: 'both', style: 'monster', view: WXGA, clip: 12, timeline: [
                  [0.0, { cmd: 'sleep' }], [3.0, { cmd: 'motion' }], [5.0, { cmd: 'look', x: -0.8, y: 0.2, hold: 3 }],
                  [7.0, { cmd: 'look', x: 0.8, y: 0.1, hold: 3 }], [9.0, { cmd: 'look', x: 0, y: 0, hold: 3 }], [10.0, { cmd: 'blink' }] ] },
  styles:      { eye: 'both', style: 'monster', view: WXGA, clip: 27, timeline:
                  ['monster', 'dragon', 'ghost', 'ghoul', 'demon', 'cat', 'hypno', 'sauron', 'jack', 'human', 'hal']
                    .map((name, i) => [i * 2.4 + 0.2, { cmd: 'style', name }]) },
  tallclip:    { eye: 'right', style: 'monster', view: TALL, clip: 10, timeline: [
                  [1.0, { cmd: 'look', x: -0.7, y: 0.1, hold: 3 }], [4.0, { cmd: 'look', x: 0.7, y: 0.1, hold: 3 }],
                  [7.0, { cmd: 'look', x: 0, y: 0, hold: 3 }], [8.0, { cmd: 'blink' }] ] },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);

// Minimal CDP client over one target's websocket.
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && this.listeners.has(m.method)) for (const f of this.listeners.get(m.method)) f(m.params); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  on(method, f) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(f); }
}
const openWs = url => new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(ws); ws.onerror = rej; });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eyes-render-'));
  // Relay with a long sleep timer so the brain never dozes mid-shot and no sensor cooldown.
  const server = spawn('node', [path.join(ROOT, 'eyes', 'server.js'), String(PORT)], { env: { ...process.env, SLEEP_AFTER: '600', OFF_AFTER: '600', COOLDOWN: '0' }, stdio: 'ignore' });
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--remote-allow-origins=*', `--user-data-dir=${tmp}`,
    '--hide-scrollbars', '--no-first-run', '--disable-gpu-vsync', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {}
    for (let i = 0; i < 20; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } } };
  process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(1); });
  await sleep(1500);
  const ctl = await openWs(`ws://localhost:${PORT}`);            // the "controller"
  const say = m => ctl.send(JSON.stringify(m));
  for (const name of wanted) {
    const shot = SHOTS[name]; if (!shot) { console.error(`no shot ${name}`); continue; }
    const url = `http://localhost:${PORT}/index.html?eye=${shot.eye}&style=${shot.style}`;
    const tgt = await (await fetch(`http://localhost:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const cdp = new CDP(await openWs(tgt.webSocketDebuggerUrl));
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...shot.view, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    say({ cmd: 'style', name: shot.style }); say({ cmd: 'wake' }); say({ cmd: 'look', x: 0, y: 0, hold: 2 });
    await sleep(400);
    const timeline = [...(shot.timeline || [])].sort((a, b) => a[0] - b[0]);
    const t0 = Date.now();
    const runTimeline = async () => { for (const [t, m] of timeline) { await sleep(Math.max(0, t0 + t * 1000 - Date.now())); say(m); } };
    if (shot.still != null) {
      runTimeline();
      await sleep(shot.still * 1000);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
      console.log(`still  ${name}.png`);
    } else {
      const dir = path.join(tmp, name); fs.mkdirSync(dir);
      const frames = []; let n = 0;
      cdp.on('Page.screencastFrame', p => { const f = path.join(dir, `${String(n++).padStart(5, '0')}.jpg`);
        fs.writeFileSync(f, Buffer.from(p.data, 'base64')); frames.push([f, p.metadata.timestamp]); cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }); });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: shot.view.width, maxHeight: shot.view.height, everyNthFrame: 1 });
      runTimeline();
      await sleep(shot.clip * 1000);
      await cdp.send('Page.stopScreencast');
      // concat demuxer with real per-frame durations, resampled to a constant 30 fps
      const list = frames.map(([f, ts], i) => `file '${f}'\nduration ${(i + 1 < frames.length ? frames[i + 1][1] - ts : 1 / 30).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1)[0]}'\n`;
      const listFile = path.join(dir, 'list.txt'); fs.writeFileSync(listFile, list);
      const mp4 = path.join(OUT, `${name}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', mp4]);
      console.log(`clip   ${name}.mp4  (${frames.length} frames captured over ${shot.clip}s)`);
    }
    await cdp.send('Page.close').catch(() => {});
    say({ cmd: 'style', name: 'monster' });
  }
  ctl.close(); cleanup(); process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
