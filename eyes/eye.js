// Garage Eye — one eye per projector.
// URL params:  ?eye=left|right|both  ?style=monster|dragon|ghost|ghoul|demon|cat|sauron|hypno|jack|human|tiku|hal  ?debug=1  ?ws=ws://host:port  ?color=ff9900
//   ?sound=1 this page growls when the eyes wake (growl.js; give it to ONE page per audio output)  ?volume=0..1 trim for this page  ?growl=file wake-growl sample (default growl.mp3; the synth stands in if it is missing)
// Keys (same map as control.html): arrows = look, shift+arrow = far edge, space = blink, w = wake, s = sleep, z = toggle sleep/wake,
//   q = squint, e = wide, n = normal, c = center, m = motion, a = toggle auto, h = toggle glow, 1-9 / u / t / l = style, 0 = toggle eyes off (blank screen), g = growl now, d = debug, f = fullscreen
//
// Control input (for motion sensors later): any of
//   - BroadcastChannel('garage-eyes')  postMessage({cmd:'look', x:-1..1, y:-1..1})
//   - WebSocket (?ws=...) JSON messages, same shape
//   - window.eye.look(x,y) / window.eye.blink() from the console
// ?mirror=1 flips x of incoming look commands (projector view; the control page preview stays in camera view).
// Commands: {cmd:'look',x,y,hold?,mood?,quiet?} {cmd:'motion'} {cmd:'sleep'} {cmd:'wake'} {cmd:'blink',dur?} {cmd:'auto',on} {cmd:'lid',open} {cmd:'mood',name} {cmd:'halo',on} {cmd:'style',name} {cmd:'blank',on} {cmd:'off',on} (brain only: fade to dark / back to slits)
//   {cmd:'growl',soft?,file?} play the wake growl now (the brain sends it as the eyes open on a person; rate-limited there); soft = the quiet searching rumble the brain sends now and then while awake {cmd:'sound',on,volume?} mute / level for every growling page
// Eyes start asleep; any look/motion wakes them; they doze off after ?sleep=N seconds (default 10). ?awake=1 starts awake. Mouse movement counts as motion and the eye tracks the pointer.
// When served by server.js the page is a *follower*: the server's {cmd:'sync'} on connect hands it the current style/mood/glow/blank/auto/awake
// state and from then on the server decides sleep/wake timing, idle saccades and blinks (src:'brain') so every open window stays in
// step. Local mouse/keys are sent through the relay too. If the relay drops, the page runs its own idle behaviour until it reconnects.

(() => {
  const P = new URLSearchParams(location.search);
  const MODE = P.get('eye') || 'left';          // left | right | both
  const MIRROR = P.get('mirror') === '1';       // projector view: the camera looks house→street, the audience looks street→house, so gaze x flips
  const SIDES = MODE === 'both' ? ['left', 'right'] : [MODE === 'right' ? 'right' : 'left'];
  const SIDE = SIDES[0];                          // used for auto-glance bias in single mode
  const STYLES = {
    // sclera: [centre, mid, edge]  halo: rgb  iris: [core, mid, rim]  pupil: slit|round|goat|triangle|hollow
    // slant: +1 angry (brows dip inward), 0 neutral, -1 droopy/sad   lidColor: edge stroke
    monster: { sclera: ['210,255,225', '120,200,150', '10,40,25'], halo: '120,255,180', iris: ['#ff6a3a', '#ff2a00', '#5a0800'], pupil: 'slit', pupilScale: 1, slant: 1, lid: 'rgba(0,0,0,.8)' },
    dragon:  { sclera: ['255,235,170', '230,170,60', '60,25,0'],   halo: '255,170,40',  iris: ['#fff3a0', '#ffb000', '#c03000'], pupil: 'slit', pupilScale: 1, slant: 1, lid: 'rgba(30,10,0,.9)' },
    ghost:   { sclera: ['250,252,255', '200,222,250', '120,150,200'], halo: '190,215,255', iris: ['#ffffff', '#d6e6ff', '#8fabd8'], pupil: 'hollow', pupilScale: 1.3, slant: 0, lid: 'rgba(220,235,255,.18)', edgeAlpha: 0.1, haloK: 1.5, haloA: 0.8, pulse: 0.35, shadow: 0.2 },
    ghoul:   { sclera: ['235,225,160', '170,150,70', '40,30,5'],   halo: '190,210,80',  iris: ['#e8ff70', '#9ab814', '#2a3a00'], pupil: 'round', pupilScale: 0.55, slant: -1, lid: 'rgba(20,20,0,.9)' },
    demon:   { sclera: ['40,0,0', '15,0,0', '0,0,0'],              halo: '255,40,0',    iris: ['#ffe080', '#ff5a00', '#7a0000'], pupil: 'slit', pupilScale: 0.8, slant: 1, lid: 'rgba(0,0,0,.95)' },
    cat:     { sclera: ['230,255,200', '130,200,110', '15,40,10'], halo: '120,255,120', iris: ['#e8ffb0', '#5ad13a', '#0d4a10'], pupil: 'slit', pupilScale: 1, slant: 1, lid: 'rgba(0,10,0,.85)' },
    sauron:  { shape: 'flame', sclera: ['255,230,140', '255,110,10', '60,8,0'], halo: '255,80,10', iris: ['#ffd76a', '#ff8a00', '#7a1500'], pupil: 'slit', pupilScale: 1, slant: 0, lid: 'rgba(30,5,0,.9)', flicker: 0.22, pulse: 0.3 },
    hypno:   { shape: 'round', irisFx: 'spiral', sclera: ['245,235,255', '190,160,230', '40,20,70'], halo: '200,120,255', iris: ['#ff3cc8', '#ff3cc8', '#3a0a50'], spiral: ['#ff3cc8', '#40e8ff'], pupil: 'round', pupilScale: 0.5, slant: 0, lid: 'rgba(40,10,60,.85)', pulse: 0.2, shadow: 0, haloA: 0 },
    jack:    { shape: 'carved', sclera: ['255,170,40', '235,110,10', '90,30,0'], halo: '255,140,20', iris: ['#fffbe0', '#ffc020', '#ff5a00'], pupil: 'none', pupilScale: 1, slant: 0, lid: 'rgba(25,8,0,.95)', flicker: 0.25, pulse: 0.1 },
    // human: white sclera pinking toward the corners, grey-blue iris with a dark limbal ring, round pupil, a catchlight,
    // neutral lids and only a light brow shadow (the heavy one reads as sinister). No glow pulse — skin doesn't breathe light.
    // Geometry: the iris is bigger than the opening is tall (irisK), the upper lid rests over the top of it (lidUpK) and the lower lid
    // just touches the bottom (lidLoK) — a fully exposed iris reads as startled. lidModel 'human': the lower lid rises for a squint
    // (cheek raise) but barely moves in a blink; the upper lid does the closing and travels past the centre line to meet it.
    // pupilRange caps dilation to a human 28–55% of the iris radius. Shape (proportions of a real eye, 30×10 mm fissure, 12 mm
    // iris): the corners sit BELOW the pupil (eyeUp lifts the eyeball a third of an iris radius above the corner line), so the
    // upper lid is a tall arch (lidUpK) and the lower lid a shallow curve (lidLoK), each overlapping the iris by ~1 mm; ~4° canthal
    // tilt (slant: inner corner lower than the outer); upper lid peaks a little nasal of centre (peakUp), lower lid bottoms out a
    // little temporal (peakLo).
    human:   { sclera: ['255,253,250', '246,240,236', '165,118,108'], halo: '255,240,225', iris: ['#c8dff0', '#4f86b8', '#163a62'], pupil: 'round', pupilScale: 1, pupilRange: [0.28, 0.55], irisK: 0.85, eyeUp: 0.13, lidModel: 'human', lidUpK: 0.85, lidLoK: 0.38, slant: 0.3, peakUp: 0.15, peakLo: 0.15, lid: 'rgba(70,32,28,.85)', shadow: 0.35, pulse: 0.04, catchlight: 0.85 },
    // tiku: a real black cat's eyes (photo). irisFx 'fill': no separate iris disc — the whole almond IS the iris, a dome of pale
    // yellow-green around the pupil going lime then orange-olive at the corners, with radial fibre texture (fibres: [colour, alpha]
    // pairs, light then dark); the black slit sits on the sphere; a bright catchlight; black-fur lids tilted up at the outer corners.
    tiku:    { irisFx: 'fill', sclera: ['244,248,180', '196,214,100', '160,112,40'], halo: '214,232,120', iris: ['#eef6b4', '#d3e27c', '#87a238'], fibres: [['255,255,215', 0.2], ['96,124,34', 0.28]], pupil: 'slit', pupilScale: 1, slant: 0.6, lid: 'rgba(0,0,0,.95)', shadow: 0.5, pulse: 0.06, catchlight: 0.9 },
    // hal: HAL 9000's lens (shape 'hal', drawn by drawHal — none of the almond/iris machinery applies). A chrome bezel around black
    // glass; inside, a red bloom that breathes and drifts, a slow-orbiting crescent reflection off the lens elements, etched concentric
    // rings and a dotted dial, and a white-hot core with a horizontal anamorphic flare. No lids: blink / squint / sleep dim the lamp
    // (sleep = a dull standby ember). The wake flare swells the core. The core and bloom slide a little toward the gaze — the lens
    // never turns, but the light inside it follows you.
    hal:     { shape: 'hal', sclera: ['0,0,0', '0,0,0', '0,0,0'], halo: '255,30,10', iris: ['#ffffff', '#ff3010', '#300000'], pupil: 'none', pupilScale: 1, slant: 0, lid: 'rgba(0,0,0,0)', pulse: 0.05 },
  };
  // key → style, shared with control.html (digits ran out at nine: u = hUman, t = Tiku, l = haL; 0 is the eyes-off toggle)
  const STYLE_KEYS = { 1: 'monster', 2: 'dragon', 3: 'ghost', 4: 'ghoul', 5: 'demon', 6: 'cat', 7: 'hypno', 8: 'sauron', 9: 'jack', u: 'human', t: 'tiku', l: 'hal' };
  let STYLE = STYLES[P.get('style')] || STYLES.monster;

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
    gazeSlow: 0,                 // low-passed gaze.x used for vergence
    sac: null, sacArm: null, sacEnd: 0, sacTgt: null,   // saccade engine state
    target: { x: 0, y: 0 },      // where we're moving to
    lid: 1,                      // 1 open, 0 closed
    lidTarget: 1,
    lidBase: 1, blinkAmt: 0,     // lid split into its mood/sleep part and its blink part (smoothed like lid)
    baseOpen: 1,                 // mood: 1 normal, 1.2 wide, 0.55 squint
    auto: true,
    debug: P.get('debug') === '1',
    nextSaccade: 0, nextBlink: 0,
    blinkPhase: null,            // null | {t0, dur}
    pupil: 0.6,                  // pupil scale (dilation): 0.6 slit … 3.2 full black
    pupilTarget: 0.6,
    override: 0,                 // time until which external control suppresses auto look
    lastCmd: '',
    micro: { x: 0, y: 0 },       // microsaccade offset (gaze units), eased toward microTarget
    microTarget: { x: 0, y: 0 },
    nextMicro: 0,
    drift: { x: 0, y: 0 },       // slow drift noise
    head: { x: 0, y: 0 },        // 'head follow': whole socket drifts a little toward gaze, lagging
    hippus: 0,
    glowLevel: 0.45,             // smoothed brightness: 1 awake, 0.45 asleep (dims only after lids close)
    mode: 'asleep',              // asleep | dozing | waking | awake
    lastMotion: -1e9,
    wakeT0: 0,
    sleepAfter: +(P.get('sleep') || 10),   // seconds without motion before dozing off
    lastManual: -1e9,                       // last command from a person (controller / keyboard); sensors yield to it
    cooldown: +(P.get('cooldown') ?? 5),   // seconds after a manual command during which tracker/protect commands are ignored
    halo: P.get('halo') === '1',           // soft glow around the eyes; off = pure black background so the projection edge vanishes on the door
    blank: false,                          // eyes off: draw nothing (solid black) while everything else — tracking, sleep/wake, style — keeps running
    off: false, offAmt: 0,                 // brain's dark stage below asleep: fades to black (offAmt 0..1) until something moves, then back up to slits
    startAwake: P.get('awake') === '1',
    follower: false,             // true while the relay server is connected: it owns sleep/wake, idle saccades and blinks
    clockOffset: 0,              // server clock − local clock, from the t stamp on brain messages; see shared()
    soundOn: true, volume: 1, softVolume: 0.6,    // {cmd:'sound'} / sync: mute and level from the controller; only matters on a ?sound=1 page
    lastGrowl: -1e9,
  };
  if (S.startAwake) { S.mode = 'awake'; S.lastMotion = 1e9; S.pupil = S.pupilTarget = 1.8; S.glowLevel = 1; } else { S.lid = S.lidBase = 0.11; S.baseOpen = 0.11; S.gaze.y = S.target.y = 0.3; }
  document.body.classList.toggle('debug', S.debug);
  if (P.get('pupil')) { S.pupil = S.pupilTarget = +P.get('pupil'); S.lastMotion = 1e9; }   // debug: fix dilation
  if (P.get('gaze')) {           // debug: fix the gaze, e.g. ?gaze=0.8,-0.3
    const [gx, gy] = P.get('gaze').split(',').map(Number);
    S.gaze.x = S.target.x = gx || 0; S.gaze.y = S.target.y = gy || 0; S.auto = false; S.override = 1e9;
  }

  const now = () => performance.now() / 1000;
  // shared time base: used ONLY for cosmetic cycles (lid breathing while asleep, glow pulse, candle flicker, hypno spiral)
  // so every window sits at the same phase; timers and the saccade engine stay on the local clock so nothing jumps
  const shared = () => now() + S.clockOffset;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const MOTION_CMDS = new Set(['look', 'motion', 'wake', 'sleep']);   // the commands a person sends that should take over from the sensors

  // wake growl (growl.js): opt-in per page, because every page on one machine shares one audio output — two kiosks growling
  // a few ms apart through the same speaker comb-filter each other. No ?sound=1, no AudioContext.
  const SOUND = P.get('sound') === '1' && !!window.Growl;
  const TRIM = P.get('volume') === null ? 1 : clamp(+P.get('volume') || 0, 0, 1);
  const GROWL_EVERY = 20;                        // standalone only; as a follower the brain rate-limits (GROWL_EVERY env)
  if (SOUND) { Growl.init(); Growl.load(P.get('growl') || 'growl.mp3'); }   // no file: the synth stands in

  // ---------- API ----------
  const api = {
    look(x, y = 0, hold = 3, wake = true) {
      const jump = Math.hypot(clamp(x, -1, 1) - S.gaze.x, clamp(y, -1, 1) - S.gaze.y);
      if (jump > 0.9 && S.mode === 'awake') api.blink();   // big gaze shifts carry a blink (Evinger 1994)
      S.target.x = clamp(x, -1, 1); S.target.y = clamp(y, -1, 1);
      S.override = now() + hold;
      if (wake) api.motion();                              // quiet looks (idle/slumber saccades from the brain) don't
    },
    motion() {                   // "something moved" — wakes the eye, resets sleep timer
      S.lastMotion = now();
      if (S.mode === 'asleep' || S.mode === 'dozing') {
        S.mode = 'waking'; S.wakeT0 = now(); S.pupilStart = S.pupil;
        if (!S.follower && now() - S.lastGrowl > GROWL_EVERY) api.growl();   // standalone: no brain to send {cmd:'growl'}
      }
    },
    sleep() { S.mode = 'dozing'; S.lastMotion = -1e9; },
    wake() { api.motion(); },
    growl(soft, file, voice) { if (!soft) S.lastGrowl = now(); if (SOUND && S.soundOn && S.volume * TRIM > 0) Growl.play({ gain: S.volume * TRIM * (soft ? S.softVolume : 1), soft: !!soft, file, voice }); },   // soft = the searching sounds (purr, breath sample, or voice 'sniff')
    sound(on, volume, softVolume) { S.soundOn = !!on; if (volume !== undefined && volume !== null) S.volume = clamp(+volume || 0, 0, 1); if (softVolume !== undefined && softVolume !== null) S.softVolume = clamp(+softVolume || 0, 0, 1); },
    blink(dur) { if (!S.blinkPhase) S.blinkPhase = { t0: now(), dur: dur || rnd(0.22, 0.32) }; },
    auto(on) { S.auto = !!on; },
    halo(on) { S.halo = !!on; },
    blank(on) { S.blank = !!on; },
    off(on) { S.off = !!on; },
    lid(open) { S.baseOpen = clamp(open, 0, 1.2); },
    mood(name) {
      S.baseOpen = { wide: 1.2, normal: 1.0, squint: 0.55, sleepy: 0.3 }[name] ?? 1.0;
      
    },
    center() { api.look(0, 0, 3); },
    handle(m) {
      if (!m || !m.cmd) return;
      if (window.nav && nav.handle(m)) return;   // relay steered this window to another page (nav.js); we're leaving
      // manual override: commands tagged src:'tracker'/'protect' (sensors) are dropped for `cooldown` s after an untagged (human)
      // *motion* command (look/motion/wake/sleep). Style, mood, glow, blink, auto and lid changes leave tracking running.
      // The relay server applies the same gate before forwarding; this copy covers standalone / BroadcastChannel use.
      // src:'brain' is the server's own idle behaviour, never a person.
      if (m.src === 'tracker' || m.src === 'protect') { if (now() - S.lastManual < S.cooldown) return; }
      else if (m.src !== 'brain' && MOTION_CMDS.has(m.cmd)) S.lastManual = now();
      if (m.src === 'brain' && typeof m.t === 'number') {
        // offset sample = server stamp − local arrival; latency only ever makes it smaller, so keep the largest
        // (least-delayed) sample. Reset on sync (server may have restarted) or if it ever drops by >1 s.
        const s = m.t - now();
        if (m.cmd === 'sync' || s > S.clockOffset || s < S.clockOffset - 1) S.clockOffset = s;
      }
      S.lastCmd = JSON.stringify(m);
      switch (m.cmd) {
        case 'look': api.look((MIRROR ? -1 : 1) * (+m.x || 0), +m.y || 0, m.hold ?? 3, !m.quiet); if (m.mood) api.mood(m.mood); break;   // tracker: squint on a shaky detection
        case 'blink': api.blink(+m.dur || 0); break;
        case 'sync':                                   // relay server's current state on connect: become a follower
          S.follower = true;
          if (m.style && STYLES[m.style]) STYLE = STYLES[m.style];
          if (m.lid) m.lid.cmd === 'mood' ? api.mood(m.lid.name) : api.lid(+m.lid.open);
          if (m.halo !== undefined) S.halo = !!m.halo;
          if (m.blank !== undefined) S.blank = !!m.blank;
          if (m.sound !== undefined) api.sound(m.sound, m.volume, m.softVolume);
          if (SOUND) Growl.preload([...(m.sounds || []), ...(m.rumbles || []), ...(m.effects || [])].filter(f => /^sounds\/[\w.-]+$/.test(f)));
          if (m.off !== undefined) { S.off = !!m.off; S.offAmt = S.off ? 1 : 0; }   // snap on connect: no flash of slits before going dark
          S.auto = !!m.auto;
          if (m.awake) api.motion(); else if (S.mode === 'awake' || S.mode === 'waking') api.sleep();
          break;
        case 'auto': api.auto(m.on); break;
        case 'halo': api.halo(m.on); break;
        case 'blank': api.blank(m.on); break;
        case 'off': api.off(m.on); break;
        case 'lid': api.lid(+m.open); break;
        case 'mood': api.mood(m.name); break;
        case 'motion': api.motion(); break;
        case 'sleep': api.sleep(); break;
        case 'wake': api.wake(); break;
        case 'growl': api.growl(m.soft, typeof m.file === 'string' && /^sounds\/[\w.-]+$/.test(m.file) ? m.file : undefined, m.voice === 'sniff' ? 'sniff' : undefined); break;
        case 'sound': api.sound(m.on, m.volume, m.softVolume); break;
        case 'style': if (STYLES[m.name]) STYLE = STYLES[m.name]; break;
      }
    },
  };
  window.eye = api;

  // ---------- inputs ----------
  try {
    const bc = new BroadcastChannel('garage-eyes');
    bc.onmessage = e => api.handle(e.data);
  } catch {}
  addEventListener('message', e => { if (e.data && e.data.cmd) api.handle(e.data); });   // window.postMessage (works on file://)
  const wsUrl = P.get('ws') || (location.protocol.startsWith('http') ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` : null);
  let ws = null;
  if (wsUrl) {
    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = e => { try { api.handle(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => { ws = null; S.follower = false; setTimeout(connect, 2000); };   // relay gone: fall back to local autonomy
    };
    connect();
  }
  // local input (mouse, keys) is applied here AND sent through the relay so every other window does the same thing
  const emit = m => { api.handle(m); if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  let lastMouse = 0;
  addEventListener('mousemove', e => {
    if (S.mode === 'asleep' && Math.abs(e.movementX) + Math.abs(e.movementY) < 2) return; // ignore jitter while sleeping
    const t = performance.now();
    if (t - lastMouse < 40) return;                                                       // ~25/s over the relay
    lastMouse = t;
    const mx = (e.clientX / W) * 2 - 1, my = (e.clientY / H) * 2 - 1;
    emit({ cmd: 'look', x: +mx.toFixed(3), y: +my.toFixed(3), hold: 10 });
  });
  addEventListener('keydown', e => {
    const step = 0.25;
    switch (e.key) {
      case 'ArrowLeft':  emit({ cmd: 'look', x: e.shiftKey ? -1 : S.target.x - step, y: S.target.y, hold: 5 }); break;
      case 'ArrowRight': emit({ cmd: 'look', x: e.shiftKey ? 1 : S.target.x + step, y: S.target.y, hold: 5 }); break;
      case 'ArrowUp':    emit({ cmd: 'look', x: S.target.x, y: e.shiftKey ? -1 : S.target.y - step, hold: 5 }); break;
      case 'ArrowDown':  emit({ cmd: 'look', x: S.target.x, y: e.shiftKey ? 1 : S.target.y + step, hold: 5 }); break;
      case ' ': emit({ cmd: 'blink' }); break;
      case 'w': emit({ cmd: 'wake' }); break;
      case 's': emit({ cmd: 'sleep' }); break;
      case 'z': emit({ cmd: (S.mode === 'asleep' || S.mode === 'dozing') ? 'wake' : 'sleep' }); break;
      case 'q': emit({ cmd: 'mood', name: 'squint' }); break;
      case 'e': emit({ cmd: 'mood', name: 'wide' }); break;
      case 'n': emit({ cmd: 'mood', name: 'normal' }); break;
      case 'c': emit({ cmd: 'look', x: 0, y: 0, hold: 3 }); break;
      case 'a': emit({ cmd: 'auto', on: !S.auto }); break;
      case 'h': emit({ cmd: 'halo', on: !S.halo }); break;
      case '0': emit({ cmd: 'blank', on: !S.blank }); break;
      case 'm': emit({ cmd: 'motion' }); break;
      case 'g': if (ws && ws.readyState === 1) ws.send(JSON.stringify({ cmd: 'growl' })); else emit({ cmd: 'growl' }); break;   // the relay picks the file and echoes it to everyone, this page included
      case 'd': S.debug = !S.debug; document.body.classList.toggle('debug', S.debug); break;
      case 'f': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); break;
      default: if (STYLE_KEYS[e.key] && STYLES[STYLE_KEYS[e.key]]) emit({ cmd: 'style', name: STYLE_KEYS[e.key] });
    }
  });

  // ---------- behaviour ----------
  // pupil after wake: open over 0.5 s → hold fully open until 2 s → close over 4 s to the hunting slit
  function pupilScript(t) {
    const tw = t - S.wakeT0, ss = c => c * c * (3 - 2 * c);
    if (tw < 0.5) return lerp(S.pupilStart ?? 0.6, 3.2, ss(tw / 0.5));
    if (tw < 2.0) return 3.2;
    return lerp(3.2, 0.9, ss(clamp((tw - 2.0) / 4.0, 0, 1)));
  }

  function tick(t, dt) {
    // ---- sleep / wake state machine ----
    // as a follower, the relay server decides when to doze (it sends {cmd:'sleep'}), pick idle targets, and blink
    if (!S.follower && S.mode === 'awake' && t - S.lastMotion > S.sleepAfter) { S.mode = 'dozing'; }
    if (S.mode === 'dozing' && S.lid < 0.15) { S.mode = 'asleep'; }
    if (S.mode === 'waking' && t - S.wakeT0 > 1.2) { S.mode = 'awake'; }

    if (S.mode === 'asleep' || S.mode === 'dozing') {
      // slumber: lids nearly shut with slow breathing, eye drifts down, rare twitch
      S.baseOpen = 0.11 + 0.02 * Math.sin(shared() * 0.8);   // shared clock: every window breathes in phase. Floor 0.09: at 0.05 the
                                                              // slit vanished on dark-lidded styles (tiku), the opening scales linearly with lid
      S.pupilTarget = 0.6;   // thin slit while dozing
      if (!S.follower && t > S.nextSaccade) {
        S.target.x = rnd(-0.15, 0.15); S.target.y = rnd(0.2, 0.45);
        S.nextSaccade = t + rnd(3, 9);
      }
      S.nextBlink = t + 5;                 // no blinks while asleep
    } else if (S.mode === 'waking') {
      S.pupilTarget = pupilScript(t);
      // snap open wide; gaze already tracks the motion target (set by look/motion) — no stare-ahead pause
      S.baseOpen = 1.2;
      S.nextSaccade = t + 1.5;
      S.nextBlink = t + rnd(1.5, 3);
    } else {
      if (S.baseOpen > 1.15) S.baseOpen = 1.0;
      S.pupilTarget = pupilScript(t); // settle from the wake-flare to a hunting stare (moods can override)
      // idle: random saccades + occasional blinks
      if (!S.follower && S.auto && t > S.override && t > S.nextSaccade) {
        // bias: mostly look side to side across the driveway, sometimes glance at the other eye
        const r = Math.random();
        if (r < 0.15) { S.target.x = 0; S.target.y = 0; }
        else if (r < 0.3) { S.target.x = SIDE === 'left' ? 0.9 : -0.9; S.target.y = rnd(-0.2, 0.2); }
        else { S.target.x = rnd(-1, 1); S.target.y = rnd(-0.5, 0.5); }
        S.nextSaccade = t + rnd(0.8, 4.5);
      }
      if (!S.follower && t > S.nextBlink) { api.blink(); S.nextBlink = t + rnd(2.5, 7); }
    }

    // microsaccades: small quick hops 1–3 Hz while awake and fixating; drift: slow pink-ish noise
    if (S.mode === 'awake' && t > S.nextMicro) {
      const amp = rnd(0.006, 0.02);
      const ang = Math.random() * Math.PI * 2;
      S.microTarget.x = Math.cos(ang) * amp * 1.5; S.microTarget.y = Math.sin(ang) * amp * 0.6;   // horizontal bias
      S.nextMicro = t + rnd(0.35, 1.0);
    } else if (S.mode !== 'awake') { S.microTarget.x = S.microTarget.y = 0; }
    // ease into each micro hop over ~40 ms: still quick, not a hard snap
    const km = 1 - Math.exp(-dt / 0.04);
    S.micro.x = lerp(S.micro.x, S.microTarget.x, km); S.micro.y = lerp(S.micro.y, S.microTarget.y, km);
    S.drift.x = lerp(S.drift.x, rnd(-0.01, 0.01), 1 - Math.pow(0.5, dt));
    S.drift.y = lerp(S.drift.y, rnd(-0.006, 0.006), 1 - Math.pow(0.5, dt));

    // head follow: the whole socket eases a little toward the gaze, lagging behind the eye
    S.head.x = lerp(S.head.x, S.gaze.x * 0.12, 1 - Math.pow(0.2, dt));
    S.head.y = lerp(S.head.y, S.gaze.y * 0.03, 1 - Math.pow(0.2, dt));

    // gaze motion: saccade engine (main sequence — Bahill 1975). Eyes fixate, then jump:
    // latency ~150 ms, duration 25+2.4ms/deg, smoothstep profile, ~10% undershoot + correction.
    // Small errors (<~3°) are chased with smooth pursuit instead.
    const err = Math.hypot(S.target.x - S.gaze.x, S.target.y - S.gaze.y);
    const DEG = 32;                                    // gaze unit → degrees (MAX_ANGLE)
    if (S.sac) {                                       // mid-saccade: ballistic, ignore target changes
      const p = clamp((t - S.sac.t0) / S.sac.dur, 0, 1);
      const e = p * p * (3 - 2 * p);
      S.gaze.x = lerp(S.sac.fx, S.sac.tx, e);
      S.gaze.y = lerp(S.sac.fy, S.sac.ty, e);
      if (p >= 1) { S.sac = null; S.sacEnd = t; }
    } else {
      // a saccade fires only for a fresh target (moved since the last jump); the ~10% undershoot
      // residual is absorbed by smooth pursuit instead (a "glissade") — no visible second hop
      const fresh = !S.sacTgt || Math.hypot(S.target.x - S.sacTgt.x, S.target.y - S.sacTgt.y) * DEG > 1.5;
      if (err * DEG > 3 && fresh) {
        if (!S.sacArm) S.sacArm = t + rnd(0.12, 0.2);  // reaction latency
        if (t >= S.sacArm && t - (S.sacEnd || 0) > 0.12) {
          const dur = (25 + 2.4 * err * DEG * 0.9) / 1000;
          S.sac = { t0: t, dur, fx: S.gaze.x, fy: S.gaze.y,
                    tx: S.gaze.x + (S.target.x - S.gaze.x) * 0.9,
                    ty: S.gaze.y + (S.target.y - S.gaze.y) * 0.9 };
          S.sacTgt = { x: S.target.x, y: S.target.y };
          S.sacArm = null;
        }
      } else {                                         // pursuit / glissade: smooth chase
        S.sacArm = null;
        const k = 1 - Math.exp(-dt / 0.12);
        S.gaze.x = lerp(S.gaze.x, S.target.x, k);
        S.gaze.y = lerp(S.gaze.y, S.target.y, k);
      }
    }
    S.gazeSlow = lerp(S.gazeSlow, S.gaze.x, 1 - Math.exp(-dt / 0.2));
    // dark stage: fade out slowly once the brain says off, come back up to slits quickly on motion
    S.offAmt = lerp(S.offAmt, S.off ? 1 : 0, 1 - Math.exp(-dt / (S.off ? 1.2 : 0.35)));

    // blink envelope
    let blink = 0;
    if (S.blinkPhase) {
      const p = (t - S.blinkPhase.t0) / S.blinkPhase.dur;
      if (p >= 1) S.blinkPhase = null;
      else blink = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;   // close fast, open slower
    }
    S.lidTarget = S.baseOpen * (1 - blink);
    const kl = 1 - Math.pow(S.mode === 'awake' || S.mode === 'waking' ? 0.0001 : S.mode === 'dozing' ? 0.05 : 0.3, dt);
    S.lid = lerp(S.lid, S.lidTarget, kl);
    S.lidBase = lerp(S.lidBase, S.baseOpen, kl); S.blinkAmt = lerp(S.blinkAmt, blink, kl);   // the two components, for lid models that treat them differently
    // brightness: full while awake/dozing/waking, fades only once asleep (lids already shut); brightens fast on wake
    const glowT = S.mode === 'asleep' ? 0.45 : 1;
    S.glowLevel = lerp(S.glowLevel, glowT, 1 - Math.exp(-dt / (glowT > S.glowLevel ? 0.25 : 1.5)));
    // pupil: dilation τ≈1.2 s; contraction slow while awake (τ≈2 s, the post-flare settle), quicker otherwise
    const tau = (S.mode === 'awake' || S.mode === 'waking') ? 0.08 : (S.pupilTarget > S.pupil ? 1.2 : 0.4);
    S.pupil = lerp(S.pupil, S.pupilTarget, 1 - Math.exp(-dt / tau));
    // pupil-size jitter once settled: random wander ±8% with quick twitches; faint ±2% otherwise
    const settled = S.mode === 'awake' && t - S.wakeT0 > 6;
    if (t > (S.nextHippus || 0)) {
      S.hippusTarget = settled ? rnd(-0.08, 0.08) : rnd(-0.02, 0.02);
      S.nextHippus = t + (settled ? rnd(0.25, 1.1) : rnd(0.8, 2));
    }
    S.hippus = lerp(S.hippus, S.hippusTarget || 0, 1 - Math.exp(-dt / 0.15));
  }

  // ---------- drawing ----------
  function draw() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    // fit N side-by-side 9:7 "door" boxes into the window, letterboxed
    const n = SIDES.length, GAP = 0.04;   // gap as fraction of one door width (the post between doors)
    const totalAspect = DOOR_ASPECT * (n + GAP * (n - 1));
    let tw = W, th = W / totalAspect;
    if (th > H) { th = H; tw = H * totalAspect; }
    const dh = th, dw = dh * DOOR_ASPECT, gap = dw * GAP;
    const x0 = (W - tw) / 2 + dw / 2, y0 = H / 2;
    if (!S.blank && S.offAmt < 0.995) {   // eyes off / fully dark: the black fill is the whole picture
      SIDES.forEach((side, i) => drawEye(side, x0 + i * (dw + gap), y0, dw, dh, (i - (n - 1) / 2) * (dw + gap) / (W / 2)));
      if (S.offAmt > 0.003) { ctx.fillStyle = `rgba(0,0,0,${S.offAmt.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }   // fading to / from dark
    }
    if (S.debug) {
      hud.textContent =
`eye=${MODE}${MIRROR ? ' mirror' : ''}  ${S.follower ? 'follower (relay brain)' : 'standalone'}  clock=${shared().toFixed(2)}  mode=${S.mode}  auto=${S.auto}  gaze=(${S.gaze.x.toFixed(2)},${S.gaze.y.toFixed(2)})  lid=${S.lid.toFixed(2)}  manual=${Math.max(0, S.cooldown - (now() - S.lastManual)).toFixed(1)}s
door box ${Math.round(dw)}x${Math.round(dh)}  last=${S.lastCmd}
halo=${S.halo}  blank=${S.blank}  off=${S.off} (${S.offAmt.toFixed(2)})  sound=${SOUND ? `${S.soundOn ? 'on' : 'muted'} vol ${(S.volume * TRIM).toFixed(2)} audio ${Growl.state} ${Growl.samples} samples` : 'off (?sound=1)'}
arrows look · space blink · w wake · s sleep · q/e/n mood · a auto · h glow · m motion · g growl · c center · 1-9/u/t/l style · 0 eyes off · f fullscreen · d hud`;
    }
  }

  // eyeOff: this eye's horizontal offset from screen centre, in gaze units (-1..1 ≈ screen half-width)
  function drawEye(SIDE, cx0, cy0, dw, dh, eyeOff = 0) {
    const cx = cx0 + S.head.x * dw * 0.05, cy = cy0 + S.head.y * dh * 0.05;   // head follow; cy is the corner (canthal) line
    const pulseAmp = STYLE.pulse ?? 0.15;
    const ts = shared();
    let glow = 0.85 * S.glowLevel + pulseAmp * Math.sin(ts * (S.mode === 'asleep' ? 0.6 : 1.1));  // slow pulse; dims only after lids close
    if (STYLE.flicker) glow *= 1 - STYLE.flicker * (0.5 + 0.5 * Math.sin(ts * 23) * Math.sin(ts * 7.3));   // candle flicker
    glow *= STYLE.alpha ?? 1;

    const eyeW = dw * 0.9, eyeH = dh * 0.6;   // almond outline size
    const ey = cy - eyeH * (STYLE.eyeUp ?? 0);  // eyeball centre: human eyes sit above the corner line (corners are level with the lower iris)
    // lids track vertical gaze: looking up raises the upper lid, looking down lowers it (and the lower lid follows less)
    const lidUp = -S.gaze.y * 0.08, lidLo = -S.gaze.y * 0.04;
    // lid geometry: openH / lowerH are the upper / lower lid control-point heights from the centre line (lidUpK / lidLoK scale the
    // fully-open positions). Default: both lids close symmetrically toward the centre (a lens pinching shut).
    let openH, lowerH;
    if (STYLE.lidModel === 'human') {
      // human: the lower lid rises with a squint (cheek raise, saturating at half closure) but only ~15% in a blink; the upper lid
      // does the closing and travels past the centre line to meet the lower lid, so a shut eye is a line below centre.
      const c = 1 - clamp(S.lid, 0, 1);                                   // total closure (mood + sleep + blink)
      const cBase = 1 - clamp(S.lidBase, 0, 1);                           // closure from mood / sleep only
      const lo = (STYLE.lidLoK ?? 0.8) * (1 - 0.45 * Math.min(cBase / 0.5, 1)) * (1 - 0.15 * S.blinkAmt);
      const upOpen = (STYLE.lidUpK ?? 1) * (1 + lidUp);
      openH = eyeH * (upOpen - (upOpen + lo) * c);
      lowerH = eyeH * lo * (1 + lidLo);
    } else {
      openH = eyeH * clamp(S.lid * (1 + lidUp), 0, 1.25) * (STYLE.lidUpK ?? 1);
      lowerH = eyeH * clamp(S.lid * (1 + lidLo), 0, 1.25) * (STYLE.lidLoK ?? 0.8);
    }
    // ---- spherical eyeball model ----
    // eyeball radius: sphere is bigger than the visible opening (lids cover most of it)
    const R = eyeW * 0.38;                      // eyeball radius (0.55 tested: too much travel)
    const fill = STYLE.irisFx === 'fill';       // the whole opening is iris (cat): no disc, pupil geometry sized from the eye height
    const irisR = STYLE.shape === 'round' ? Math.min(eyeW, eyeH * 1.3) / 2 : fill ? eyeH * 0.45 : R * 0.62 * (STYLE.irisK ?? 1);   // round: iris IS the whole disc                      // iris disc radius on the sphere surface
    const pupilR = irisR * 0.45 * S.pupil * (1 + S.hippus);
    const MAX_ANGLE = 0.55;                     // rad (~32°) of rotation at gaze = ±1 (horizontal)
    const VERT_SCALE = 0.35;                    // vertical range as a fraction of horizontal — mostly side to side
    // convergence (Hering's law): exact per-eye look-at at a target on a plane at depth D, split into
    // version (shared by both eyes — this is what reads as tracking) and vergence (equal & opposite),
    // with vergence scaled down (real eyes converge only a few degrees) and low-passed (it is slow).
    const D = 1.5, VERGENCE_K = 0.4;
    const unit = Math.atan2(1, D);                                  // yaw at gaze = 1 for a centred eye
    const version = Math.atan2(S.gaze.x, D);                        // same for both eyes
    const yawSelf = Math.atan2(S.gazeSlow - eyeOff, D), yawOther = Math.atan2(S.gazeSlow + eyeOff, D);
    const vergence = (yawSelf - yawOther) * VERGENCE_K;             // + = this eye turns toward centre
    const gx = clamp((version + vergence / 2) / unit, -1, 1);
    const yaw = (gx + S.micro.x + S.drift.x) * MAX_ANGLE, pitch = (S.gaze.y + S.micro.y + S.drift.y) * MAX_ANGLE * VERT_SCALE;
    // unit direction the iris faces, in view space (z toward viewer)
    const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
    const flat = STYLE.shape === 'round';
    const ix = flat ? cx : cx + R * dx, iy = flat ? cy : ey + R * dy;   // projected iris centre (flat disc for round)
    const pupilOff = flat ? { x: irisR * 0.3 * dx, y: irisR * 0.3 * dy } : { x: 0, y: 0 };
    const phi = Math.atan2(dy, dx);             // direction of displacement (for foreshortening axis)

    if (STYLE.shape === 'carved') { drawCarved(SIDE, cx, cy, eyeW, eyeH, ix, iy, glow); return; }
    if (STYLE.shape === 'flame') { drawFlame(cx, cy, eyeW, eyeH, dx, dy, glow); return; }
    if (STYLE.shape === 'hal') { drawHal(cx, cy, eyeW, eyeH, dx, dy, glow); return; }

    // eye opening path (two quadratic curves), used as clip
    // angry slant: outer corner (away from the other door) rides high, inner corner drops
    const slant = eyeH * 0.22 * (SIDE === 'left' ? -1 : 1) * STYLE.slant;
    const eyePath = () => {
      ctx.beginPath();
      if (STYLE.shape === 'round') {                   // plain disc; lids = the disc squashing shut vertically
        const rr = Math.min(eyeW, eyeH * 1.3) / 2;
        ctx.ellipse(cx, cy, rr, rr * clamp(S.lid, 0.02, 1), 0, 0, Math.PI * 2);   // never taller than the disc
        ctx.closePath(); return;
      }
      // lid peaks: control-point shifts as a fraction of eyeW (the curve's actual peak moves half as far). peakUp moves the upper
      // lid's high point toward the inner corner (default: a little, with the angry slant); peakLo moves the lower lid's low point
      // toward the outer corner (human: the eye is not a symmetric almond)
      // As the eye closes the upper lid's peak slides across to the lower lid's, so a shut eye is one line, not two crossing curves.
      const inward = SIDE === 'left' ? 1 : -1;
      const peakLo = STYLE.peakLo ?? 0, closing = 1 - clamp(S.lid, 0, 1);
      const peakUp = lerp(STYLE.peakUp ?? 0.1 * STYLE.slant, -peakLo, closing);
      ctx.moveTo(cx - eyeW / 2, cy + slant);          // left corner
      ctx.quadraticCurveTo(cx + eyeW * peakUp * inward, cy - openH, cx + eyeW / 2, cy - slant);
      ctx.quadraticCurveTo(cx - eyeW * peakLo * inward, cy + lowerH, cx - eyeW / 2, cy + slant);
      ctx.closePath();
    };

    if (openH + lowerH > 2) {
      // outer ghostly glow (outside the lid) — big soft halo; off by default so the background stays pure black
      if (S.halo) {
        const halo = ctx.createRadialGradient(cx, cy, eyeH * 0.2, cx, cy, eyeW * 0.75 * (STYLE.haloK ?? 1));
        halo.addColorStop(0, `rgba(${STYLE.halo},${0.35 * (STYLE.haloA ?? 1) * S.lid * glow})`);
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      }

      ctx.save();
      eyePath(); ctx.clip();

      // sclera: pale ghostly green-white, darker toward the edges (fill: a dome centred on the pupil — it IS the iris)
      const g = fill ? ctx.createRadialGradient(ix, iy, eyeH * 0.08, ix, iy, eyeW * 0.6)
                     : ctx.createRadialGradient(cx - eyeW * 0.08, ey - eyeH * 0.15, eyeW * 0.1, cx, ey, eyeW * 0.55);
      g.addColorStop(0, `rgba(${STYLE.sclera[0]},${glow})`);
      g.addColorStop(0.6, `rgba(${STYLE.sclera[1]},${glow})`);
      g.addColorStop(1, `rgba(${STYLE.sclera[2]},${STYLE.edgeAlpha ?? 1})`);
      ctx.fillStyle = flat ? '#000' : g; ctx.fillRect(0, 0, W, H);   // flat disc: black under the iris, no sclera
      if (fill && STYLE.fibres) {                                     // iris fibres: static radial streaks out from the pupil, light and dark
        ctx.lineCap = 'round';
        STYLE.fibres.forEach(([col, a0], layer) => {
          const n = 80 + layer * 30; ctx.lineWidth = eyeH * (layer ? 0.005 : 0.007);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + hash(i + layer * 101) * 0.35;
            const r0 = irisR * (0.25 + 0.25 * hash(i + 7)), r1 = eyeW * (0.3 + 0.35 * hash(i + 3 + layer * 17));
            ctx.strokeStyle = `rgba(${col},${a0 * (0.4 + 0.6 * hash(i + 5)) * glow})`;
            ctx.beginPath(); ctx.moveTo(ix + Math.cos(a) * r0, iy + Math.sin(a) * r0); ctx.lineTo(ix + Math.cos(a) * r1, iy + Math.sin(a) * r1); ctx.stroke();
          }
        });
      }

      // iris + pupil: a disc on the sphere, orthographically projected → ellipse squashed by dz along phi
      ctx.save();
      ctx.translate(ix, iy);
      if (!flat) { ctx.rotate(phi); ctx.scale(dz, 1); ctx.rotate(-phi); }
      const ig = ctx.createRadialGradient(0, 0, 0, 0, 0, irisR);
      const IRIS_COLOR = P.get('color') ? '#' + P.get('color') : STYLE.iris[1];
      const irisMid = IRIS_COLOR, irisCore = P.get('color') ? shade(IRIS_COLOR, 0.35) : STYLE.iris[0], irisRim = P.get('color') ? shade(IRIS_COLOR, -0.5) : STYLE.iris[2];
      ig.addColorStop(0, irisCore);
      ig.addColorStop(0.5, irisMid);
      ig.addColorStop(0.85, irisRim);
      ig.addColorStop(1, '#000');
      if (!fill) {
        ctx.globalAlpha = STYLE.alpha ?? 1;
        ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(0, 0, irisR, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (STYLE.irisFx === 'spiral') {
        // rotating Archimedean spiral: colour B bands over colour A, spinning ~0.8 rev/s (both eyes same direction)
        const turns = 3.5, phase = shared() * 5.0;
        ctx.fillStyle = STYLE.spiral[0]; ctx.beginPath(); ctx.arc(0, 0, irisR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = STYLE.spiral[1]; ctx.lineWidth = irisR / turns * 0.5; ctx.lineCap = 'round';
        ctx.beginPath();
        const end = turns * Math.PI * 2;
        for (let th = 0; th <= end; th += 0.08) {
          const r = irisR * 0.97 * th / end;
          const x = r * Math.cos(th + phase), y = r * Math.sin(th + phase);
          th ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        // soft dark rim so it still reads as an eye
        const rimG = ctx.createRadialGradient(0, 0, irisR * 0.7, 0, 0, irisR);
        rimG.addColorStop(0, 'rgba(0,0,0,0)'); rimG.addColorStop(1, 'rgba(20,0,40,.8)');
        ctx.fillStyle = rimG; ctx.beginPath(); ctx.arc(0, 0, irisR, 0, Math.PI * 2); ctx.fill();
      }
      // pupil in eye-local coords — shape per style
      ctx.save(); ctx.translate(pupilOff.x, pupilOff.y);
      const pr = pupilR * STYLE.pupilScale;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      switch (STYLE.pupil) {
        case 'none': break;
        case 'round': {
          if (STYLE.pupilRange) {                        // bounded dilation: [min, max] as a fraction of the iris radius (human)
            const d = clamp((S.pupil - 0.6) / (3.2 - 0.6), 0, 1);   // 0 dozing slit … 1 full wake flare
            ctx.arc(0, 0, irisR * lerp(STYLE.pupilRange[0], STYLE.pupilRange[1], Math.sqrt(d)) * (1 + S.hippus), 0, Math.PI * 2);
          } else ctx.arc(0, 0, Math.min(pr * 0.8, irisR * 0.9), 0, Math.PI * 2);
          break; }
        case 'goat': {                                     // horizontal bar
          const gw = irisR * 0.9, gh = Math.min(pr * 0.5, irisR * 0.6);
          ctx.moveTo(-gw, 0); ctx.quadraticCurveTo(0, -gh, gw, 0); ctx.quadraticCurveTo(0, gh, -gw, 0); break; }
        case 'triangle': {                                 // jack-o-lantern, point up; grows with dilation
          const th = Math.min(pr * 0.9, irisR * 0.95), tw = th * 0.9;
          ctx.moveTo(0, -th); ctx.lineTo(tw, th * 0.7); ctx.lineTo(-tw, th * 0.7); ctx.closePath(); break; }
        case 'hollow': {                                   // ghost: no hard pupil, a dark fade in the centre
          const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(pr * 0.9, irisR * 0.9));
          hg.addColorStop(0, 'rgba(5,15,40,.8)'); hg.addColorStop(0.45, 'rgba(5,15,40,.45)'); hg.addColorStop(1, 'rgba(5,15,40,0)');
          ctx.fillStyle = hg; ctx.arc(0, 0, irisR, 0, Math.PI * 2); break; }
        default: {                                         // vertical slit → fat rounded lens at full dilation
          // half-width from dilation: thin sliver at 0.6, ~80% of the iris at 3.2
          const d = clamp((S.pupil * STYLE.pupilScale - 0.6) / (3.2 - 0.6), 0, 1);
          const dmax = STYLE.noSoulDisc ? 0.22 : 0.6;
          const hw = irisR * lerp(0.06, dmax, d * d * (3 - 2 * d));
          const h = irisR * lerp(0.95, 0.74, d);          // tips pull in as it swells so iris shows top & bottom
          const cw = hw / 0.75, a = lerp(0.35, 0.65, d);  // cubic controls: max x ≈ 0.75·cw; rounder shoulders when wide
          ctx.moveTo(0, -h);
          ctx.bezierCurveTo(cw, -h * a, cw, h * a, 0, h);
          ctx.bezierCurveTo(-cw, h * a, -cw, -h * a, 0, -h); }
      }
      ctx.fill();
      ctx.restore();   // pupil offset
      if (STYLE.catchlight) {                            // specular highlight: a soft white spot upper-left of the pupil (light from above)
        const hx = -irisR * 0.32, hy = -irisR * 0.34, hr = irisR * 0.16;
        const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
        hg.addColorStop(0, `rgba(255,255,255,${STYLE.catchlight * glow})`); hg.addColorStop(0.6, `rgba(255,255,255,${0.6 * STYLE.catchlight * glow})`); hg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      // limbus shadow: iris edge darkens as it turns away (sphere curvature)
      if (!flat) {
      const edge = ctx.createRadialGradient(cx, ey, eyeW * 0.3, cx, ey, eyeW * 0.52);
      edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, `rgba(0,0,0,${0.55 * (STYLE.shadow ?? 1)})`);
      ctx.fillStyle = edge; ctx.fillRect(0, 0, W, H);
      }

      // heavy lid shadow: sinister brow from the top
      const sg = ctx.createLinearGradient(0, cy - openH, 0, cy - openH + Math.max(openH, eyeH * 0.05) * 0.85);
      sg.addColorStop(0, `rgba(0,0,0,${0.95 * (STYLE.shadow ?? 1)})`); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // lid edge — soft, no hard cartoon outline
      if (!flat) { eyePath(); ctx.strokeStyle = STYLE.lid; ctx.lineWidth = eyeH * 0.05; ctx.stroke(); }
    }

  }

  // Eye of Sauron: a ball of fire — radial flame streaks around a tall slit with a glowing rim.
  const hash = i => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); };
  function drawFlame(cx, cy, eyeW, eyeH, gx, gy, glow) {
    const t = shared();
    const R = Math.min(eyeW, eyeH * 1.35) / 2;
    const open = clamp(S.lid, 0.05, 1);
    const sx = cx + gx * R * 0.3, sy = cy + gy * R * 0.2;    // slit + heat centre follow the gaze

    // outer glow into the black (optional, see S.halo)
    if (S.halo) {
      const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.6);
      halo.addColorStop(0, `rgba(${STYLE.halo},${0.45 * glow * open})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
    }

    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, 0.25 + 0.75 * open); ctx.translate(-cx, -cy);   // sleep = ember sliver

    // fire body: layered radial gradient
    const body = ctx.createRadialGradient(sx, sy, R * 0.05, cx, cy, R);
    body.addColorStop(0,    `rgba(255,244,190,${glow})`);
    body.addColorStop(0.35, `rgba(255,160,25,${glow})`);
    body.addColorStop(0.75, `rgba(235,70,8,${0.95 * glow})`);
    body.addColorStop(0.95, `rgba(150,25,0,${0.5 * glow})`);
    body.addColorStop(1,    'rgba(90,10,0,0)');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // radial streaks: back layer deep red, front layer hot yellow — lengths wobble with time
    for (const [n, col, w, r0, r1v] of [[90, '190,25,0', 0.026, 0.5, 0.62], [120, '255,190,40', 0.012, 0.4, 0.55], [60, '255,240,150', 0.007, 0.3, 0.4]]) {
      ctx.lineWidth = R * w; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + hash(i) * 0.2;
        const flick = Math.sin(t * (2 + hash(i + 9) * 3) + hash(i) * 31);
        const len = R * (r0 + r1v * (0.55 + 0.3 * hash(i + 3) + 0.15 * flick));
        ctx.strokeStyle = `rgba(${col},${(0.25 + 0.35 * hash(i + 5) + 0.15 * flick) * glow})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }
    }

    // slit: tall dark lens, width breathes slightly with the pupil, glowing rim
    const sh = R * 0.9, sw = R * (0.065 + 0.04 * clamp(S.pupil, 0.6, 2) / 2);
    const slit = () => {
      ctx.beginPath();
      ctx.moveTo(sx, sy - sh);
      ctx.bezierCurveTo(sx + sw * 1.2, sy - sh * 0.45, sx + sw * 1.2, sy + sh * 0.45, sx, sy + sh);
      ctx.bezierCurveTo(sx - sw * 1.2, sy + sh * 0.45, sx - sw * 1.2, sy - sh * 0.45, sx, sy - sh);
      ctx.closePath();
    };
    slit(); ctx.strokeStyle = `rgba(255,240,170,${0.35 * glow})`; ctx.lineWidth = R * 0.09; ctx.stroke();  // outer haze
    slit(); ctx.strokeStyle = `rgba(255,232,150,${0.95 * glow})`; ctx.lineWidth = R * 0.035; ctx.stroke(); // hot rim
    slit(); ctx.fillStyle = 'rgba(5,0,5,.97)'; ctx.fill();
    // white-hot spark on the rim, upper third
    const spark = ctx.createRadialGradient(sx - sw * 0.8, sy - sh * 0.45, 0, sx - sw * 0.8, sy - sh * 0.45, R * 0.09);
    spark.addColorStop(0, `rgba(255,255,255,${0.9 * glow})`); spark.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spark; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Jack-o-lantern: an angular carved cutout lit from inside. No iris — the flame's hot spot follows the gaze.
  // A carved cut has no lids: the outline never changes. Blink/squint/sleep instead move the candle away —
  // the flame gets smaller and dimmer (blink = brief dip, sleep = distant ember), never a closing slit.
  function drawCarved(SIDE, cx, cy, eyeW, eyeH, ix, iy, glow) {
    const m = SIDE === 'left' ? 1 : -1;                    // mirror: +x is toward the centre for the left eye
    const open = 1;                                        // fixed outline
    const near = clamp(S.lid, 0, 1);                       // 1 candle close … 0 far away
    const cand = 0.12 + 0.88 * near, reach = 0.45 + 0.55 * near;   // brightness and radius of the flame
    glow *= cand;
    // left-eye template, x: -1 outer … +1 inner, y: -1 top … +1 bottom
    const pts = [
      [ 1.00,  0.75],   // needle-sharp inner tip, low near the nose
      [-0.20, -0.55],   // long top edge climbing outward
      [-0.80, -1.00],   // high outer corner
      [-1.00, -0.45],   // outer side, short
      [-0.85,  0.30],   // outer bottom corner
      [-0.30,  0.25],   // bottom edge…
      [-0.05,  0.60],   // …one notch
      [ 0.25,  0.45],
    ];
    const path = () => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        const x = cx + px * m * eyeW * 0.5, y = cy + py * eyeH * 0.55 * open;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
    };
    // no halo: the pumpkin is dark, only the cut glows

    ctx.save(); path(); ctx.clip();
    // unlit pumpkin flesh (deep orange-brown) then the flame gradient centred on the gaze hot spot
    ctx.fillStyle = 'rgb(70,22,0)'; ctx.fillRect(0, 0, W, H);
    const hx = cx + (ix - cx) * 0.6, hy = cy + (iy - cy) * 0.5;
    const fire = ctx.createRadialGradient(hx, hy, 0, hx, hy, eyeW * 0.62 * reach);
    fire.addColorStop(0,    `rgba(255,251,224,${glow})`);
    fire.addColorStop(0.18, `rgba(255,205,60,${glow})`);
    fire.addColorStop(0.5,  `rgba(255,110,10,${0.95 * glow})`);
    fire.addColorStop(1,    'rgba(120,25,0,0)');
    ctx.fillStyle = fire; ctx.fillRect(0, 0, W, H);
    // inner rim: the cut wall catches light on the far side from the flame
    const rim = ctx.createRadialGradient(hx, hy, eyeW * 0.3 * reach, hx, hy, eyeW * 0.6 * reach);
    rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(60,15,0,.55)');
    ctx.fillStyle = rim; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // carved edge: thick dark cut with a thin lit bevel
    path(); ctx.strokeStyle = 'rgba(20,6,0,.95)'; ctx.lineWidth = eyeH * 0.06; ctx.lineJoin = 'round'; ctx.stroke();
    path(); ctx.strokeStyle = `rgba(255,150,40,${0.5 * glow})`; ctx.lineWidth = eyeH * 0.012; ctx.stroke();
  }

  // HAL 9000: a chrome bezel around a black glass lens. Nothing here turns or closes — HAL never moved his eye. What sells it is
  // the light inside the glass: a red bloom that breathes and wanders, a crescent reflection orbiting slowly off the lens elements,
  // a white-hot core with a horizontal anamorphic streak, all over etched concentric rings and a dotted dial. The core and bloom
  // slide a little toward the gaze (parallax through the lens) so it still reads as watching. No lids: blink, squint and sleep dim
  // the lamp instead (sleep = a dull standby ember with a pinprick core); the wake flare (S.pupil) swells the core and bloom.
  // The bezel and the etched rings never change, so they are rendered once per size into an offscreen canvas (Pi-friendly).
  let halCache = null;
  const HAL_RINGS = [[0.26, .5], [0.4, .5], [0.53, .45], [0.65, .45], [0.75, .4], [0.84, .55], [0.93, .7], [0.975, .9]];   // etched rings: radius, weight
  function halBezel(R) {
    const key = `${Math.round(R)}:${DPR}`;
    if (halCache && halCache.key === key) return halCache;
    const size = Math.ceil(R * 2.4), c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * DPR);
    const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const o = size / 2;
    // bezel: a chrome ring lit from the upper left; inner and outer radii as fractions of the lens
    const B0 = 1.03, B1 = 1.17;
    const chrome = g.createLinearGradient(o - R * B1, o - R * B1, o + R * B1, o + R * B1);
    chrome.addColorStop(0, '#e6e6e6'); chrome.addColorStop(0.35, '#a0a0a0'); chrome.addColorStop(0.55, '#5c5c5c'); chrome.addColorStop(1, '#1e1e1e');
    g.fillStyle = chrome; g.beginPath(); g.arc(o, o, R * B1, 0, Math.PI * 2); g.arc(o, o, R * B0, 0, Math.PI * 2, true); g.fill();
    // brushed texture: fine concentric arcs of random tone; and a bright bevel on the outer edge, a dark groove inside
    for (let i = 0; i < 70; i++) {
      const r = R * lerp(B0, B1, (i + 0.5) / 70), a = hash(i + 300) - 0.5;
      g.strokeStyle = a > 0 ? `rgba(255,255,255,${(a * 0.16).toFixed(3)})` : `rgba(0,0,0,${(-a * 0.22).toFixed(3)})`;
      g.lineWidth = R * 0.003; g.beginPath(); g.arc(o, o, r, 0, Math.PI * 2); g.stroke();
    }
    const bevel = g.createLinearGradient(o - R, o - R, o + R, o + R);
    bevel.addColorStop(0, 'rgba(255,255,255,.55)'); bevel.addColorStop(0.5, 'rgba(255,255,255,.08)'); bevel.addColorStop(1, 'rgba(0,0,0,.6)');
    g.strokeStyle = bevel; g.lineWidth = R * 0.012; g.beginPath(); g.arc(o, o, R * (B1 - 0.006), 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = R * 0.02; g.beginPath(); g.arc(o, o, R * (B0 + 0.01), 0, Math.PI * 2); g.stroke();
    // inner lip: a thin second ring right against the glass, lit from the opposite side (it faces inward)
    const lip = g.createLinearGradient(o + R, o + R, o - R, o - R);
    lip.addColorStop(0, '#d0d0d0'); lip.addColorStop(0.5, '#707070'); lip.addColorStop(1, '#202020');
    g.strokeStyle = lip; g.lineWidth = R * 0.028; g.beginPath(); g.arc(o, o, R * 1.014, 0, Math.PI * 2); g.stroke();
    // glass: black with the faintest deep-red cast in the middle so it never reads as a hole
    const glass = g.createRadialGradient(o, o, 0, o, o, R);
    glass.addColorStop(0, '#1a0000'); glass.addColorStop(0.7, '#080000'); glass.addColorStop(1, '#000');
    g.fillStyle = glass; g.beginPath(); g.arc(o, o, R, 0, Math.PI * 2); g.fill();
    // fine horizontal grain across the glass (the scan-line look of the reference), clipped to the glass so it stays off the bezel
    g.save(); g.beginPath(); g.arc(o, o, R, 0, Math.PI * 2); g.clip();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = Math.max(1, R * 0.004);
    for (let y = -R; y < R; y += R * 0.045) { g.beginPath(); g.moveTo(o - R, o + y); g.lineTo(o + R, o + y); g.stroke(); }
    g.restore();
    return (halCache = { key, canvas: c, size });
  }
  function drawHal(cx, cy, eyeW, eyeH, gx, gy, glow) {
    const t = shared();
    const R = Math.min(eyeW, eyeH * 1.35) / 2 * 0.84;             // lens radius; the bezel adds 17%
    const near = clamp(S.lid, 0, 1);                              // no lids: 1 lamp full … 0 blink dip / standby
    const lamp = 0.25 + 0.75 * near;
    const g = clamp(glow * lamp, 0, 1);
    const gc = Math.max(g, 0.3 * S.glowLevel);                   // the core never goes out: a blink is a dip, standby is a pinprick
    const flare = clamp((S.pupil - 0.6) / 2.6, 0, 1);            // wake flare: the core swells and the bloom fills the glass
    // breathing: two slow incommensurate sines so the glow never quite repeats; wander: the bloom drifts around the centre
    const breathe = clamp(0.55 + 0.3 * Math.sin(t * 0.9) + 0.15 * Math.sin(t * 0.37 + 2), 0, 1);
    const wx = Math.sin(t * 0.31) * 0.07 + Math.sin(t * 0.13 + 1) * 0.05, wy = Math.cos(t * 0.27 + 2) * 0.05;
    // parallax: the core moves a little toward the gaze, the bloom (deeper in the lens) a little more
    const hx = cx + gx * R * 0.2, hy = cy + gy * R * 0.14;
    const bx = cx + (gx * 0.32 + wx) * R, by = cy + (gy * 0.22 + wy) * R;

    if (S.halo) {                                                 // red spill on the wall around the bezel
      const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.9);
      halo.addColorStop(0, `rgba(${STYLE.halo},${0.4 * g})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
    }
    const bz = halBezel(R);
    ctx.drawImage(bz.canvas, cx - bz.size / 2, cy - bz.size / 2, bz.size, bz.size);

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.995, 0, Math.PI * 2); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';                     // everything inside the glass is light: it adds up

    // red bloom: the big soft glow; its reach breathes and the wake flare pushes it out to the rim
    const bloomR = R * (0.7 + 0.3 * breathe + 0.25 * flare);
    const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, bloomR);
    bloom.addColorStop(0, `rgba(255,70,35,${0.95 * g})`); bloom.addColorStop(0.3, `rgba(230,30,10,${0.7 * g})`);
    bloom.addColorStop(0.65, `rgba(150,8,2,${0.35 * g})`); bloom.addColorStop(1, 'rgba(60,0,0,0)');
    ctx.fillStyle = bloom; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // deep red fill so the whole lens reads red even between breaths, dark right at the rim
    const base = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    base.addColorStop(0, `rgba(140,12,0,${0.45 * g})`); base.addColorStop(0.8, `rgba(80,5,0,${0.35 * g})`); base.addColorStop(1, 'rgba(30,0,0,0)');
    ctx.fillStyle = base; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // etched rings light up with the lamp (in the dark they all but vanish — glass, not a target)
    ctx.lineWidth = R * 0.006;
    for (const [r, a] of HAL_RINGS) { ctx.strokeStyle = `rgba(255,50,30,${(a * 0.45 * g).toFixed(3)})`; ctx.beginPath(); ctx.arc(cx, cy, R * r, 0, Math.PI * 2); ctx.stroke(); }

    // crescent reflections off the lens elements: two diffuse smears orbiting slowly in opposite directions. Each is an arc drawn
    // as widening, fading strokes (a cheap blur — no shadowBlur on the Pi) in segments whose alpha tapers to nothing at both ends
    ctx.lineCap = 'butt';
    for (const [spd, ph, rad, len, a0] of [[0.19, 0, 0.55, 2.2, 0.9], [-0.11, 2.1, 0.7, 1.6, 0.5]]) {
      const ang = t * spd + ph, ox = cx + Math.cos(ang * 0.7) * R * 0.2, oy = cy + Math.sin(ang * 0.7) * R * 0.15;
      const segs = 8, amp = a0 * (0.5 + 0.5 * breathe) * g;
      for (let k = 0; k < 4; k++) {
        ctx.lineWidth = R * (0.02 + k * 0.055);
        for (let i = 0; i < segs; i++) {
          const a1 = ang + len * i / segs, a2 = a1 + len / segs + 0.01, taper = Math.sin(Math.PI * (i + 0.5) / segs);
          ctx.strokeStyle = `rgba(255,80,50,${(amp * taper * 0.35 / (1 + k * 1.2)).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(ox, oy, R * rad, a1, a2); ctx.stroke();
        }
      }
    }
    // the dotted dial: bright red beads on the outer ring, brighter as the lamp breathes
    const beads = 48, beadA = (0.35 + 0.45 * breathe) * g;
    ctx.fillStyle = `rgba(255,70,50,${beadA.toFixed(3)})`;
    for (let i = 0; i < beads; i++) {
      const a = (i / beads) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.93, cy + Math.sin(a) * R * 0.93, R * 0.013, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = `rgba(255,60,40,${(beadA * 0.5).toFixed(3)})`;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + 0.05;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.84, cy + Math.sin(a) * R * 0.84, R * 0.009, 0, Math.PI * 2); ctx.fill();
    }
    // hot core: white centre, orange-red skirt; swells with the wake flare and flickers a hair
    const coreR = R * (0.11 + 0.1 * flare) * (1 + 0.04 * Math.sin(t * 17)), skirtR = R * (0.38 + 0.15 * flare);
    const skirt = ctx.createRadialGradient(hx, hy, 0, hx, hy, skirtR);
    skirt.addColorStop(0, `rgba(255,150,110,${0.95 * gc})`); skirt.addColorStop(0.4, `rgba(255,50,20,${0.45 * gc})`); skirt.addColorStop(1, 'rgba(255,20,0,0)');
    ctx.fillStyle = skirt; ctx.fillRect(hx - skirtR, hy - skirtR, skirtR * 2, skirtR * 2);
    const core = ctx.createRadialGradient(hx, hy, 0, hx, hy, coreR);
    core.addColorStop(0, `rgba(255,255,255,${gc})`); core.addColorStop(0.3, `rgba(255,240,230,${0.95 * gc})`);
    core.addColorStop(0.6, `rgba(255,140,100,${0.55 * gc})`); core.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.fillStyle = core; ctx.fillRect(hx - coreR, hy - coreR, coreR * 2, coreR * 2);
    // anamorphic flare: a razor-thin white-pink line right across the glass plus a wider soft red band; a short vertical one
    const fl = R * (1.1 + 0.2 * flare);
    for (const [h, col, a] of [[0.08, '255,70,40', 0.45], [0.03, '255,140,110', 0.5], [0.012, '255,225,215', 1]]) {
      const lg = ctx.createLinearGradient(hx - fl, 0, hx + fl, 0);
      lg.addColorStop(0, `rgba(${col},0)`); lg.addColorStop(0.5, `rgba(${col},${(a * gc).toFixed(3)})`); lg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = lg; ctx.fillRect(hx - fl, hy - R * h / 2, fl * 2, R * h);
    }
    const vg = ctx.createLinearGradient(0, hy - R * 0.4, 0, hy + R * 0.4);
    vg.addColorStop(0, 'rgba(255,120,100,0)'); vg.addColorStop(0.5, `rgba(255,120,100,${0.35 * gc})`); vg.addColorStop(1, 'rgba(255,120,100,0)');
    ctx.fillStyle = vg; ctx.fillRect(hx - R * 0.006, hy - R * 0.4, R * 0.012, R * 0.8);
    // flare ghosts: dim red discs strung along the streak, the way the reference's lens throws them
    for (const [k, r, a] of [[-0.32, 0.09, 0.3], [0.42, 0.07, 0.2], [-0.55, 0.05, 0.15]]) {
      const gg = ctx.createRadialGradient(hx + k * R, hy, 0, hx + k * R, hy, R * r);
      gg.addColorStop(0, `rgba(255,60,40,${a * g})`); gg.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = gg; ctx.fillRect(hx + k * R - R * r, hy - R * r, R * r * 2, R * r * 2);
    }
    // glass: a soft white sheen up and to the left where the room reflects
    ctx.globalCompositeOperation = 'source-over';
    const sheen = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.55, 0, cx - R * 0.45, cy - R * 0.55, R * 0.7);
    sheen.addColorStop(0, 'rgba(255,255,255,.07)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
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
