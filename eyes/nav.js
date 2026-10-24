// nav.js — lets the relay steer which page a projector window shows (eyes, Christmas loops, video test, ...).
//
// The kiosk Pi launches one Chromium per output on a fixed URL (index.html?eye=left|right&mirror=1) and relaunches it on
// that URL after the nightly refresh or a crash. So the *server* remembers which page each output should show
// (B.pages), hands it out in {cmd:'sync'} on connect, and any page that includes this script follows it:
//
//   {cmd:'navigate', out:'left'|'right'|'all', url:'xmas.html?door={out}'}   controller → relay → every window
//   {cmd:'sync', pages:{left:'...', right:'...'}, ...}                        relay → a window on connect
//
// `url` is a template relative to this site; `{out}` becomes the window's output name. Relative only (no scheme, no //),
// so a kiosk can never be sent off this host by an unauthenticated LAN client. Which output a window is: ?out=, else
// ?eye=, else ?door=. A 'both' window (previews, the control page's iframe) is left alone unless it has ?follow=1.
//
// Pages with their own relay socket (eye.js) call nav.handle(m) from their message handler; pages without one load
// this with <script src="nav.js" data-listen></script> and it opens a listen-only socket itself.
window.nav = (() => {
  const P = new URLSearchParams(location.search);
  const OUT = P.get('out') || P.get('eye') || P.get('door') || 'both';
  const FOLLOW = OUT === 'left' || OUT === 'right' || P.get('follow') === '1';
  const okUrl = u => typeof u === 'string' && u.length <= 512 && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//');
  const target = tpl => new URL(tpl.replace(/\{out\}/g, OUT), location.href);
  // Already there? Same path and every param of the template present with the same value (a page may add its own,
  // e.g. xmas.html writes ?loop= as you step through; that must not bounce it back on reconnect).
  const here = u => u.pathname === location.pathname && [...u.searchParams].every(([k, v]) => new URLSearchParams(location.search).get(k) === v);
  function go(tpl) {
    if (!okUrl(tpl)) return false;
    const u = target(tpl);
    if (here(u)) return false;
    location.replace(u.href);   // replace, not assign: the kiosk's history stays flat
    return true;
  }
  function handle(m) {
    if (!FOLLOW || !m) return false;
    if (m.cmd === 'navigate') return (m.out === 'all' || m.out === OUT) && go(m.url);
    if (m.cmd === 'sync' && m.pages) { const tpl = m.pages[OUT] || (OUT === 'both' ? m.pages.left : null); return tpl ? go(tpl) : false; }
    return false;
  }
  // Pages without a socket of their own get one here; nav.on(fn) sees every message (show.html uses it for its
  // clip/clock commands), and nav.send(m) talks back.
  const hooks = []; let sock = null;
  function listen() {
    if (!location.protocol.startsWith('http')) return;
    const wsUrl = P.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const connect = () => {
      const ws = sock = new WebSocket(wsUrl);
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } if (handle(m)) return; for (const h of hooks) h(m); };
      ws.onclose = () => { sock = null; setTimeout(connect, 2000); };
    };
    connect();
  }
  const on = fn => hooks.push(fn);
  const send = m => { if (sock && sock.readyState === 1) sock.send(JSON.stringify(m)); };
  if (document.currentScript && document.currentScript.dataset.listen !== undefined) listen();
  return { out: OUT, follow: FOLLOW, handle, listen, on, send };
})();
