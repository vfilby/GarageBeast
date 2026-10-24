#!/usr/bin/env python3
"""Garage-eyes RTSP tracker.

Pulls the driveway camera's low-res RTSP stream through ffmpeg, runs a YOLO
person detector (ONNX, CPU) on each frame, picks one target, and streams
{cmd:'look', x, y} to the eyes' WebSocket relay so both eyes follow the visitor.
A cheap background-subtraction motion detector runs alongside and sends {cmd:'motion'}
(dark eyes come up to slits) on any movement in the zones, well before YOLO has a person.
A debug page (annotated frame, detections, zones, gaze) is served on STATUS_PORT.

Env:  RTSP_URL (required)  RELAY_URL (ws://halloween-eyes:8000)  MODEL_PATH (model.onnx)
      TRACKER_CONFIG (config.json, hot-reloaded on change)  STATUS_PORT (8080)
      BASE_PATH ('' or e.g. /tracker when behind a path-prefix proxy)  ORT_THREADS (2)
"""
import json, os, sys, time, math, threading, subprocess, queue
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import numpy as np
import cv2
import onnxruntime as ort
from websockets.sync.client import connect as ws_connect

import argparse, shutil, collections
ap = argparse.ArgumentParser(description='garage-eyes RTSP person tracker')
ap.add_argument('--replay', metavar='EVENT_DIR', help='run a recorded event (frames.jsonl + jpgs) through the pipeline instead of the RTSP stream; no relay, no recording')
ap.add_argument('--fast', action='store_true', help='replay as fast as possible (timing logic still uses the recorded timestamps)')
ap.add_argument('--out', metavar='DIR', help='replay: write annotated frames here')
ap.add_argument('--config', help='config path (default $TRACKER_CONFIG or config.json)')
ARGS = ap.parse_args()

CFG_PATH = ARGS.config or os.environ.get('TRACKER_CONFIG', 'config.json')
RTSP_URL = os.environ.get('RTSP_URL')
RELAY_URL = os.environ.get('RELAY_URL', 'ws://halloween-eyes:8000')
MODEL_PATH = os.environ.get('MODEL_PATH', 'model.onnx')
BASE_PATH = os.environ.get('BASE_PATH', '').rstrip('/')
STATUS_PORT = int(os.environ.get('STATUS_PORT', '8080'))
RECORD_DIR = os.environ.get('RECORD_DIR', 'events')
if not RTSP_URL and not ARGS.replay:
    sys.exit('RTSP_URL is required')

COCO = {0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck', 14: 'bird', 15: 'cat', 16: 'dog',
        17: 'horse', 18: 'sheep', 19: 'cow', 21: 'bear', 24: 'backpack', 25: 'umbrella', 26: 'handbag'}
def cname(i): return COCO.get(i, f'cls{i}')

DEFAULTS = {
    'fps': 10,
    'conf': 0.35, 'iou': 0.5,             # accept threshold (zones may override with their own 'conf')
    'track_conf': 0.15,                    # accept down to this if near the previous target (continuation)
    'classes': ['person'],                     # detection classes that count as a target
    'zones': [{'name': 'all', 'poly': [[0, 0], [1, 0], [1, 1], [0, 1]]}],   # foot point must fall in a zone
    'ignore': [],                              # polygons that veto a detection
    'min_height': 0.04,                        # bbox height as fraction of frame height
    'lost_after': 1.5,                         # seconds without a target before we stop steering
    'gaze': {'mirror': False, 'x_gain': 1.0, 'y_range': [-0.35, 0.6], 'smooth': 0.5,
             'deadband': 0.02, 'rate_hz': 10, 'hold': 2.0, 'keepalive': 1.0,
             'squint_below': 0.35, 'conf_smooth': 0.3},   # lids: squint while the (smoothed) target confidence is under this, open above; null disables
    'sticky_radius': 0.15,                     # normalized distance within which the previous target is preferred / continued
    'static_after': 5.0,                       # a person-shaped blob that sits still this long with a smoothed confidence under its
    'static_radius': 0.02,                     #   zone's threshold is a bin / mailbox / parked thing: suppressed while it keeps appearing
    'static_expire': 60.0,                     #   (forgotten this long after it stops being detected). static_after: null disables
    'static_margin': 0.1,                      #   "under the threshold" means ema < zone conf + this: a bin hovers at the threshold, a standing person scores well above
    'record': {'enabled': True, 'fps': 5, 'preroll': 2.0, 'postroll': 2.0, 'max_mb': 500},   # save frames around every event for --replay
    'motion': {'enabled': True, 'scale': 0.5, 'history': 200, 'var_threshold': 32, 'min_area': 0.001, 'warmup': 30, 'rate_hz': 2},
    #   "something moved" (MOG2 on the downscaled grey frame, masked to the zones minus ignores): send {cmd:'motion'} while the
    #   foreground fraction of the zone area is >= min_area, at most rate_hz times a second. warmup: frames to skip while the model learns.
}

def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)

# ---------- config (hot reload) ----------
class Config:
    def __init__(self, path):
        self.path, self.mtime, self.d = path, 0, dict(DEFAULTS)
        self.reload()
    def reload(self):
        try:
            m = os.stat(self.path).st_mtime
        except FileNotFoundError:
            return
        if m == self.mtime:
            return
        try:
            user = json.load(open(self.path))
            d = json.loads(json.dumps(DEFAULTS))
            for k, v in user.items():
                if isinstance(v, dict) and isinstance(d.get(k), dict): d[k].update(v)
                else: d[k] = v
            self.d, self.mtime = d, m
            self.contours = [(z.get('name', f'zone{i}'), np.array(z['poly'], np.float32)) for i, z in enumerate(d['zones'])]
            self.zone_conf = {z.get('name', f'zone{i}'): z.get('conf', d['conf']) for i, z in enumerate(d['zones'])}
            self.ignores = [np.array(p, np.float32) for p in d['ignore']]
            self.model_conf = min([d['conf'], d['track_conf']] + list(self.zone_conf.values()))   # run the model loose, filter per zone
            log('config loaded', self.path, f"zones={[n for n, _ in self.contours]} classes={d['classes']}")
        except Exception as e:
            log('config reload failed:', e)
    def zone_of(self, pt):
        for c in self.ignores:
            if cv2.pointPolygonTest(c, pt, False) >= 0: return None
        for name, c in self.contours:
            if cv2.pointPolygonTest(c, pt, False) >= 0: return name
        return None

# ---------- static-object memory ----------
class Statics:
    """Remembers spots where a person-shaped detection sits without moving (a recycling bin, a mailbox, a parked bike).
    A spot seen continuously for `static_after` s whose smoothed confidence stays under its zone's threshold is suppressed
    until it stops being detected for `static_expire` s. Real people either move or score well."""
    def __init__(self): self.spots = []
    def check(self, foot, conf, zone_conf, now, d):
        after = d.get('static_after')
        if after is None: return False
        r, expire = d['static_radius'], d['static_expire']
        self.spots = [s for s in self.spots if now - s['last'] <= expire]
        for s in self.spots:
            if math.dist(foot, s['foot']) < r:
                s['last'] = now; s['ema'] += (conf - s['ema']) * 0.2; s['n'] += 1
                return now - s['first'] >= after and s['ema'] < zone_conf + d.get('static_margin', 0.1)
        self.spots.append({'foot': [round(foot[0], 3), round(foot[1], 3)], 'first': now, 'last': now, 'ema': conf, 'n': 1})
        return False
    def summary(self, now):
        return [{'foot': s['foot'], 'age': round(now - s['first'], 1), 'conf': round(s['ema'], 2)} for s in self.spots if s['n'] >= 5]

# ---------- motion (any movement, not just people) ----------
class Motion:
    """Background-subtraction motion detector: the eyes' first stage (dark -> slits) needs "something moved" long before
    YOLO scores a half-in-frame body as a person. MOG2 on a downscaled grey frame, opened 3x3 to kill sensor grain,
    masked to the union of the zones minus the ignore polygons; `area` is the moving fraction of that mask."""
    def __init__(self):
        self.sub = self.sub_key = self.mask = self.mask_key = None; self.mask_area = 1
        self.n = 0; self.area = 0.0; self.moving = False; self.last_sent = 0; self.last_log = 0
    def __call__(self, fr, cfg):
        mc = cfg.d.get('motion') or {}
        if not mc.get('enabled', True): self.area = 0.0; self.moving = False; return False
        h, w = fr.shape[:2]; s = mc.get('scale', 0.5); sw, sh = max(8, int(w * s)), max(8, int(h * s))
        sub_key = (sw, sh, mc.get('history', 200), mc.get('var_threshold', 32))
        if sub_key != self.sub_key:      # (re)build the model only when its own parameters change: a config edit must not blind us
            self.sub_key = sub_key; self.n = 0
            self.sub = cv2.createBackgroundSubtractorMOG2(history=int(mc.get('history', 200)), varThreshold=float(mc.get('var_threshold', 32)), detectShadows=False)
        mask_key = (cfg.mtime, sw, sh)
        if mask_key != self.mask_key:
            self.mask_key = mask_key; self.mask = np.zeros((sh, sw), np.uint8)
            for _, c in cfg.contours: cv2.fillPoly(self.mask, [np.int32(c * [sw, sh])], 255)
            for c in cfg.ignores: cv2.fillPoly(self.mask, [np.int32(c * [sw, sh])], 0)
            self.mask_area = max(1, int(np.count_nonzero(self.mask)))
        g = cv2.cvtColor(cv2.resize(fr, (sw, sh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        fg = self.sub.apply(g)
        fg = cv2.bitwise_and(cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), self.mask)
        self.n += 1; self.area = float(np.count_nonzero(fg)) / self.mask_area
        self.moving = self.n > mc.get('warmup', 30) and self.area >= mc.get('min_area', 0.001)   # the model starts as all-foreground
        return self.moving

# ---------- event recorder ----------
class Recorder:
    """Saves the raw frames around every tracking event — `preroll` s before acquisition (from a ring buffer), every
    frame while tracking, `postroll` s after — as JPEGs at `record.fps`, plus frames.jsonl with what the tracker saw
    on each frame and event.json when it closes. Oldest events are pruned past `max_mb`. Replay with --replay DIR."""
    def __init__(self, root):
        self.root, self.ring, self.ev, self.last_write = root, collections.deque(), None, 0
        os.makedirs(root, exist_ok=True)
    def frame(self, fr, now, info, tracking, rc):
        if not rc.get('enabled', True): return
        if self.ev is None:
            self.ring.append((now, fr, info))
            while self.ring and now - self.ring[0][0] > rc['preroll']: self.ring.popleft()
            if not tracking: return
            self.open(now, rc)
        if tracking: self.ev['last_track'] = now
        elif now - self.ev['last_track'] > rc['postroll']: return self.close(rc)
        if now - self.last_write >= 1 / rc['fps'] - 1e-3: self.write(now, fr, info)
    def open(self, now, rc):
        name = time.strftime('%Y%m%d-%H%M%SZ', time.gmtime(now)); d = os.path.join(self.root, name)
        os.makedirs(d, exist_ok=True)
        self.ev = {'dir': d, 'name': name, 'start': now, 'last_track': now, 'n': 0, 'max_conf': 0.0, 'zones': set()}
        self.last_write = 0; t_prev = -1e9
        for t, fr, info in self.ring:
            if t - t_prev >= 1 / rc['fps'] - 1e-3: self.write(t, fr, info); t_prev = t
        self.ring.clear()
        log(f'recording {name}')
    def write(self, t, fr, info):
        ev = self.ev; i = ev['n']; fn = f'{i:04d}.jpg'
        cv2.imwrite(os.path.join(ev['dir'], fn), fr, [cv2.IMWRITE_JPEG_QUALITY, 85])
        with open(os.path.join(ev['dir'], 'frames.jsonl'), 'a') as f:
            f.write(json.dumps({'i': i, 't': round(t, 3), 'file': fn, **info}) + '\n')
        ev['n'] += 1; self.last_write = t
        if info.get('target'):
            ev['zones'].add(info['target']['zone']); ev['max_conf'] = max(ev['max_conf'], info['target']['det']['conf'])
    def close(self, rc):
        ev, self.ev = self.ev, None
        summary = {'name': ev['name'], 'start': ev['start'], 'end': time.time(), 'frames': ev['n'],
                   'zones': sorted(ev['zones']), 'max_conf': ev['max_conf']}
        with open(os.path.join(ev['dir'], 'event.json'), 'w') as f: json.dump(summary, f, indent=1)
        log(f"recorded {ev['name']}: {ev['n']} frames, max conf {ev['max_conf']:.2f}")
        self.prune(rc['max_mb'])
    def _size(self, d):
        return sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
    def prune(self, max_mb):
        evs = sorted(e for e in os.listdir(self.root) if os.path.isdir(os.path.join(self.root, e)))
        sizes = {e: self._size(os.path.join(self.root, e)) for e in evs}
        while evs and sum(sizes.values()) > max_mb * 1e6:
            e = evs.pop(0); shutil.rmtree(os.path.join(self.root, e), ignore_errors=True); sizes.pop(e)
            log(f'pruned event {e}')
    def list(self):
        out = []
        for e in sorted(os.listdir(self.root), reverse=True):
            d = os.path.join(self.root, e)
            if not os.path.isdir(d): continue
            try: info = json.load(open(os.path.join(d, 'event.json')))
            except Exception: info = {'name': e, 'open': True}
            info['mb'] = round(self._size(d) / 1e6, 1); out.append(info)
        return out

# ---------- replay source (a recorded event through the same pipeline) ----------
class Replay:
    def __init__(self, d, fast):
        self.d, self.fast, self.restarts, self.ts = d, fast, 0, 0
        self.rows = [json.loads(l) for l in open(os.path.join(d, 'frames.jsonl')) if l.strip()]
        if not self.rows: sys.exit(f'no frames in {d}')
        self.i = self.n = 0; self.t = self.rows[0]['t']; self.done = False; self.t0 = time.time()
        im = cv2.imread(os.path.join(d, self.rows[0]['file'])); self.h, self.w = im.shape[:2]
        log(f'replay {d}: {len(self.rows)} frames {self.w}x{self.h}')
    def start(self): pass
    def now(self): return self.t                    # the loop's clock is the recorded time, so timeouts behave as they did live
    def latest(self, after, timeout=None):
        if self.i >= len(self.rows): self.done = True; return None, self.n
        row = self.rows[self.i]
        if not self.fast:
            wait = (row['t'] - self.rows[0]['t']) - (time.time() - self.t0)
            if wait > 0: time.sleep(wait)
        self.i += 1; self.n += 1; self.t = row['t']; self.ts = time.time(); self.row = row
        return cv2.imread(os.path.join(self.d, row['file'])), self.n

class DryRelay:
    connected = False
    def __init__(self): self.sent = 0; self.msgs = []
    def start(self): pass
    def send(self, m): self.sent += 1; self.msgs.append(m)

# ---------- ffmpeg frame source ----------
class Stream(threading.Thread):
    def __init__(self, url, fps):
        super().__init__(daemon=True)
        self.url, self.fps = url, fps
        self.w = self.h = 0
        self.frame, self.n, self.ts = None, 0, 0
        self.cv = threading.Condition()
        self.restarts = 0
    def probe(self):
        while True:
            try:
                out = subprocess.run(['ffprobe', '-v', 'error', '-rtsp_transport', 'tcp', '-select_streams', 'v:0',
                                      '-show_entries', 'stream=width,height', '-of', 'json', self.url],
                                     capture_output=True, text=True, timeout=30).stdout
                s = json.loads(out)['streams'][0]
                self.w, self.h = int(s['width']), int(s['height'])
                log(f'stream {self.w}x{self.h}')
                return
            except Exception as e:
                log('probe failed, retrying:', e); time.sleep(5)
    def run(self):
        self.probe()
        size = self.w * self.h * 3
        while True:
            # low-latency pull: no demuxer/decoder buffering (we always take the newest frame anyway). Don't also shrink
            # probesize/analyzeduration: they only speed the one-time startup and a 32-byte probe fails to find the stream.
            cmd = ['ffmpeg', '-nostdin', '-loglevel', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay',
                   '-rtsp_transport', 'tcp', '-i', self.url, '-an',
                   '-vf', f'fps={self.fps}', '-pix_fmt', 'bgr24', '-f', 'rawvideo', '-']
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=size * 4)
            try:
                while True:
                    buf = b''
                    while len(buf) < size:
                        chunk = p.stdout.read(size - len(buf))
                        if not chunk: raise EOFError
                        buf += chunk
                    fr = np.frombuffer(buf, np.uint8).reshape(self.h, self.w, 3)
                    with self.cv:
                        self.frame, self.n, self.ts = fr, self.n + 1, time.time()
                        self.cv.notify_all()
            except EOFError:
                pass
            finally:
                p.kill(); p.wait()
            self.restarts += 1
            log('ffmpeg exited, restarting in 2s'); time.sleep(2)
    def latest(self, after, timeout=2.0):
        with self.cv:
            self.cv.wait_for(lambda: self.n > after, timeout)
            return self.frame, self.n
    def now(self): return time.time()

# ---------- detector ----------
def nms(boxes, scores, iou):
    order = scores.argsort()[::-1]; keep = []
    while order.size:
        i = order[0]; keep.append(i)
        if order.size == 1: break
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0]); yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2]); yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        a = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
        o = inter / (a[i] + a[order[1:]] - inter + 1e-9)
        order = order[1:][o < iou]
    return keep

class Detector:
    def __init__(self, path):
        so = ort.SessionOptions(); so.intra_op_num_threads = int(os.environ.get('ORT_THREADS', '2'))
        self.sess = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
        inp = self.sess.get_inputs()[0]; self.name = inp.name
        _, _, self.ih, self.iw = inp.shape
        log(f'model {path} input {self.iw}x{self.ih}')
    def __call__(self, bgr, conf_th, iou_th):
        h, w = bgr.shape[:2]; r = min(self.iw / w, self.ih / h); nw, nh = round(w * r), round(h * r)
        canvas = np.full((self.ih, self.iw, 3), 114, np.uint8); dx, dy = (self.iw - nw) // 2, (self.ih - nh) // 2
        canvas[dy:dy + nh, dx:dx + nw] = cv2.resize(bgr, (nw, nh))
        x = np.ascontiguousarray(canvas[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
        out = self.sess.run(None, {self.name: x})[0][0]
        if out.shape[0] < out.shape[1]: out = out.T          # (N, 4+nc)
        boxes, scores = out[:, :4], out[:, 4:]
        cls = scores.argmax(1); conf = scores[np.arange(len(cls)), cls]
        keep = conf >= conf_th
        boxes, cls, conf = boxes[keep], cls[keep], conf[keep]
        if not len(boxes): return []
        xyxy = np.stack([boxes[:, 0] - boxes[:, 2] / 2, boxes[:, 1] - boxes[:, 3] / 2,
                         boxes[:, 0] + boxes[:, 2] / 2, boxes[:, 1] + boxes[:, 3] / 2], 1)
        xyxy[:, [0, 2]] = np.clip((xyxy[:, [0, 2]] - dx) / r, 0, w); xyxy[:, [1, 3]] = np.clip((xyxy[:, [1, 3]] - dy) / r, 0, h)
        # NMS per class: offset each class into its own region so a rider's person box and the bicycle box
        # (heavily overlapping) both survive instead of the higher-scoring one suppressing the other
        offset = xyxy + (cls[:, None] * max(w, h) * 2)
        return [{'box': xyxy[i].tolist(), 'cls': int(cls[i]), 'name': cname(int(cls[i])), 'conf': round(float(conf[i]), 3)}
                for i in nms(offset, conf, iou_th)]

# ---------- relay sender ----------
class Relay(threading.Thread):
    def __init__(self, url):
        super().__init__(daemon=True); self.url, self.q, self.connected, self.sent = url, queue.Queue(maxsize=50), False, 0
    def send(self, msg):
        try: self.q.put_nowait(json.dumps(msg))
        except queue.Full: pass
    def run(self):
        while True:
            try:
                with ws_connect(self.url, open_timeout=5) as ws:
                    self.connected = True; log('relay connected', self.url)
                    while True:
                        try: m = self.q.get(timeout=20)
                        except queue.Empty: ws.ping(); continue
                        ws.send(m); self.sent += 1
            except Exception as e:
                if self.connected: log('relay lost:', e)
            self.connected = False; time.sleep(2)

# ---------- status server ----------
STATE = {'tracking': False, 'target': None, 'gaze': None, 'detections': [], 'fps': 0, 'infer_ms': 0, 'frames': 0,
         'frame_age': None, 'relay': False, 'stream_restarts': 0, 'started': time.time()}
ANNOT = {'jpg': None, 'lock': threading.Lock()}
PAGE = """<!doctype html><title>eyes tracker</title><style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}
img{max-width:100%%;border:1px solid #444}pre{background:#222;padding:8px;overflow:auto}</style>
<h2>garage-eyes tracker</h2><img id=f src="%(b)s/frame.jpg"><pre id=s></pre>
<h3>recorded events</h3><pre id=e></pre>
<script>const b='%(b)s';setInterval(()=>{f.src=b+'/frame.jpg?'+Date.now()},700);
setInterval(async()=>{s.textContent=JSON.stringify(await (await fetch(b+'/status.json')).json(),null,1)},1000);
const ev=async()=>{const l=await (await fetch(b+'/events.json')).json();e.innerHTML=l.map(x=>`<a href="${b}/events/${x.name}/0000.jpg" style="color:#8cf">${x.name}</a>  ${x.frames??'recording'} frames  zones=${(x.zones||[]).join(',')}  max conf ${x.max_conf??'-'}  ${x.mb} MB`).join('\\n')||'none yet'};ev();setInterval(ev,10000)</script>"""
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        p = self.path.split('?')[0]
        if BASE_PATH and p.startswith(BASE_PATH): p = p[len(BASE_PATH):] or '/'
        if p == '/frame.jpg':
            with ANNOT['lock']: data = ANNOT['jpg']
            if data is None: return self.send_error(503, 'no frame yet')
            self.send_response(200); self.send_header('Content-Type', 'image/jpeg'); self.send_header('Cache-Control', 'no-store')
        elif p == '/status.json':
            s = dict(STATE); s['relay'] = relay.connected; s['stream_restarts'] = stream.restarts
            s['frame_age'] = round(time.time() - stream.ts, 2) if stream.ts else None; s['uptime'] = round(time.time() - s['started'])
            data = json.dumps(s).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json')
        elif p == '/config.json':
            data = json.dumps(cfg.d, indent=1).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json')
        elif p == '/events.json':
            data = json.dumps(recorder.list() if recorder else []).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json')
        elif p.startswith('/events/') and recorder:                     # recorded frames / jsonl, read-only
            rel = os.path.normpath(p[len('/events/'):]); fp = os.path.join(recorder.root, rel)
            if rel.startswith('..') or not os.path.isfile(fp): return self.send_error(404)
            data = open(fp, 'rb').read(); self.send_response(200)
            self.send_header('Content-Type', {'.jpg': 'image/jpeg', '.json': 'application/json'}.get(os.path.splitext(fp)[1], 'text/plain'))
        elif p == '/':
            data = (PAGE % {'b': BASE_PATH}).encode(); self.send_response(200); self.send_header('Content-Type', 'text/html')
        else:
            return self.send_error(404)
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

# ---------- main loop ----------
cfg = Config(CFG_PATH)
if ARGS.replay:
    stream = Replay(ARGS.replay, ARGS.fast); relay = DryRelay(); recorder = None
    if ARGS.out: os.makedirs(ARGS.out, exist_ok=True)
else:
    stream = Stream(RTSP_URL, cfg.d['fps']); stream.start()
    relay = Relay(RELAY_URL); relay.start()
    recorder = Recorder(RECORD_DIR)
    threading.Thread(target=lambda: ThreadingHTTPServer(('', STATUS_PORT), Handler).serve_forever(), daemon=True).start()
    log(f'status page on :{STATUS_PORT}{BASE_PATH}/')
det = Detector(MODEL_PATH)
statics = Statics()

COLORS = {'target': (0, 220, 255), 'candidate': (80, 220, 80), 'class': (140, 140, 140), 'small': (140, 140, 140), 'outside': (90, 90, 200), 'lowconf': (90, 90, 200), 'static': (0, 120, 220)}
def annotate(fr, dets, target, gaze):
    im = fr.copy(); h, w = im.shape[:2]
    for _, c in cfg.contours:
        cv2.polylines(im, [np.int32(c * [w, h])], True, (80, 160, 80), 1)
    for c in cfg.ignores:
        cv2.polylines(im, [np.int32(c * [w, h])], True, (0, 0, 200), 1)
    for d in dets:
        x1, y1, x2, y2 = map(int, d['box']); st = d.get('status', 'class'); col = COLORS[st]
        cv2.rectangle(im, (x1, y1), (x2, y2), col, 2 if st in ('target', 'candidate') else 1)
        tag = {'target': 'TARGET', 'candidate': 'candidate', 'class': 'ignored: class', 'small': 'ignored: too small', 'outside': 'ignored: outside zones', 'lowconf': 'ignored: low conf', 'static': 'ignored: static'}[st]
        cv2.putText(im, f"{d['name']} {d['conf']:.2f} {tag}", (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, col, 1)
    if target:
        fx, fy = target['foot']; cv2.circle(im, (int(fx * w), int(fy * h)), 5, COLORS['target'], -1)
        cv2.putText(im, f"{target['zone']}  gaze {gaze[0]:+.2f},{gaze[1]:+.2f}", (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, COLORS['target'], 1)
    mv = STATE.get('motion'); mtxt = '' if mv is None else f"  motion {mv * 100:.2f}%{' MOVING' if STATE.get('moving') else ''}"
    cv2.putText(im, f"tracker (YOLO, ours) {STATE['fps']} fps {STATE['infer_ms']} ms{mtxt}  yellow=target green=candidate gray/blue=ignored", (8, h - 24), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
    return im

motion = Motion()
n_seen = 0; last_seen = 0; prev = None; gaze = [0.0, 0.0]; last_send = 0; last_sent_gaze = None
conf_ema = 0.0; last_sent_mood = None
t_fps = time.time(); n_fps = 0
replay_stats = collections.Counter()
while True:
    cfg.reload()
    fr, n = stream.latest(n_seen)
    if getattr(stream, 'done', False): break
    if fr is None or n == n_seen: continue
    n_seen = n; now = stream.now()
    if motion(fr, cfg):                                          # any movement: stir the eyes (dark -> slits) before YOLO has an opinion
        mc = cfg.d['motion']
        if now - motion.last_sent >= 1 / mc.get('rate_hz', 2):
            relay.send({'cmd': 'motion', 'src': 'tracker', 'area': round(motion.area, 4)}); motion.last_sent = now
        if now - motion.last_log >= 10: log(f'motion {motion.area:.2%} of zone area'); motion.last_log = now
    t0 = time.time(); dets = det(fr, cfg.model_conf, cfg.d['iou']); infer_ms = (time.time() - t0) * 1000
    h, w = fr.shape[:2]; g = cfg.d['gaze']
    # candidates: wanted class, tall enough, foot point inside a zone and not ignored
    cands = []
    for d in dets:
        d['status'] = 'class'
        if d['name'] not in cfg.d['classes']: continue
        x1, y1, x2, y2 = d['box']; d['status'] = 'small'
        if (y2 - y1) / h < cfg.d['min_height']: continue
        foot = ((x1 + x2) / 2 / w, y2 / h); zone = cfg.zone_of(foot); d['status'] = 'outside'
        if not zone: continue
        zconf = cfg.zone_conf.get(zone, cfg.d['conf'])
        static = statics.check(foot, d['conf'], zconf, now, cfg.d)   # learn from every in-zone sighting, even the weak ones
        near_prev = prev is not None and math.dist(foot, prev['foot']) < cfg.d['sticky_radius']
        d['status'] = 'lowconf'                                  # partial bodies (waist-down on the street) score low
        if d['conf'] < zconf and not (near_prev and d['conf'] >= cfg.d['track_conf']): continue
        d['status'] = 'static'                                   # sat still for static_after s without ever scoring well: a bin, not a visitor
        if static: continue
        d['status'] = 'candidate'
        score = (y2 - y1) / h                                   # closer (taller) wins
        if near_prev: score += 0.5
        cands.append({'det': d, 'foot': foot, 'zone': zone, 'score': score})
    target = max(cands, key=lambda c: c['score']) if cands else None
    if target: target['det']['status'] = 'target'
    if target:
        last_seen = now
        acquired = prev is None
        if acquired: log(f"acquired {target['det']['name']} in {target['zone']} foot=({target['foot'][0]:.2f},{target['foot'][1]:.2f})"); conf_ema = target['det']['conf']
        elif prev['zone'] != target['zone']: log(f"zone {prev['zone']} -> {target['zone']}")
        prev = target
        conf_ema += (target['det']['conf'] - conf_ema) * g.get('conf_smooth', 0.3)   # smoothed so the lids don't chatter frame to frame
        th = g.get('squint_below'); mood = None if th is None else ('squint' if conf_ema < th else 'normal')
        target['mood'] = mood
        fx, fy = target['foot']
        tx = max(-1, min(1, (fx * 2 - 1) * g['x_gain'] * (-1 if g['mirror'] else 1)))
        ty = g['y_range'][0] + fy * (g['y_range'][1] - g['y_range'][0])
        a = 1.0 if acquired else g['smooth']                     # first fix snaps straight to the visitor; smoothing only while following
        gaze = [gaze[0] + (tx - gaze[0]) * a, gaze[1] + (ty - gaze[1]) * a]
        moved = last_sent_gaze is None or math.dist(gaze, last_sent_gaze) > g['deadband'] or mood != last_sent_mood
        if now - last_send >= 1 / g['rate_hz'] and (moved or now - last_send >= g['keepalive']):
            m = {'cmd': 'look', 'x': round(gaze[0], 3), 'y': round(gaze[1], 3), 'hold': g['hold'], 'src': 'tracker', 'zone': target['zone'], 'conf': round(conf_ema, 2)}
            if mood: m['mood'] = mood                                # eyes squint on a shaky detection, open up on a confident one
            relay.send(m)
            last_send, last_sent_gaze, last_sent_mood = now, list(gaze), mood
    elif prev and now - last_seen > cfg.d['lost_after']:
        log(f"lost target (last zone {prev['zone']})"); prev = None; last_sent_gaze = None; last_sent_mood = None
    tinfo = None if not target else {'zone': target['zone'], 'foot': [round(v, 3) for v in target['foot']], 'det': target['det'], 'conf': round(conf_ema, 2), 'mood': target.get('mood')}
    if recorder:
        recorder.frame(fr, now, {'dets': dets, 'target': tinfo, 'gaze': [round(v, 3) for v in gaze] if prev else None, 'motion': round(motion.area, 4)}, prev is not None,
                       {**DEFAULTS['record'], **cfg.d.get('record', {})})
    if ARGS.replay:
        was = stream.row.get('target'); replay_stats['frames'] += 1
        replay_stats['was target'] += bool(was); replay_stats['now target'] += bool(target)
        for d in dets:
            if d['name'] in cfg.d['classes']: replay_stats['person: ' + d['status']] += 1
        if ARGS.out: cv2.imwrite(os.path.join(ARGS.out, stream.row['file']), annotate(fr, dets, target, gaze))
    n_fps += 1
    if now - t_fps >= 5:
        STATE['fps'] = round(n_fps / (now - t_fps), 1); n_fps, t_fps = 0, now
    STATE.update(tracking=prev is not None, infer_ms=round(infer_ms, 1), frames=n, target=tinfo, statics=statics.summary(now),
                 motion=round(motion.area, 4), moving=motion.moving,
                 gaze=[round(v, 3) for v in gaze] if prev else None, detections=dets, recording=recorder.ev['name'] if recorder and recorder.ev else None)
    ok, jpg = cv2.imencode('.jpg', annotate(fr, dets, target, gaze), [cv2.IMWRITE_JPEG_QUALITY, 70])
    if ok:
        with ANNOT['lock']: ANNOT['jpg'] = jpg.tobytes()

if ARGS.replay:
    print('replay summary:', json.dumps(replay_stats, indent=1))
    print(f'relay messages that would have been sent: {relay.sent}')
