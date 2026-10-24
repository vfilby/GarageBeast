// Garage Eye — one eye per projector.
// URL params:  ?eye=left|right   ?debug=1   ?ws=ws://host:port  ?color=ff9900
// Keys: arrows = look, space = blink, w = wide, s = squint, a = toggle auto, d = debug, f = fullscreen, c = center
//
// Control input (for motion sensors later): any of
//   - BroadcastChannel('garage-eyes')  postMessage({cmd:'look', x:-1..1, y:-1..1})
//   - WebSocket (?ws=...) JSON messages, same shape
//   - window.eye.look(x,y) / window.eye.blink() from the console
// Commands: {cmd:'look',x,y,duration?} {cmd:'blink'} {cmd:'auto',on:bool} {cmd:'lid',open:0..1} {cmd:'mood',name}

(() => {
  const P = new URLSearchParams(location.search);
  const SIDE = P.get('eye') === 'right' ? 'right' : 'left';
  const IRIS_COLOR = '#' + (P.get('color') || (SIDE === 'left' ? 'e8a020' : 'e8a020'));
  const DOOR_ASPECT = 9 / 7;   // garage door W:H

  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  const hud = document.getElementById('hud');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  addEventListener('resize', resize); resize();

  // ---------- state ----------
  const S = {
    gaze: { x: 0, y: 0 },        // current, -1..1
    target: { x: 0, y: 0 },      // where we're moving to
    lid: 1,                      // 1 open, 0 closed
    lidTarget: 1,
    baseOpen: 1,                 // mood: 1 normal, 1.2 wide, 0.55 squint
    auto: true,
    debug: P.get('debug') === '1',
    nextSaccade: 0, nextBlink: 0,
    blinkPhase: null,            // null | {t0, dur}
    pupil: 1,                    // pupil scale (dilation)
    pupilTarget: 1,
    override: 0,                 // time until which external control suppresses auto look
    lastCmd: '',
  };
  document.body.classList.toggle('debug', S.debug);

  const now = () => performance.now() / 1000;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- API ----------
  const api = {
    look(x, y = 0, hold = 3) {
      S.target.x = clamp(x, -1, 1); S.target.y = clamp(y, -1, 1);
      S.override = now() + hold;
    },
    blink() { if (!S.blinkPhase) S.blinkPhase = { t0: now(), dur: rnd(0.22, 0.32) }; },
    auto(on) { S.auto = !!on; },
    lid(open) { S.baseOpen = clamp(open, 0, 1.3); },
    mood(name) {
      S.baseOpen = { wide: 1.25, normal: 1, squint: 0.55, sleepy: 0.35 }[name] ?? 1;
      S.pupilTarget = { wide: 0.7, normal: 1, squint: 1.15, sleepy: 1.3 }[name] ?? 1;
    },
    center() { api.look(0, 0, 3); },
    handle(m) {
      if (!m || !m.cmd) return;
      S.lastCmd = JSON.stringify(m);
      switch (m.cmd) {
        case 'look': api.look(+m.x || 0, +m.y || 0, m.hold ?? 3); break;
        case 'blink': api.blink(); break;
        case 'auto': api.auto(m.on); break;
        case 'lid': api.lid(+m.open); break;
        case 'mood': api.mood(m.name); break;
      }
    },
  };
  window.eye = api;

  // ---------- inputs ----------
  try {
    const bc = new BroadcastChannel('garage-eyes');
    bc.onmessage = e => api.handle(e.data);
  } catch {}
  if (P.get('ws')) {
    const connect = () => {
      const ws = new WebSocket(P.get('ws'));
      ws.onmessage = e => { try { api.handle(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => setTimeout(connect, 2000);
    };
    connect();
  }
  addEventListener('keydown', e => {
    const step = 0.25;
    switch (e.key) {
      case 'ArrowLeft':  api.look(S.target.x - step, S.target.y, 5); break;
      case 'ArrowRight': api.look(S.target.x + step, S.target.y, 5); break;
      case 'ArrowUp':    api.look(S.target.x, S.target.y - step, 5); break;
      case 'ArrowDown':  api.look(S.target.x, S.target.y + step, 5); break;
      case ' ': api.blink(); break;
      case 'w': api.mood('wide'); break;
      case 's': api.mood('squint'); break;
      case 'n': api.mood('normal'); break;
      case 'c': api.center(); break;
      case 'a': S.auto = !S.auto; break;
      case 'd': S.debug = !S.debug; document.body.classList.toggle('debug', S.debug); break;
      case 'f': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); break;
    }
  });

  // ---------- behaviour ----------
  function tick(t, dt) {
    // idle: random saccades + occasional blinks
    if (S.auto && t > S.override && t > S.nextSaccade) {
      // bias: mostly look side to side across the driveway, sometimes glance at the other eye
      const r = Math.random();
      if (r < 0.15) { S.target.x = 0; S.target.y = 0; }
      else if (r < 0.3) { S.target.x = SIDE === 'left' ? 0.9 : -0.9; S.target.y = rnd(-0.2, 0.2); }
      else { S.target.x = rnd(-1, 1); S.target.y = rnd(-0.5, 0.5); }
      S.nextSaccade = t + rnd(0.8, 4.5);
    }
    if (t > S.nextBlink) { api.blink(); S.nextBlink = t + rnd(2.5, 7); }

    // gaze motion: fast saccade with ease-out
    const k = 1 - Math.pow(0.001, dt);       // ~fast exponential approach
    S.gaze.x = lerp(S.gaze.x, S.target.x, k);
    S.gaze.y = lerp(S.gaze.y, S.target.y, k);

    // blink envelope
    let blink = 0;
    if (S.blinkPhase) {
      const p = (t - S.blinkPhase.t0) / S.blinkPhase.dur;
      if (p >= 1) S.blinkPhase = null;
      else blink = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;   // close fast, open slower
    }
    S.lidTarget = S.baseOpen * (1 - blink);
    S.lid = lerp(S.lid, S.lidTarget, 1 - Math.pow(0.0001, dt));
    S.pupil = lerp(S.pupil, S.pupilTarget, 1 - Math.pow(0.05, dt));
  }

  // ---------- drawing ----------
  function draw() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

    // fit a 9:7 "door" box into the window, letterboxed
    let dw = W, dh = W / DOOR_ASPECT;
    if (dh > H) { dh = H; dw = H * DOOR_ASPECT; }
    const cx = W / 2, cy = H / 2;

    const eyeW = dw * 0.88, eyeH = dh * 0.6;   // almond outline size
    const openH = eyeH * clamp(S.lid, 0, 1.3);
    const irisR = eyeH * 0.42;
    const pupilR = irisR * 0.45 * S.pupil;
    const travelX = eyeW * 0.28, travelY = eyeH * 0.18;
    const ix = cx + S.gaze.x * travelX;
    const iy = cy + S.gaze.y * travelY;

    // eye opening path (two quadratic curves), used as clip
    const eyePath = () => {
      ctx.beginPath();
      ctx.moveTo(cx - eyeW / 2, cy);
      ctx.quadraticCurveTo(cx, cy - openH, cx + eyeW / 2, cy);
      ctx.quadraticCurveTo(cx, cy + openH * 0.85, cx - eyeW / 2, cy);
      ctx.closePath();
    };

    if (openH > 2) {
      ctx.save();
      eyePath(); ctx.clip();

      // sclera with vignette
      const g = ctx.createRadialGradient(ix, iy, irisR, cx, cy, eyeW * 0.6);
      g.addColorStop(0, '#f4efe6'); g.addColorStop(1, '#8c7a6a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // bloodshot veins
      ctx.strokeStyle = 'rgba(180,30,30,.35)'; ctx.lineWidth = eyeH * 0.006;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * eyeW * 0.5, cy + Math.sin(a) * eyeH * 0.5);
        ctx.quadraticCurveTo(cx + Math.cos(a + 0.2) * eyeW * 0.3, cy + Math.sin(a + 0.2) * eyeH * 0.3,
                             ix + Math.cos(a) * irisR * 1.15, iy + Math.sin(a) * irisR * 1.15);
        ctx.stroke();
      }

      // iris
      const ig = ctx.createRadialGradient(ix, iy, pupilR, ix, iy, irisR);
      ig.addColorStop(0, IRIS_COLOR); ig.addColorStop(0.75, shade(IRIS_COLOR, -0.35)); ig.addColorStop(1, '#100800');
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(ix, iy, irisR, 0, Math.PI * 2); ctx.fill();
      // iris striations
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * pupilR * 1.05, iy + Math.sin(a) * pupilR * 1.05);
        ctx.lineTo(ix + Math.cos(a + 0.05) * irisR * 0.95, iy + Math.sin(a + 0.05) * irisR * 0.95);
        ctx.stroke();
      }
      // pupil
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ix, iy, pupilR, 0, Math.PI * 2); ctx.fill();
      // specular highlights
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.arc(ix - irisR * 0.35, iy - irisR * 0.35, irisR * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.beginPath(); ctx.arc(ix + irisR * 0.3, iy + irisR * 0.3, irisR * 0.06, 0, Math.PI * 2); ctx.fill();

      // lid shadow along top
      const sg = ctx.createLinearGradient(0, cy - openH, 0, cy - openH * 0.4);
      sg.addColorStop(0, 'rgba(0,0,0,.6)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // lid edge
      eyePath(); ctx.strokeStyle = '#1a0a05'; ctx.lineWidth = eyeH * 0.03; ctx.stroke();
    }

    if (S.debug) {
      hud.textContent =
`eye=${SIDE}  auto=${S.auto}  gaze=(${S.gaze.x.toFixed(2)},${S.gaze.y.toFixed(2)})  lid=${S.lid.toFixed(2)}
door box ${Math.round(dw)}x${Math.round(dh)}  last=${S.lastCmd}
arrows look · space blink · w/s/n mood · a auto · c center · f fullscreen · d hud`;
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => clamp(Math.round(c * (1 + amt)), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  let last = now();
  (function loop() {
    const t = now(), dt = Math.min(t - last, 0.1); last = t;
    tick(t, dt); draw();
    requestAnimationFrame(loop);
  })();
})();
