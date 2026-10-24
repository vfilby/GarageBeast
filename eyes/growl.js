// Sound for the garage eyes. Two voices:
//   the wake growl   a recorded sample — the brain picks one from eyes/sounds/ per wake and names it in {cmd:'growl',file}: the first synthesised attempt was judged
//                    "not a growl" (2026-09-19) — a formant synth makes a convincing rumble, not a convincing animal. The synth
//                    still stands in when no sample loads, so the feature never goes silent.
//   the sniff        {soft:true, voice:'sniff'}: synthesised noise puffs, a big snout trying to catch a scent.
//   the rumble       {soft:true}: the synth, quieter, darker and slower — a purr-like throat noise while the eyes look around —
//                    or, when the brain names one, a rumble-* sample (sleeping-dragon breaths) played at a reduced level.
// The synth is WebAudio only, so there is no asset to ship or licence for it.
//   Growl.init()            create the AudioContext (kiosk Chromium runs with --autoplay-policy=no-user-gesture-required;
//                           anywhere else the first key / pointer press unlocks it)
//   Growl.play({gain, soft, file})   one growl (file, else the page default, else synth 2.2–2.9 s) or one soft rumble (synth 1.4–2.1 s)
//   Growl.load(url)         this page's default wake sample (?growl= or growl.mp3; a 404 just leaves the synth in place)
//   Growl.preload(urls)     warm the cache with the brain's pool (eyes/sounds/*, named in sync) so the first growl is not late
//   Growl.build(ac, dest, t0, o)   the synth graph on any (Offline)AudioContext; returns the duration (used by play and by offline renders)
//
// The model: a growl is not a low *note*, it is a slow glottal pulse train (25–30 Hz, far below a voice) ringing a big vocal tract.
// So: sawtooth "pulses" with a jittered rate that rises into the growl and sags out of it -> soft-clip grit -> three parallel formant
// band-passes (a long throat: ~190 / 560 / 1200 Hz, F1 opening and closing like a jaw) + a low-passed chest path, plus breath noise
// gated by the same pulses. Small speakers (a projector's) can't reproduce 27 Hz, but the 27 Hz *spacing* of the harmonics they can
// reproduce still reads as that pitch (missing fundamental), which is why the formant band carries most of the level.
(() => {
  'use strict';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ss = c => { c = clamp(c, 0, 1); return c * c * (3 - 2 * c); };
  const lerp = (a, b, t) => a + (b - a) * t;

  let shaperCurve = null;
  const shaper = () => {
    if (!shaperCurve) { shaperCurve = new Float32Array(1024); for (let i = 0; i < 1024; i++) shaperCurve[i] = Math.tanh(3.2 * (i / 511.5 - 1)); }
    return shaperCurve;
  };
  // smoothed random walk in [-1, 1], n points: pulse-rate jitter and loudness shimmer, so no two pulses are identical
  const wander = (n, step) => { const a = new Float32Array(n); let v = 0; for (let i = 0; i < n; i++) { v = clamp(v * 0.9 + rnd(-step, step), -1, 1); a[i] = v; } return a; };

  // The sniff: something big trying to catch a scent. Unlike a growl, a sniff IS shaped noise, so the synth is honest here:
  // 2–4 quick inhales (noise through a band-pass that rises as the nostrils pull), the last one longer, then sometimes a low
  // huff out. It has to be the same animal as the growls, so it is low and rumbly, not a bright human sniff (the first render
  // had two thirds of its energy above 800 Hz): the band runs ~300 -> 520 Hz, a 200 Hz resonance is the snout, the top is gone
  // above 1.4 kHz, and the purr's ~28 Hz throat pulse flutters every inhale and rumbles quietly underneath. Dry: no reverb.
  function buildSniff(ac, dest, t0, o = {}) {
    const gain = (o.gain ?? 1) * 0.5;   // understated: well under the growls (0.9 was judged too loud next to them)
    const nb = ac.createBuffer(1, Math.ceil(ac.sampleRate * 2), ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const band = ac.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 1.1; band.frequency.value = 340;
    const snout = ac.createBiquadFilter(); snout.type = 'bandpass'; snout.frequency.value = 200; snout.Q.value = 2.5; const snoutLv = ac.createGain(); snoutLv.gain.value = 0.9;
    const air = ac.createBiquadFilter(); air.type = 'bandpass'; air.frequency.value = 1100; air.Q.value = 0.8; const airLv = ac.createGain(); airLv.gain.value = 0.06;
    const pulse = ac.createOscillator(); pulse.type = 'sawtooth'; pulse.frequency.value = rnd(25, 31);
    const flutter = ac.createGain(); flutter.gain.value = 0.6;                     // breath: opened and shut by the throat pulse
    const depth = ac.createGain(); depth.gain.value = 0.4; pulse.connect(depth).connect(flutter.gain);
    const body = ac.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 170; const bodyLv = ac.createGain(); bodyLv.gain.value = 0.16;
    const amp = ac.createGain(); amp.gain.value = 0;
    const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1400; tone.Q.value = 0.5;
    const sub = ac.createBiquadFilter(); sub.type = 'highpass'; sub.frequency.value = 70;
    const out = ac.createGain(); out.gain.value = gain;
    noise.connect(band).connect(flutter); noise.connect(snout).connect(snoutLv).connect(flutter); noise.connect(air).connect(airLv).connect(flutter);
    flutter.connect(amp); pulse.connect(body).connect(bodyLv).connect(amp);
    amp.connect(sub).connect(tone).connect(out).connect(dest);
    let t = t0;
    const puff = (len, level, f0, f1) => {            // one inhale (rising) or huff (falling): eased in, slower out — nothing sharp
      band.frequency.setValueAtTime(f0, t); band.frequency.exponentialRampToValueAtTime(f1, t + len);
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(level, t + len * 0.35);
      amp.gain.setValueAtTime(level, t + len * 0.55); amp.gain.linearRampToValueAtTime(0, t + len);
      t += len;
    };
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const last = i === n - 1, f0 = rnd(280, 360);
      puff(last ? rnd(0.42, 0.6) : rnd(0.2, 0.3), (last ? 1 : rnd(0.6, 0.85)), f0, f0 * rnd(1.4, 1.65));
      t += last ? 0 : rnd(0.08, 0.16);
    }
    if (Math.random() < 0.6) { t += rnd(0.25, 0.45); puff(rnd(0.6, 0.95), 0.55, rnd(300, 360), rnd(170, 210)); }   // the huff out: lower, falling
    for (const src of [noise, pulse]) { src.start(t0); src.stop(t + 0.1); }
    noise.onended = () => out.disconnect();
    return t - t0;
  }

  function build(ac, dest, t0, o = {}) {
    if (o.voice === 'sniff') return buildSniff(ac, dest, t0, o);
    const soft = !!o.soft;
    const dur = o.dur || (soft ? rnd(2.6, 3.6) : rnd(2.2, 2.9)), rate = o.rate || (soft ? rnd(21, 26) : rnd(24, 30)), gain = (o.gain ?? 1) * (soft ? 0.3 : 1);
    const end = t0 + dur + 0.15;

    // pulse rate: up a third into the growl (first quarter), then sagging below where it began; ±5% jitter throughout
    const N = 64, f1 = new Float32Array(N), f2 = new Float32Array(N), jit = wander(N, 0.35);
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const c = soft ? lerp(0.95, 1.06, Math.sin(Math.PI * u)) * lerp(1, 0.86, ss((u - 0.5) / 0.5))   // soft: barely moves, sinks at the end
                     : u < 0.25 ? lerp(0.78, 1.28, ss(u / 0.25)) : lerp(1.28, 0.7, ss((u - 0.25) / 0.75));
      f1[i] = rate * c * (1 + 0.05 * jit[i]);
      f2[i] = f1[i] * 2.015;                         // an octave up, a hair sharp: beats slowly against the first, thickens the throat
    }
    const osc1 = ac.createOscillator(), osc2 = ac.createOscillator();
    osc1.type = osc2.type = 'sawtooth';
    osc1.frequency.setValueCurveAtTime(f1, t0, dur); osc2.frequency.setValueCurveAtTime(f2, t0, dur);
    const g1 = ac.createGain(), g2 = ac.createGain(); g1.gain.value = soft ? 0.42 : 0.8; g2.gain.value = soft ? 0.12 : 0.35;   // soft: barely into the clipper, so round not gritty
    const drive = ac.createWaveShaper(); drive.curve = shaper(); drive.oversample = '2x';
    osc1.connect(g1).connect(drive); osc2.connect(g2).connect(drive);

    // loudness: swell in, peak about a third through, long fall; 5.5 Hz flutter and a random shimmer ride on top
    const M = 256, env = new Float32Array(M), shim = wander(M, 0.25), flut = rnd(4.8, 6.2);
    for (let i = 0; i < M; i++) {
      const u = i / (M - 1);
      // soft = a purr: no onset at all, one slow swell and fall (a breath), hardly any flutter
      const e = soft ? Math.pow(Math.sin(Math.PI * u), 1.6)
                     : ss(u / 0.14) * (0.72 + 0.28 * Math.sin(Math.PI * clamp(u / 0.7, 0, 1))) * (1 - ss((u - 0.6) / 0.4));
      env[i] = e * (1 + (soft ? 0.04 : 0.12) * Math.sin(2 * Math.PI * flut * u * dur) + (soft ? 0.05 : 0.1) * shim[i]);
    }
    env[M - 1] = 0;
    const amp = ac.createGain(); amp.gain.value = 0; amp.gain.setValueCurveAtTime(env, t0, dur);

    // a sawtooth falls 6 dB/octave, so left alone nearly all the level sits under 100 Hz — exactly the band a small speaker throws
    // away (first render: 88% of the energy below 100 Hz). Tilt the source up before the throat so the formants carry the growl.
    const tilt = ac.createBiquadFilter(); tilt.type = 'highshelf'; tilt.frequency.value = 260; tilt.gain.value = soft ? 6 : 13;
    drive.connect(tilt);
    // throat: three formants in parallel; F1 opens with the swell and closes again (the jaw)
    for (const [f, q, lvl, open] of [[210, 2.2, 0.26, 1.45], [580, 3.5, 0.26, 1.15], [1250, 4.5, 0.17, 1.05]]) {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(f, t0);
      bp.frequency.linearRampToValueAtTime(f * open, t0 + dur * 0.35);
      bp.frequency.linearRampToValueAtTime(f * 0.92, t0 + dur);
      const lv = ac.createGain(); lv.gain.value = lvl;
      tilt.connect(bp).connect(lv).connect(amp);
    }
    // chest: what a real speaker can make of the fundamental
    const chest = ac.createBiquadFilter(); chest.type = 'lowpass'; chest.frequency.value = 140; chest.Q.value = 0.7;
    const chestLv = ac.createGain(); chestLv.gain.value = 0.13;
    drive.connect(chest).connect(chestLv).connect(amp);

    // breath: band-passed noise, opened and shut by the same pulses so it rattles rather than hisses
    const nb = ac.createBuffer(1, Math.ceil(ac.sampleRate * 1.5), ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const nbp = ac.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 850; nbp.Q.value = 0.8;
    const ngate = ac.createGain(); ngate.gain.value = soft ? 0.05 : 0.14;
    const nmod = ac.createGain(); nmod.gain.value = soft ? 0.05 : 0.14;
    osc1.connect(nmod).connect(ngate.gain);
    noise.connect(nbp).connect(ngate).connect(amp);

    // out: take the fizz off, catch the peaks, level
    const sub = ac.createBiquadFilter(); sub.type = 'highpass'; sub.frequency.value = 70; sub.Q.value = 0.7;   // inaudible, but it eats the compressor's headroom
    const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = soft ? 650 : 3000; tone.Q.value = 0.5;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    const out = ac.createGain(); out.gain.value = 0.9 * gain;
    amp.connect(sub).connect(tone).connect(comp).connect(out).connect(dest);

    for (const s of [osc1, osc2, noise]) { s.start(t0); s.stop(end); }
    osc1.onended = () => out.disconnect();
    return dur;
  }

  let ctx = null, fallback = null;
  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'playback' });
    const unlock = () => { if (ctx.state === 'suspended') ctx.resume(); };
    for (const ev of ['pointerdown', 'mousedown', 'touchend', 'click', 'keydown']) addEventListener(ev, unlock, true);   // Safari only honours some of these as a gesture
    return ctx;
  }
  // samples: decoded once per URL. `fallback` is the page's own default (?growl= / growl.mp3) for when the brain names no file
  // (standalone page, or an empty sounds/ pool); with neither, the synth stands in.
  const cache = new Map();
  const SOFT_SAMPLE = 0.32;   // rumble-* samples are levelled like the growls; played quieter (−10 dB), darker and swelled in: a purr has no attack
  function fetchSample(url) {
    if (!cache.has(url)) cache.set(url, (async () => {
      const r = await fetch(url); if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.arrayBuffer();
      return new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));   // callback form: older Safari has no promise form
    })().catch(e => { console.info('no growl sample (' + url + '):', e.message || e); return null; }));
    return cache.get(url);
  }
  function playBuffer(buf, o, bus) {
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = o.soft ? rnd(0.86, 0.95) : rnd(0.94, 1.03);   // never quite the same twice; soft ones slower = deeper
    const g = ctx.createGain(), t = ctx.currentTime, level = o.gain ?? 1;
    if (!o.soft) { g.gain.value = level; src.connect(g); }
    else {
      const len = buf.duration / src.playbackRate.value, lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.Q.value = 0.5;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + Math.min(1.2, len * 0.3));
      g.gain.setValueAtTime(level, t + len * 0.6); g.gain.linearRampToValueAtTime(0, t + len);
      src.connect(lp).connect(g);
    }
    g.connect(bus); src.onended = () => g.disconnect(); src.start();
  }
  // One voice at a time. Every sound plays through its own bus; a new sound fades the previous bus out in ~80 ms. So a barrage of
  // growl messages (a test script hammering the relay did exactly that to a listening control page) collapses to the last one,
  // and clicking through the pool to audition cuts cleanly from file to file. A soft sound never cuts a growl short.
  let voice = null;   // { bus, soft, until }
  function takeOver(soft, len) {
    const t = ctx.currentTime;
    if (voice && t < voice.until) {
      if (soft && !voice.soft) return null;
      const old = voice.bus; old.gain.setTargetAtTime(0, t, 0.025); setTimeout(() => old.disconnect(), 400);
    }
    const bus = ctx.createGain(); bus.connect(ctx.destination);
    voice = { bus, soft, until: t + len };
    return bus;
  }
  async function start(o) {
    const asked = performance.now();
    const buf = o.voice ? null : (o.file && await fetchSample(o.file)) || (!o.soft && fallback && await fetchSample(fallback)) || null;
    if (performance.now() - asked > 1500) return;        // a first-time download that slow has missed the moment
    const bus = takeOver(!!o.soft, buf ? buf.duration : 3.5); if (!bus) return;
    if (buf) return playBuffer(buf, o.soft ? { ...o, gain: (o.gain ?? 1) * SOFT_SAMPLE } : o, bus);   // a soft call with a file: a rumble-* sample
    voice.until = ctx.currentTime + build(ctx, bus, ctx.currentTime + 0.03, o) + 0.1;
  }
  function play(o = {}) {
    if (!init()) return false;
    if (ctx.state === 'running') { start(o); return true; }
    // still locked (no gesture yet): try, but never let a growl that was asked for long ago fire when the lock finally opens
    const asked = performance.now();
    ctx.resume().then(() => { if (performance.now() - asked < 500) start(o); }).catch(() => {});
    return false;
  }
  // load(url): make url this page's default wake sample; preload(urls): warm the cache (the brain's pool, from sync)
  async function load(url) { if (!init()) return false; const ok = !!(await fetchSample(url)); fallback = ok ? url : null; return ok; }
  function preload(urls) { if (init()) for (const u of urls || []) fetchSample(u); }

  const unlockNow = () => { if (init() && ctx.state === 'suspended') ctx.resume(); };   // call from inside a click handler
  window.Growl = { init, play, load, preload, build, unlock: unlockNow, get state() { return ctx ? ctx.state : 'none'; }, get samples() { return cache.size; } };
})();
