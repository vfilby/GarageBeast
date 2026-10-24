# Halloween 2026

> **Public snapshot.** This is a scrubbed view of a private repo: network addresses, hostnames and other
> home-infrastructure details are replaced with `<placeholders>`, the rendered Christmas show clips
> (~70 MB) are left out (the Blender script and encoder that make them are included), and history is
> squashed to a single commit. Blog post: https://wellseasoned.dev/writing/garage-door-eyes/

## Garage door eyes

Two 9'×7' garage doors side by side, one projector per door, one eye per projector.

### Run (networked — control from any device on the LAN)
```
cd eyes && node server.js          # port 8000; prints the LAN URLs
```
- Projector host browser: `http://<host-ip>:8000/index.html?eye=right&mirror=1` (or `?eye=left` / `?eye=both` per output). `mirror=1` flips gaze x for the street view; leave it off for previews (see Build notes: the mirror).
- Controller from any phone/laptop: `http://<host-ip>:8000/control.html`

Pages served over http auto-connect to the server's WebSocket relay, which broadcasts
every control message to all connected pages — no setup beyond opening the URLs.
(`python3 -m http.server` still works for view-only; file:// works with the controller's
Open buttons via postMessage. `?ws=ws://host:port` overrides the relay address.)

**The server is the brain.** Separate eye windows (one per projector, or a phone previewing
alongside) stay in sync because `server.js` owns everything that is decided rather than
interpolated: the sleep/wake timer, idle saccades, blinks, slumber twitches, and the current
style/mood/auto state. It emits those as ordinary commands tagged `src:'brain'`; each page is a
*follower* that only runs the saccade engine, pursuit, micro-movements, pupil and rendering
locally. On connect a page receives `{cmd:'sync'}` with the current state, so a late-opened or
reconnected window matches the others immediately. Mouse and keyboard input on an eye window is
sent through the relay too, so nudging one window moves them all. If the relay drops, a page
falls back to its own idle behaviour until it reconnects (the debug HUD shows `follower` vs
`standalone`). Server env: `SLEEP_AFTER` (idle seconds before dozing, default 10) and
`COOLDOWN` (seconds sensors are ignored after a manual command, default 5); `GET /state` dumps
the brain state for debugging.

**Sound: wake and growl, snuffling and squinting, purring, sleeping.** One visit, as the brain scores it: one growl as the
eyes open on a person (`{cmd:'growl', file}`; a visit may start with one at most every `GROWL_EVERY` = 20 s, because someone
hovering at the edge of detection re-wakes the eyes every ~12 s and the neighbours hear every one). 4–6 s later the first soft
sound, always the **sniff** (`{cmd:'growl', soft:true, voice:'sniff'}`), and the brain squints the eyes for ~3 s while it sniffs
(`{cmd:'mood', name:'squint', src:'brain'}`, then back to whatever mood the controller last set). After that a soft sound every
`RUMBLE="6 10"` seconds, rotating between the synth purr, the breath samples and the odd sniff, never within 4 s of a growl,
until the eyes doze off. `BURST="n min max"` adds up to n more growls while an outside `look` holds the gaze (within 30 s of
waking); it defaults to 0 because back-to-back growls turned out to be a bit much. All timings, the master level and a
separate purr level are live on the control page (held by the brain, sent in `sync`); env sets the defaults.
Only pages
opened with `?sound=1` play anything, and only one page per audio output should have it: both kiosks on the Pi share
one default sink, and two growls a few ms apart through one speaker comb-filter each other.
- The **growl** is a recorded sample from the pool in `eyes/sounds/` (sources, cuts and licences: `eyes/SOUNDS.md`). `eyes/make-sounds.sh`
  is the recipe for the five cut from public sources (it re-downloads and re-cuts them). The brain
  reads the directory per growl (drop files in live), picks one at random, never the same twice running, and names it in
  `{cmd:'growl', file}` so every page and every controller's monitor plays the same one, at a slightly random rate. Pages
  preload the pool from `sync`. With an empty pool a page falls back to `?growl=<file>` / `growl.mp3`, then to the synth.
- The **sniff** is synthesised (a sniff *is* shaped noise, so unlike the growl the synth is honest): 2–4 rising inhales and
  sometimes a falling huff, kept low and rumbly to match the animal (band 300→520 Hz, 200 Hz snout resonance, nothing above
  1.4 kHz, the purr's ~28 Hz throat pulse fluttering every inhale), dry, and well under the growls.
- `eyes/sounds/fx-*` are on-demand effects: never picked by the brain, only played from their buttons on the control page
  (the monster growls: too much for a wake, fun to fire by hand).
- The other **soft sounds** rotate between `eyes/sounds/rumble-*` samples (single breaths of a sleeping dragon, played 10 dB down,
  slowed 5–14%, low-passed at 800 Hz and swelled in over ~1 s: a purr has no attack) and the synth purr.
- The **synth** lives in `eyes/growl.js`, WebAudio only (no asset): a 21–30 Hz jittered sawtooth pulse
  train, soft-clipped, through three moving formant band-passes plus pulse-gated breath noise, tilted up so a
  projector speaker (nothing below ~150 Hz) still carries it. It started life as the wake growl and was demoted:
  it rumbles convincingly, it does not sound like an animal.
- Control page: Growl (`G`) and Rumble (`R`) test buttons, a **now playing** line (name of every sound the brain sends, newest
  first; you cannot judge a pool you cannot name), both pools as buttons that play one named file on the eyes (audition), the timing boxes, a Sound mute toggle (`V`), level + purr-level sliders, and "hear growls
  on this device" (off by default, remembered per browser; the tick is also the user gesture Safari / iOS need before
  audio may start). Mute and level live in the brain (`SOUND=0` starts muted) and go out in `sync`.
- The kiosk Chromium already runs with `--autoplay-policy=no-user-gesture-required`; in any other browser click or
  press a key in the eye window once (debug HUD: `audio running|suspended`, `sample|synth`).

**Projector status pills.** With `PJ_HOSTS` set (`"left-projector right-projector"`, plus `PJ_PASSWORD`; both
in the stack `.env`, passed through by compose) the server polls each projector over PJLink every `PJ_POLL`
seconds (10) and the control page header shows one pill per unit: green `on` (HDMI1), amber `warming` /
`cooling` / `no answer Ns` (the LAN reboots ~47 s after power-on, so a missed poll is aged, not judged), red
for an error flag, a wrong input, or no answer for 90 s, grey `standby`. Hover for lamp hours and the last
error. `/state` carries the same under `projectors`. Read-only: nothing on the page can power the projectors,
and the relay is unauthenticated on the LAN, so keep it that way until the site sits behind SSO.

Press `f` on each eye window for fullscreen. The eye is drawn inside a 9:7 letterbox so it maps to the door; use the projector's keystone/zoom to align that box to the door.

Keys (same map as the control page): arrows look · shift+arrow far edge · space blink · w wake · s sleep · z toggle sleep/wake · q/e/n squint/wide/normal · a toggle auto · h toggle glow · m motion · c center · 1–9 / u / t / l style · 0 toggle eyes off (blank screen) · d debug HUD · f fullscreen.
URL params: `eye=left|right|both`, `debug=1`, `color=hex` (iris), `ws=ws://host:port`, `sleep=N` (idle seconds before sleeping), `awake=1`, `cooldown=N` (seconds after a manual command during which sensor commands are ignored, default 5), `mirror=1` (flip gaze x of incoming `look` commands: use on the projectors, not on previews), `sound=1` (this page plays the wake growl and the searching rumble; one page per audio output), `volume=0..1`, `growl=file` (wake sample, default `growl.mp3`). `sleep`, `awake` and `cooldown` only apply standalone; behind the relay the server's `SLEEP_AFTER`/`COOLDOWN` and its current awake state win.

### Styles
`?style=` (or the controller's Style buttons, or `{cmd:'style',name}`):
| name | look |
|---|---|
| `monster` (default) | ghostly green sclera, red iris, vertical slit |
| `dragon` | amber sclera, gold/fire iris, slit |
| `ghost` | pale blue-white, hollow fading pupil, neutral lids |
| `ghoul` | sickly yellow, pinprick round pupil, drooping lids |
| `demon` | black sclera, ember iris, red halo |
| `cat` | witch's cat — green iris, slit |
| `hypno` | hypnotizing — spinning magenta/cyan spiral iris, small round pupil |
| `sauron` | all-flame eye, tall black slit (never rounds), heavy flicker |
| `jack` | carved jack-o-lantern cutout — no iris; the candle hot spot follows the gaze, flickers. No lids: the outline never changes; blink and sleep move the candle away instead (dimmer, smaller flame) |
| `human` | plain human eyes — white sclera, grey-blue iris with a dark limbal ring, round pupil, a catchlight, light brow shadow, no glow pulse. Human lid model: the upper lid rests over the top of the iris, a squint raises the lower lid, a blink is almost all upper lid; pupil bounded to a human 28–55% of the iris. Real proportions, not a symmetric almond: the corners sit below the pupil, the upper lid is a tall arch and the lower lid a shallow curve, ~4° canthal tilt (inner corner lower than the outer), upper lid peaks a little toward the nose, lower lid bottoms out a little toward the outer corner |
| `tiku` | Tiku, the household black cat — no iris disc at all: the whole almond is the iris, a dome of pale yellow-green around the pupil going lime then orange-olive at the corners, with radial fibre texture; the black slit rides on the sphere; catchlight; black-fur lids tilted up at the outer corners |
| `hal` | HAL 9000's lens — a chrome bezel around black glass; inside, a red bloom that breathes and wanders, a diffuse crescent reflection orbiting slowly off the lens elements, etched concentric rings and a dotted dial that light up with the lamp, and a white-hot core with a horizontal anamorphic streak. Nothing turns or closes: the core and bloom slide a little toward the gaze (parallax through the glass) so it still tracks; blink / squint / sleep dim the lamp instead of closing anything (asleep = a dull standby ember with a pinprick core); the wake flare swells the core and pushes the bloom out to the rim. Bezel only, no faceplate — a plate would put a grey rectangle on the door |

**Other pages on the projectors.** The eyes control page only drives the eyes. The Christmas doors have their own
control page (`xmas-control.html`, see "Christmas control page" below), and that is where the projector windows get
steered to another page (`navigate`, `nav.js`) and back. When the projectors are anywhere but the eyes, this page's
header says so and offers **Back to eyes**. A window is `left` or `right` by its `?out=`, `?eye=` or `?door=`; `both`
windows (previews) ignore navigate unless they carry `?follow=1`, so a phone previewing the eyes is never yanked away.

Add a style: one line in `STYLES` in `eye.js` (sclera/halo/iris colours, pupil shape `slit|round|goat|triangle|hollow|none`, slant ±1/0, lid colour, optional `shadow`/`pulse`/`flicker`/`catchlight`, `irisK` iris size, `lidUpK`/`lidLoK` resting lid positions, `eyeUp` eyeball height above the corner line, `peakUp`/`peakLo` lid peak shifts toward the inner/outer corner, `pupilRange` [min,max] for round pupils, `lidModel:'human'`, `irisFx:'fill'` + `fibres` for a no-disc iris filling the opening), plus its key in `STYLE_KEYS` there and in the `STYLES` list in `control.html`. A look that isn't an almond at all gets a `shape` and its own drawer, dispatched at the top of `drawEye` before any lid geometry (`flame` → `drawFlame`, `carved` → `drawCarved`, `hal` → `drawHal`); the drawer gets the gaze direction, the lid value and the glow level and decides for itself what a blink or sleep means.

### Behaviour
- **Dark** by default behind the relay brain: the projectors show black. Any `motion` (the tracker's background-subtraction detector, a Protect vehicle/animal detection, the Motion! button) brings them up to **slits** (asleep: lids nearly shut, dim slow-breathing glow, rare twitch). A person (`look` from the tracker, a Protect person detection, `wake`) opens them: lids snap wide, pupil flares, and they track immediately. `SLEEP_AFTER` seconds (10) without a person they drop back to slits (**doze**: lids close at full brightness first, then the glow dims once shut); `OFF_AFTER` seconds (20) without any motion the slits fade to dark. The manual Eyes off (`blank`) is a separate hard black on top of all of this. Standalone (no relay) the page starts asleep, never dark; mouse movement or the `m`/`z` key wakes it and `?sleep=N` puts it back; `?awake=1` starts awake.
- Auto mode: random saccades (biased side-to-side, occasionally glances toward the other door), blinks every 2.5–7 s.
- External `look` commands override auto for `hold` seconds, then it resumes idling.

### Naturalness (see docs-eye-movement-research.md)
- Blink is forced on large gaze shifts; upper lid follows vertical gaze (lower lid less).
- Microsaccades (1–3 Hz, tiny, horizontal-biased) + slow drift while awake.
- Pupil: slow dilate (τ 1.2 s) / faster constrict (τ 0.4 s) + ±3% hippus wobble.
- "Head follow": the socket eases ~5% toward the gaze, lagging the iris.
- Convergence: Hering version/vergence — shared exact version, vergence scaled ×0.4 and low-passed (τ 200 ms).
- Saccade engine: fixate → jump (latency 120–200 ms, duration 25+2.4 ms/deg, smoothstep, 10% undershoot + correction); smooth pursuit for errors < ~3°.

### Control protocol (for motion sensors later)
JSON messages, delivered via `BroadcastChannel('garage-eyes')` (same browser) or a WebSocket (`?ws=`):
```
{cmd:'look', x:-1..1, y:-1..1, hold?:sec, mood?:name, quiet?:bool}   — a look may carry a mood (the tracker squints on
                           low confidence); quiet moves the gaze without waking (the brain's idle/slumber saccades)
{cmd:'motion'}  {cmd:'sleep'}  {cmd:'wake'}
{cmd:'blink', dur?:sec}   {cmd:'auto', on:bool}   {cmd:'mood', name:'wide'|'squint'|'normal'|'sleepy'}   {cmd:'lid', open:0..1}
{cmd:'halo', on:bool}   — soft glow around the eyes; default OFF: the background is pure black so the projected
                           rectangle is invisible on the door and only the eyes show. `?halo=1` turns it on at load.
{cmd:'blank', on:bool}  — eyes off: pages draw solid black. Everything else keeps running underneath (tracking, sleep/wake,
                           style, glow), so switching back on is seamless. The way to turn the show off from the phone.
{cmd:'growl', soft?:bool, file?:'sounds/x.mp3', voice?:'sniff'} — play the wake growl now on every `?sound=1` page (soft: the quiet searching rumble instead). The brain
                           sends it (src:'brain') as the eyes open on a person, rate-limited by GROWL_EVERY, and soft ones every
                           RUMBLE seconds while awake; from a controller it is the test button: the relay picks the file (or accepts a
                           named one that is in the pool) and sends the result to everyone, the sender included.
{cmd:'sound', on:bool, volume?:0..1, softVolume?:0..1, growlEvery?:s, burst?:[n,min,max], rumble?:[min,max]}   — mute, levels and timing, held by the brain
{cmd:'style', name}     {cmd:'sync', awake, auto, blank, sound, volume, softVolume, sounds:[files], rumbles:[files], effects:[files], growlEvery, burst, rumble, style?, lid?, halo?, projectors?}   — sync: server → page on connect
{cmd:'projectors', projectors:[{name, host, power, input, errors, lamp, age, error}]}   — server → pages after every PJLink poll
{cmd:'navigate', out:'left'|'right'|'all', url:'xmas.html?door={out}'}   — steer the projector windows to another page (eyes,
                           Christmas loops, video test). `url` is a template relative to the site, `{out}` = the window's
                           output; relative only (the relay is open on the LAN). The server remembers it per output and
                           puts `pages:{left,right}` in `sync`, so a window that reconnects (the Pi's nightly Chromium
                           restart lands on the kiosk URL) is steered straight back. Handled by `nav.js` on every page.
{cmd:'video', name}  {cmd:'event', name}   — Christmas: the rendered show show.html plays / an event dropped onto it (see
                           "Rendered shows"); the server stamps `t0` and carries `video` / `event` in `sync`.
{cmd:'xmas', loop?, cycle?:sec, loops?:[names]}   — Christmas: the canvas loop xmas.html draws. cycle > 0 = the server steps
                           through `loops` (sent by the control page; the server knows no themes) so both doors change
                           together; paused while a show runs. `sync` carries `xmas:{loop, cycle}`. The eye pages ignore all three.
```
Sensor services tag their messages with `src:'tracker'` / `src:'protect'` (plus `zone`); the relay drops tagged
commands for `COOLDOWN` seconds after any untagged (human) `look`/`motion`/`wake`/`sleep`, so the controller
always wins the gaze (pages apply the same gate themselves when running standalone). Style, mood, glow, eyes-off, blink and
auto changes are applied without interrupting tracking. The server's own messages carry `src:'brain'`. The
control page keeps the live eye preview (an iframe on the same relay), the drag pad and the tracker's
camera frame on one screen (laptop: buttons in a side column; phone: buttons below), with the last
look/motion received and the override countdown overlaid. The pad is the same size as the camera frame
(16:9) and collapses behind the ‹ tab on the left edge (remembered per browser; arrow keys still aim while it's hidden). Keyboard shortcuts (shown on the buttons):
`W` wake, `S` sleep, `M` motion, `Space` blink, `C` center, arrows nudge the aim, `Shift`+arrow = far edge,
`Q` squint, `E` wide, `N` normal, `A` / `Shift+A` auto on/off, `H` glow toggle, `G` growl now, `R` rumble now, `V` sound on/off, `0` eyes off/on (blank screen, everything else keeps running), `1`–`9`, `U` (human), `T` (Tiku) and `L` (HAL) style. The eye window uses the same map
(plus `Z` sleep/wake toggle, `D` debug, `F` fullscreen).

## Motion: driveway camera → eyes

Two services feed the relay (see `compose.yaml`; secrets in `.env`, template in `.env.example`):

**`tracker/`** — RTSP person tracker (Python, ffmpeg + YOLO-nano ONNX on CPU, ~¼ core).
Pulls the camera's low-res RTSP stream at 10 fps, detects people, picks one target (closest wins,
sticky to the previous target), maps its foot point to gaze and streams `{cmd:'look',x,y,hold}` at
≤10 Hz while someone is in a zone. The first `look` after acquisition snaps straight to the visitor;
`smooth` only applies while following. ffmpeg pulls with `-fflags nobuffer -flags low_delay` so the decoder
hands over frames as they arrive instead of buffering them. Alongside YOLO a background-subtraction motion
detector (`motion` in the config: MOG2 on the half-size grey frame, masked to the zones minus ignores) sends
`{cmd:'motion'}` at ≤`rate_hz` (2) while the moving fraction of the zone area is ≥ `min_area` (0.001); the
status page shows the live fraction as `motion` / `moving` for tuning. That is the eyes' dark → slits stage. The eyes wake on the first `look` and the relay's brain puts them
back to sleep `SLEEP_AFTER` seconds after the messages stop. `tracker/config.json` is hot-reloaded: zone polygons (normalized 0..1 frame
coords, foot point must be inside one; a zone may set its own `conf` — the street zone runs at 0.25 because the
camera only sees people waist-down there), `ignore` polygons, `classes` (person + bicycle, so kids on bikes count; NMS runs per class so the bike box
can't suppress the rider), `conf`, `track_conf` (accept down to
this near the previous target so a partial body keeps the lock), `lost_after`, and the `gaze` map
(`mirror`, `x_gain`, `y_range` = gaze y at frame top → bottom, `smooth`, `rate_hz`, `hold`, `squint_below` = the eyes
squint while the target's smoothed confidence (`conf_smooth`) is under this and open to normal above it, default 0.35;
`null` disables). Each `look` carries `conf` and `mood`, so a waist-down street sighting gets a suspicious squint and a
clear driveway sighting the full open stare.
Debug page with the annotated live frame, detections, gaze and recorded events: `https://eyes.example.com/tracker/`.

Static objects: a person-shaped detection that sits in one spot (`static_radius`) for `static_after` seconds while
its smoothed confidence stays under the zone's threshold plus `static_margin` (0.1; a bin hovers at the threshold, a
standing person scores well above) is a bin or a mailbox, not a visitor — it is tagged
`ignored: static` and suppressed until it stops being detected for `static_expire` s. Real people move or score well.
`static_after: null` disables it. `status.json` lists the remembered spots under `statics`.

Event recording (`record` block): every tracking event is saved to `events/<UTC time>/` — `preroll` seconds before
acquisition (ring buffer), every frame while tracking and `postroll` after, as JPEGs at `record.fps` with
`frames.jsonl` (detections, target, gaze per frame) and `event.json` (summary). ~40 KB per 640×360 frame, so a
10 s event at 5 fps is ~2 MB; oldest events are pruned past `max_mb`. Listed at `/tracker/events.json`, frames at
`/tracker/events/<name>/0000.jpg`. Replay one through the same pipeline with a config under test, no camera or
relay needed (`--out` writes annotated frames):
```
docker exec halloween-tracker python tracker.py --replay events/<name> --fast [--config /tmp/try.json] [--out /tmp/out]
```
It prints how many frames had a target when recorded vs. now, and the per-frame person statuses.
The Docker build exports the model itself (`--build-arg MODEL=yolo11n`).

**`protect-bridge/`** — UniFi Protect wake backup (Node 22, zero deps). Logs into the console with a
local account, follows `/proxy/protect/ws/updates`, and sends `{cmd:'motion'}` whenever the camera
reports a person/vehicle/animal smart detection (≈2.3 s after the person appears — measured). Protect
only reports zone enter/leave in real time (boxes arrive after the event ends), so it can't steer;
set `zone_look: true` in its config to send a coarse per-zone `look` if the tracker is down.

Measured 2026-09-03: Protect events on both its websockets arrive ~2.3 s after event start; the RTSP
tracker sees the person on the next decoded frame (~0.1–0.3 s).

## Christmas control page (`xmas-control.html`) — control v. display, separate from the eyes

Christmas ships in the same site as the eyes but as its own pair of pages, so it can be worked on in prod without
touching them: **`xmas-control.html`** is the control page (as `control.html` is for the eyes), and the display pages
are **`show.html`** (rendered shows: video background + alpha events) and **`xmas.html`** (live canvas loops), each
`?door=left|right` on a projector, `?door=both` to preview.

- A *scene* is a show or a canvas loop. Picking one sends `{cmd:'video'}` / `{cmd:'xmas'}`; the server keeps it (and
  hands it out in `sync`), the eye pages ignore it. So choosing scenes only changes the control page's preview (and
  any display window opened by hand, e.g. from "Display windows", which carry `&out=preview` so they are never steered).
- **On the projectors: Eyes / Christmas** is the go-live switch: `navigate` steers the kiosk windows to the scene's
  display page, or back to `index.html`. While Christmas is live, picking a scene of the other kind re-steers them
  (show ⇄ canvas). The server remembers it, so the Pi's nightly Chromium restart lands back on the chosen page.
- Events (▶) drop an event of the running show in now; **Cycle** steps through the canvas loops on the server's clock,
  so both doors change together. Keys: `1–9`/`0` loop, `C` cycle, `E` random event.
- The only eyes-side changes: `index.html` loads `nav.js` (inert until a `navigate` arrives) so a kiosk window that
  boots on the eyes can be steered, and `control.html` shows a "not showing the eyes · Back to eyes" notice.

Deploying it is the usual copy of `eyes/` to the stack's `site/` on the docker host plus a container restart (new `server.js`);
`eyes/video/shows/` is ~70 MB of clips.

## Christmas loops (the projectors as a general decoration aid)

`eyes/xmas.html` is a separate, self-contained page: ten seasonal canvas loops, no eyes. It is served by the
same static server (`https://eyes.example.com/xmas.html`, or `http://<host>:8000/xmas.html`) and never sends on the
relay, so it cannot disturb the live eye pages; it only listens (`nav.js`) for the Christmas control page's loop
choice and for `navigate` (`?solo=1` ignores the loop choice, for working on one theme; steered windows use `?hud=0`
and hold black until `sync` names the loop). Black background throughout, for the same reason as the eyes:
the projected rectangle must vanish on the door.

**Two doors.** The page lays out the same two 9:7 door boxes as the eyes (`?eye=both`), post between them
included: `?door=left` / `?door=right` on the projectors, `?door=both` (default) to preview. Every theme is
composed for the pair. A theme that is a *field* (snow, lights, sky) is one scene across both doors, so the
post is just a strip of it nobody sees and a sleigh can fly from one door to the other. A theme built around
a *centred object* (tree, hearth, peppermint, a pane of frost) can't straddle the post, so it is instanced once
per door with its own randomness, and the pair is made to differ (the two trees and the two swirls turn
opposite ways, the two hearths flicker on their own).

| # | `?loop=` | doors | look |
|---|---|---|---|
| 1 | `snow` | one scene | snowfall in depth layers with gusting wind, about half soft balls and half tiny six-armed crystals that tumble as they fall; a drift piles up along the bottom of both doors and slowly melts back; a little snowman (~20% of the door height: top hat, red scarf whose tail lifts in the gusts, stick arms, coal face, carrot) stands in the bottom-left corner of the left door with the drift piling round his base |
| 2 | `flakes` | one scene | procedurally grown six-fold crystal snowflakes (stems, side branches, some with plates or a hex core), 4.5–10% of the door height, ~14 per door, glowing, turning as they drift; light snow behind |
| 3 | `lights` | one scene | three scalloped strands of coloured bulbs hung across both doors; the pattern rotates every 10 s: twinkle → chase → wave → steady |
| 4 | `tree` | one per door | a cone of 260 lamps on a spiral, slowly turning in 3-D (back lamps dimmer/smaller), a bright run chasing up the spiral, a pulsing gold star with rays, snow; the right tree turns the other way |
| 5 | `aurora` | one scene | three curtains of green→teal→violet rays across both doors over a twinkling starfield, rendered into a 320×120 buffer and scaled |
| 6 | `fire` | one per door | a hearth: cellular fire (each cell averages the cells below it and cools), logs, drifting embers, a warm floor glow; the two flicker independently |
| 7 | `candy` | one per door | a big peppermint: red spiral arms on white turning, gloss, six striped candy canes orbiting; the two spin opposite ways |
| 8 | `sleigh` | one scene | the full moon in the right door, stars and snow across both; every 14–19 s Santa's sleigh and three reindeer (Rudolph's nose lit, legs galloping) fly in from the left door, across the post, past the moon: black shapes with a thin gold edge, so a silhouette on the moon and an outline on the sky, trailing sparkle |
| 9 | `baubles` | one scene | glossy ornaments on strings, hung per door so none swings through the post, each with its own pendulum period, some striped or ringed, glitter in the air |
| 10 | `frost` | one per door | each door is a pane: ice ferns grow in from its edges (branching tips, 60° side shoots), hold, melt away, start again |

Keys: `1`–`9`, `0` pick a loop · `n`/`p` (or arrows, space) next/previous · `c` toggle auto-cycle (20 s) · `f` fullscreen · `h` show the
caption. URL: `?door=left|right|both`, `?loop=name`, `?cycle=N` (seconds per loop, auto-advance), `?hud=0` (never show the
caption). The caption appears for a few seconds on every switch and hides itself. Each loop is one object in `LOOPS`
(`title`, `init()`, `draw(t, dt)` into a pre-clipped `0..W × 0..H` on black); `span: true` makes it one scene across the
two-door width, otherwise it is instanced per visible door with `this.side` set. Adding an eleventh is one more entry.

### Video decode test (`video.html`) — can the Pi play pre-rendered loops?

The alternative to drawing loops in primitives is rendering them in Blender and playing video. The projector host is a
Raspberry Pi 5, which has no H.264 hardware decoder and whose Chromium does not use the HEVC one, so browser video is
software-decoded and the codec / frame-rate budget has to be measured, not assumed. `video.html` lays out the same two
9:7 door boxes and plays synthetic clips in them, reporting decoded fps, dropped frames and stalls per clip, plus what
`canPlayType` and `mediaCapabilities.decodingInfo` say about H.264 / HEVC / VP9 / AV1 (`+HW` = the browser calls that
codec power-efficient, i.e. hardware decoded).

- Make the clips once: `eyes/video/make-clips.sh` (needs ffmpeg with x264/x265/vpx/svt-av1; ~2 minutes; output in
  `eyes/video/clips/`, gitignored, ~260 MB). Per-door clips are 1152×896 (exactly 9:7, about the pixel count of the
  door box on a WXGA projector); `wide-*` is the two-door scene at 2352×896 for a window spanning both projectors.
  Content: `gradient` (slow dark gradients — the banding test), `grain` (the same plus temporal noise — the decode
  worst case and the banding fix), `motion` (ffmpeg testsrc2 — plain throughput).
- On the Pi: Christmas control page → Display windows → send the projectors to `video.html?door={out}&auto=1` (or open `video.html?door=left&auto=1` by hand) runs every clip for 8 s (`?per=N`), then shows a
  results table and POSTs it to the server, which logs it and appends it to `eyes/video/reports.jsonl`. `?clip=name`
  and `n`/`p` step through clips by hand; `?hud=0` to look at banding without the overlay; `a` starts the suite.
- Server: `.mp4`/`.webm` are served with HTTP range support (Chromium will not loop or seek without it) and
  `POST /report` accepts JSON from test pages.

**Result on eye-slinger (2026-09-12, Chromium 149 on Pi OS Trixie, both kiosks running the suite at the same time):**
every clip Chromium could open played at its target rate with zero dropped frames and no stalls on both outputs,
including the worst case, temporal grain at 1152×896 60 fps H.264, two windows at once, and the 2352×896 wide clip.
VP9 and AV1 at 30 fps too. Nothing is hardware decoded (`mediaCapabilities` reports none of them power-efficient) —
it is all on the four A76 cores, and it is enough. **HEVC does not play at all** (`canPlayType` no, MediaError 4).
So: render per-door at 1152×896, 30 or 60 fps as the content wants, H.264 High at a generous CRF (16–18) with a
little grain; no reason to reach for VP9/AV1, and never HEVC.

### Rendered shows (`show.html`) — a winter night with events, phase-locked across the doors

A loop on its own gets boring by the third pass. A show is a persistent *background* (the winter night: moon, stars,
snow, a treeline — a 20 s loop nobody notices repeating) with *events* dropped onto it every so often: Santa flies
through, a snowman comes out and shivers, kids have a snowball fight. Consistent scene, unique moments.

`show.html?door=left|right` plays a show from `video/shows.json` in the door boxes. The projectors are two separate
Chromium windows, so anything crossing the post needs both files at the same point: the Christmas control page's show button
sends `{cmd:'video', name}` (and `navigate` to `show.html` when Christmas is on the projectors); the server stamps `t0` (its clock) as the background loop
start and keeps it in `sync`, and each window holds its element at `(serverNow − t0) mod duration` — a hard seek when
far off (load, stall), a ≤4 % playbackRate nudge otherwise, so nothing visibly jumps (measured: the two windows within
1 ms). Events are `{cmd:'event', name, t0}`: the server plays a random one every `every` seconds (never the same twice
running), or the control page's ▶ buttons fire one now; the page keeps every event preloaded as a hidden `<video>`
per door and seeks it to `now − t0` when shown, so a window that reconnects mid-event lands on the right frame
(`sync` carries the running event). `?show=name` previews a show standalone (`e` fires a random event); `h` shows the
phase error. `{cmd:'video', name:null}` goes black.

**Files.** A show is a directory under `video/shows/<show>/` and an entry in `shows.json`: `background` (`<name>-left.mp4`
+ `<name>-right.mp4`, 1152×896 each, exactly the door, H.264 CRF 16 with light grain per the Pi benchmark) and
`events` (`<name>-left.webm` + `-right.webm`, **VP9 with an alpha channel** — the one transparent video Chromium plays,
and the Pi decodes it fine), plus `every: [min, max]` seconds between random events. A plain `left`/`right` entry
is a single looping clip (the first sleigh proof is kept that way). Chromium caches the manifest and the clips, so
bump `?v=N` on the paths and navigate the kiosks to a fresh URL when replacing files.

**Making them.** `video/blender/winter.py` builds the whole scene from bpy primitives and renders headless in Eevee:
`--scene bg` is the background loop (600 frames, ~2 min), `--scene sleigh` the train alone on a transparent film
(460 frames, RGBA, ~12 min with the outlines); `--preview` renders two frames to look at; `-y` allows the driver
expressions. `encode.sh bg DIR winter night` / `encode.sh event DIR winter sleigh` crop the wide frames into the two
door files. The look is a classic animated Christmas special: cel shading (Shader-to-RGB into a three-tone ramp under a
cool moonlight key and a warm fill) with Freestyle ink outlines on the train; subdivided meshes so the silhouettes are
round at door size; a red sleigh with gold trim, runners and a lantern, Santa waving, the sack and gifts; three
reindeer with collars, bells, eyes and antlers on a keyed **transverse gallop** — real joint chains (hip, stifle, hock,
fetlock behind; shoulder, elbow, carpus, fetlock in front), footfalls in gallop order with the hinds leading, stance
then fold-and-swing with the hooves tucking and reaching, a body rise into the suspension phase, a head nod, each deer
a little behind the one ahead — the sleigh following through, a trail of spinning four-point sparkles, Rudolph's
nose lit; a cream cartoon moon with craters and a halo, four-point twinkle stars, light periodic snow, a snowy hill
with pines. Next events to build the same way: the snowman, the snowball fight.

### Build notes: the sync saga (fodder for the blog post / TikTok — prune later)

**The symptom.** With the eyes open in more than one browser window (the two projector windows, or a
laptop preview next to a phone), they did not agree with each other. Not subtly. Catalogue of effects,
all real, all observed 2026-09-07:

- **Lizard blink.** One eye blinks, the other stays open, then the other blinks half a second later. A
  nictitating-membrane, reptile-in-a-human-suit look. Each window drew its own blink time from its own
  random number generator, so the odds of two windows blinking together were roughly zero.
- **Cross-eyed monster.** Left and right idle independently, each picking its own random target. Worse,
  the "glance at the other door" branch was hard-coded per side: the left window glances +0.9 (right),
  the right window glances −0.9 (left), so when both fire the eyes literally cross. Very funny, not scary.
- **Half asleep.** Each window ran its own "doze after N seconds without motion" timer from its own clock.
  A command landing a few milliseconds on either side of a timer boundary sent the two windows down
  different branches: one eye closed while the other stared at you. Then one woke up first. Then the pupil
  flare on wake happened at different times.
- **The haunted cursor.** Moving the mouse across one window made *that* eye track the pointer and hold
  it for ten seconds while the other kept idling. On the projector host a nudged mouse produced a single
  eye swivelling to stare into a corner.
- **Late joiner amnesia.** Opening a new window (or a window reconnecting after a Wi-Fi blip) started
  asleep, in the default `monster` style, no matter what the others were doing. Style changes sent while
  it was disconnected were gone forever.
- **Out-of-breath sleeper** (found *after* the brain fix, so it earns its own entry). Asleep, the lids
  are not a fixed slit: they "breathe", a slow ~8 s sine between about 5% and 13% open. That sine ran
  on each page's own clock, which starts at zero when the page loads, so two windows opened a few seconds
  apart breathed out of phase — one slit widening while the other narrowed. Subtle, and exactly the kind
  of subtle that makes two eyes read as two creatures. Same root cause hit the slow glow pulse, the
  candle flicker on the sauron/jack styles and the hypno spiral's rotation.

**Why.** The relay server was a dumb fan-out: any WebSocket frame from any client was forwarded verbatim
to every other client, nothing more. Commands from the controller/tracker were only *nudges*; everything
else — idle saccades, blink schedule, microsaccades, drift, pupil jitter, the sleep timer — was decided
independently in each window with unseeded `Math.random()` on a local `performance.now()` clock. Identical
inputs, different outputs. Two windows were two separate creatures that happened to receive the same mail.

**Options considered.**
1. *One window, `?eye=both`, spanning both projectors as one extended desktop.* One state object drives
   both eyes, sync is exact by construction. Rejected only because the projectors are driven as separate
   windows and we want a phone preview too.
2. *Controller as leader.* The control page decides idle behaviour and broadcasts it. Rejected: the
   controller is a phone tab that is open only while someone pokes at it; browsers throttle background tabs
   to one timer tick per second or pause them entirely, so the eyes would freeze or stutter whenever the
   phone went to sleep. You end up building leader election just to survive a tab closing.
3. *Seeded RNG + server clock.* Give every window the same seed and the same time base so they compute the
   same random sequence. Rejected: the simulation consumes random draws in a frame-rate-dependent order
   (drift noise every frame, pupil hippus on its own timer), so it would need a fixed-timestep rewrite to be
   deterministic. Too much surgery.
4. *Server as brain.* ✅ The relay already sits in the middle of every message, has one clock, never goes
   to a background tab, and the sensors already talk to it. Move the *decisions* there; leave the
   *interpolation* in the browser.

**What we built (2026-09-07).** `server.js` grew a ~60-line behaviour loop (20 Hz) that owns: the
asleep/waking/awake state machine and the idle timeout, idle saccade targets, blink timing (and duration),
slumber twitches while asleep, and the remembered style / mood / glow / auto flags. It emits these as the
same JSON commands the pages already understood, tagged `src:'brain'`. Every page is now a *follower*:
while its socket is up it turns off its own sleep timer, idle saccades and blinks and just renders what it
is told, still running the saccade engine (latency, main sequence, undershoot), smooth pursuit,
microsaccades, drift and pupil dynamics locally — those are per-frame interpolation and are fine to run
in parallel; a few ms of delivery skew between windows is invisible. On connect the server sends
`{cmd:'sync'}` with the current state so a late window matches instantly; if the socket drops the page
falls back to its own idle behaviour until it reconnects (debug HUD shows `follower` vs `standalone`).
Local mouse/keyboard input on an eye window is sent through the relay too, so the haunted-cursor effect is
now "both eyes stare into the corner", which is at least intentional. Sensor cooldown gating (tracker and
Protect ignored for 5 s after a human sends look/motion/wake/sleep) moved server-side so it is decided
once. Chatter: about one idle look every 2 s and a blink every 5 s — a few hundred bytes a second, so no
seeding or shared clock needed after all.

Two small protocol additions made it work: `look` gained `quiet:true` (move the gaze without triggering
the wake sequence — the brain's idle saccades must not wake a sleeping eye) and `blink` gained `dur` (so
both windows close their lids for the same 220–320 ms). Brain messages are explicitly *not* manual
commands, otherwise every idle saccade would have restarted the sensor cooldown and the tracker would
never get a word in.

**Round two: the shared clock (2026-09-07, later the same evening).** The breathing bug above needed
the one thing we had said we could skip: a common time base. Cheap version: every brain message already
flows to every page, so the server stamps its own clock (`t`, seconds) on each one and on the `sync`.
A page computes `offset = t − local time` on arrival; network latency only ever makes that sample
*smaller*, so it keeps the largest sample seen (the least-delayed packet) and resets on `sync` in case the
server restarted. `shared() = local time + offset` then drives only the cosmetic cycles — lid breathing,
glow pulse, flicker, spiral — while timers and the saccade engine stay on the local clock so nothing
jumps when the offset updates. Two headless pages loaded 1.5 s apart agreed on the shared clock to
within 10 ms. Note this is *not* the rejected "seeded RNG + shared clock" option: no randomness is
shared, only a phase.

Testing without a browser: `eye.js` was run under Node's `vm` with a Proxy standing in for the canvas
context, driven by a fake `requestAnimationFrame`, against the real server on a spare port; a second
WebSocket client played controller. Three suites: relay behaviour (sync, identical events to all clients,
cooldown gating, late-joiner replay, idle sleep), the page as follower, and relay-drop fallback/resync.

**Deploy blooper (same day).** The first deploy overwrote the live control page with an older layout: the
one-screen control UI, keyboard shortcuts, glow toggle and jack-o-lantern tweaks lived on a `control-ux`
branch that had been deployed to the host but never merged to `main`, and the brain work was built on
`main`. Fixed by rebasing onto `control-ux` (which also brought in "only motion commands start the sensor
override" and looks that carry a mood, both of which the server now mirrors) and redeploying. Lesson: the
deployed site is the source of truth for what "current" means, not `main`.

### Build notes: the mirror (2026-09-08)

**The eye looked the wrong way from the street.** First projector up (right door, right eye). A person
walking toward the right door made the eye look left. Every tracking test until then had been watched
from the house, i.e. from the camera's side: the camera looks house→street, so "frame right" is the
street viewer's left. Not a tracker bug, a viewpoint mismatch. Fix: keep the tracker (its own `mirror`
stays false) and the control page in camera view, so the preview iframe, the aim pad and the annotated
tracker frame all agree, and flip gaze x only on the projector pages with `?mirror=1`. The control page
has two rows of Open buttons, Preview (camera view) and Project (mirrored), so the right URL is one click
either way. Manual aiming from the pad is in camera view too: drag toward the driveway's house-left and
the projected eyes look street-right, which is the same physical spot.

**Deploy footgun, same day.** The live site runs from the `server-brain` branch, not `main`. The first
deploy of this change was built from `main` and overwrote the served `eye.js`/`control.html` with
pre-brain versions (eyes stopped following the relay, control page lost its one-screen layout). Restored
from the stack repo's previous commit, then `server-brain` was merged into `main` so there is one branch.

### Build notes: first projector on the network (2026-09-09)

**The projector answered `nc` but not Python.** PJLink on the Casio XJ-F211WN (TCP 4352) greets with
`PJLINK 1 <nonce>` the instant you connect, and `nc` showed it. The first Python client hung on the
greeting every time: PJLink terminates lines with a bare `\r`, and `readline()` waits for a `\n` that
never comes. Read byte-by-byte until `\r`. After that, every query worked with the factory password
`admin`: name, model, power, input, lamp hours, error flags.

**The ClickShare that wasn't.** Poking the projector's web port returned a `ClickShareSession` cookie and a
TLS certificate issued by AWiND, Barco's wireless-presentation subsidiary. For a minute it looked like the
projector had grabbed an IP that belonged to some Barco box (and <dhcp-ip> did look like an address
that was meant for something else). The page title settled it: "CASIO Projector Web Service". Casio buys
its network module and firmware from AWiND, so the projector wears Barco's cookies. One device, one IP,
handed out by the UniFi DHCP. Lesson: reserve the projector addresses in UniFi before anything scripts
against them.

**AV mute says OK and then denies it.** `AVMT 31` (blank audio+video) returns `OK`, but `AVMT ?` keeps
reporting `30` (unmuted) even seconds later. Whether the picture actually blanked is unverified; the
tool is `projector/pjlink.py`, the notes are in `docs-projector-control.md`.

**Power off works. Power on can't.** `POWR 0` put the unit in standby immediately, and ten seconds later it
vanished from the network entirely: no ping, no ARP. Casio ships with Remote On disabled, which powers the
LAN module down in standby, so there is nothing listening for the wake-up. One menu setting on each
projector (Network Settings → Remote On) fixes it; until then the dusk schedule can turn the eyes off but
not on.

**Remote On, round two.** With Remote On enabled (and the unit moved to the IoT VLAN, <left-projector-ip>) the whole
loop works from a terminal: off puts it in standby with the LAN still answering, on brings it back with a
47-second gap where the network module reboots and refuses connections. That gap is the retry budget for the
dusk script. Along the way: Auto Power Off was quietly shutting the projector down whenever HDMI went idle,
and Direct Power On (turn on when AC arrives) is a handy smart-plug fallback but was left off for now.

### Build notes: the human eye (2026-09-09)

**Startled.** The first human style was the monster's geometry with white sclera and a blue iris, and it
looked terrified: the whole iris sat in the opening with white above and below it. That is what a wide-eyed
stare looks like; a relaxed human eye has the upper lid covering the top fifth of the iris and the lower lid
touching its bottom. The fix was geometry, not colour: iris 15% bigger than the monster's, upper lid resting
lower, lower lid a little higher. The same change made the squint stop looking like a lens pinching shut.

**Lids are not symmetric.** Every other style closes both lids toward the centre line, which is fine for a
monster and wrong for a person. A human squint is mostly the lower lid rising (the cheek pushes it up); a
blink is almost entirely the upper lid, and it travels past the centre line to meet the lower lid, so a shut
eye is a curved line *below* centre, not a slit through the middle. The lid value the brain sends is one
number (mood × blink), so the renderer now also keeps the two parts separately smoothed and the human lid
model gives each lid its own response: lower lid up 45% for a full squint but only 15% in a blink, upper lid
does the rest.

**Pupils have a range.** The wake flare dilates the pupil to 90% of the iris, which is the monster's whole
point and absurd on a person; the settled hunting stare is a pinprick. Human pupils run roughly 2–8 mm in a
12 mm iris, so the round pupil got a per-style `pupilRange` (28–55% of the iris radius) with the dilation
curve compressed into it. The flare still happens, it is just a big pupil instead of a black hole.

**Tilted, then angry.** With no canthal tilt the eyes looked skewed anyway, because the almond was a symmetric
lens: the upper lid as flat as the lower one. Adding the tilt (outer corner higher) and moving the upper lid's
peak toward the nose made it worse: an angry glare. The actual proportions of a human eye are the fix. The
corners sit *below* the pupil (about level with the lower third of the iris), so the upper lid is a tall arch
and the lower lid a shallow curve; the fissure is three times wider than it is tall; the iris is 40% of the
width. Once the eyeball centre was lifted above the corner line and the arches flipped, the same tilt and
peak shifts read as relaxed instead of hostile.

**Figure 8.** Shifting the upper lid's peak toward the nose and the lower lid's toward the temple means the two
curves no longer share a control point, so when the upper lid comes down to the lower lid's height they cross
twice: a closed eye drew as a little bow tie. The upper peak now slides across to meet the lower one as the eye
closes, so a shut eye is one line.

**The blink that wouldn't screenshot.** Headless Chrome with a virtual-time budget renders the eye fine, but a
test harness that called `eye.blink()` a few hundred milliseconds after load never showed a blink. The eye
blinks on its own at the first tick after waking, and a blink request while one is in progress is dropped,
so the harness kept losing the race. Nothing was wrong with the eye; the lesson is to instrument the harness
before debugging the thing under test.

### Build notes: latency (2026-09-10)

**The budget.** Motion to eye movement felt like 1–2 s. Walking the path: camera encode + Protect's RTSP
re-stream (a few hundred ms, not ours), ffmpeg's default demuxer buffering (a few hundred ms), one frame period
at 10 fps, inference (measured 12 ms, a non-issue), the gaze EMA (`smooth` 0.5 meant the first `look` landed
halfway between wherever the eyes were and the visitor, then drifted over three frames), the 8 Hz send gate
(up to 125 ms of waiting for nothing), and finally the eye's own deliberate 120–200 ms saccade latency plus
the jump itself. Fixed the three cheap ones: `-fflags nobuffer -flags low_delay` on the ffmpeg pull, snap
the gaze on acquisition, `rate_hz` 10 to match the frame rate (the deadband already suppresses repeats).

**The 32-byte probe.** First attempt also passed `-probesize 32 -analyzeduration 0` to skip ffmpeg's startup
analysis. On the live stream the first start died with `Output file does not contain any stream`: 32 bytes
is not enough for ffmpeg to identify the H.264 stream, so it opened the input with no streams and the raw
output had nothing to write. The tracker's 2 s auto-restart hid it, but every ffmpeg hiccup would have
gambled again. Those two flags only shorten the one-time startup, not per-frame latency, so they went.
Lesson: separate startup latency from steady-state latency before reaching for every low-latency flag
in the list.

### Build notes: HAL (2026-09-11)

**An eye that doesn't move.** Every style so far is an eyeball: lids, an iris on a sphere, a pupil that dilates.
HAL 9000 has none of that — a fixed lens, and what moves is the light inside it. So `hal` is a fourth `shape`
with its own drawer (like the flame and the carved pumpkin) and has to decide what the shared behaviour means
for it: a blink is a dip in the lamp, a squint dims it, sleep is a dull standby ember with a pinprick core that
never quite goes out, the wake flare swells the core and pushes the red bloom out to the rim. Tracking is
parallax: the hot core slides a fifth of a radius toward the gaze and the deeper bloom a third, so the lens
never turns but the light in it follows you. The reference gif gave the recipe: a chrome bezel lit from the
upper left, black glass with etched concentric rings and a dotted dial, a red bloom that breathes and wanders,
a crescent reflection off the lens elements, a white-hot core with a horizontal anamorphic streak and a few
flare ghosts strung along it. No faceplate, only the ring: the reference has a brushed steel plate with
"HAL 9000" on it, but a plate is a rectangle, and the whole point of the black background is that the
projected rectangle vanishes on the door.

**The barcode bezel.** First render: the chrome ring had horizontal stripes across its top and bottom. The
scan-line grain over the glass was drawn as full-width chords from `-R` to `+R`, and near the top and bottom
of a circle the chord is much shorter than the diameter, so the ends of every line poked out through the glass
onto the bezel. Clip to the glass before drawing anything that belongs to the glass.

**A target in the dark.** Asleep, the lamp dims to almost nothing and what was left was eight thin red circles
on black: an archery target, not a standby lens. The etched rings had been baked into the static offscreen
bezel at fixed alpha. Etched glass only shows where light hits it, so the rings moved into the live pass with
their alpha scaled by the lamp; asleep they all but vanish, awake the bloom lights them from the centre out.

**The smiley.** The crescent reflections were three round-capped arcs of falling alpha, a cheap blur. At full
brightness that read as a red grin under the core: hard edges, bulbous ends. The reference smear has no edge
and no ends. Now each crescent is eight segments of four widening strokes, alpha tapered by a half-sine along
the arc so it fades to nothing at both tips; first pass at that was invisible, second pass split the
difference. Sixty-four short strokes per crescent frame is still nothing next to the sauron's 270 streaks.

**Timid bloom.** The first bloom stopped at half a radius and the core was a pinhead; it looked like an LED in
a hubcap. The reference's glow reaches ~80% of the lens at the bright end of its breath. Bloom radius went to
0.7–1.0 R with the breath, plus a quarter radius during the wake flare, and the core doubled. Everything inside
the glass is drawn with `lighter` compositing so overlapping glows add up the way light does.

**The port that wouldn't die.** Testing the control page needs the relay running. Started it in the background
from the fish shell with bash's `$!` to remember the pid — fish calls it `$last_pid` — so the kill hit nothing,
the server stayed up, and the second run died with `EADDRINUSE` while the grep for the new button said zero.
Nothing to do with the eyes; `lsof -ti :port | xargs kill` and a `bash -c` wrapper.

### Build notes: Christmas loops (2026-09-11)

**Not eyes.** The projectors, the mini PC, the relay and the door alignment are a general-purpose "draw on the
garage" rig; the eyes are just the first thing drawn on it. First non-Halloween test: ten Christmas loops on a
page of their own (`xmas.html`) that shares the static server and nothing else — no WebSocket, no brain, so it
cannot regress the live eyes and doesn't need the sync machinery: each projector runs its own copy of the page
and the two halves of a scene only have to agree statistically (same snow, same wind, not the same flakes).

**Two doors, one post.** First cut drew each loop full-window. The rig is two 9:7 doors with a post between,
and half the loops are built around a centred object: a peppermint across both doors would be a peppermint
with a post through it. So the page took the eyes' two-box layout and each theme was split into two coherent
boxes, one of two ways. Fields (snow, crystals, lights, aurora, sleigh, baubles) are one scene as wide as both
doors plus the post, drawn once and clipped to the two boxes; the post is a strip of the scene nobody sees,
which is exactly what a real sky behind a real post looks like, and it lets the sleigh fly from the left door
to the moon on the right. Objects (tree, hearth, peppermint, frost) are instanced per door — the loop object is
`Object.create`d once per visible side with `this.side` set — and nudged apart so they read as a pair rather than a
copy: opposite spins, independent flicker, star pulses out of phase. Baubles are a field but hang per door, so
none swings through the post. The single-door pages (`?door=left|right`) render the same scene offset by a
door-and-a-post, so the projectors can't drift apart in layout, only in randomness.

**Screenshots that lied.** The loops were checked with headless Chrome's `--screenshot` and a virtual-time
budget: the fire came out as a single hot line over the logs and the frost as a few stubs at the edges, as if
nothing had run. Both are *frame*-budgeted simulations (heat rises one row per step; ferns grow a segment per
frame) and the virtual clock advanced seconds while `requestAnimationFrame` fired a handful of times, so the
snow (position = speed × time) looked fine and the frame-stepped loops looked broken. Fix for the test, not the
code: a 30-line DevTools-protocol harness that opens the page in a real headless tab, waits real seconds and
captures, with a `window.__xmasDebug()` hook reporting `t`, frame count and fps (60 throughout). Screenshot
every animation with real time, or you'll fix things that aren't broken.

**The stair-stepped aurora.** The curtains' lower edge came out as a hard, stepped line, one buffer row per
step, no matter how soft the fade under the edge was made. Two bugs stacked: the colour was multiplied by the
alpha *and* written to the alpha channel (ImageData is not premultiplied), so every fade was squared — steep
enough to read as an edge; and below the edge the colour ramp took `Math.pow(k, 0.7)` of a *negative* `k`,
which is `NaN`, which the `Uint8ClampedArray` stores as 0: black. So the soft fade below every curtain was
being drawn in pure black, on top of nothing, and the "edge" was simply the last row where `k ≥ 0`. Clamp `k`
first; accumulate alpha-weighted colour in a float buffer and normalise once.

**Peppermint with teeth.** First swirl was 36 concentric rings of 8 wedges, each ring rotated a little more
than the one inside it, which is a spiral if you squint and a saw blade if you don't: the wedge edges stepped
at every ring boundary. Replaced by four filled regions bounded by real spiral curves
(θ = base + twist·(r/R)²) sampled at 48 points each side plus the outer arc — smooth, antialiased, and cheaper.

**Leaning tower of flame.** The classic "doom fire" (copy the cell below with a random sideways shift, cool a
random amount) looked like horizontal streaks at 7× upscale. Averaging the three cells below plus the one two
rows down gave real flame tongues, but a per-row sideways sway pulled from noise made the whole column lean in
long sweeps like a fire in a wind tunnel; it now only nudges a row sideways when the noise is beyond ±0.75,
so the flames mostly go up and occasionally lick.

**The frost vignette.** The frost had a faint blue radial sheen "so the glass reads". On a monitor it did; on
the door it would be a blue-edged rectangle. Same lesson as the HAL faceplate and the halo default: nothing
that isn't the subject may be non-black.

**The dropped query string.** The harness opened `/json/new?http://…/xmas.html?loop=lights&box=1` and Chrome's
DevTools endpoint took the `&` as its own separator, so `box=1` never reached the page: the "door box" test
shot came back full-width with no "door box" in the caption. `encodeURIComponent` the whole target URL.

### Build notes: projector pills (2026-09-11)

**Two lines of Node replace a Python tool.** The control page now shows one pill per projector. The eyes container
is node:22-alpine with no Python, so `pjlink.py` could not simply be called; the same protocol fits in a 30-line
Node client inside `server.js` (net socket, md5 of nonce+password on the first command, read to `\r`). Verified
first from the container itself: it could already open PJLink sessions to both units by DNS name, so the UniFi
rule for the eyes host → IoT VLAN on 4352 was in place before any code existed.

**The space in the .env.** `PJ_HOSTS=left-projector right-projector` is fine for `pjlink.py` and for docker compose,
but `source .env` in a shell reads it as a command named `right-projector` and the local test server started with
"PJ_HOSTS unset, not polling". The host stack `.env` got the quoted form. Same lesson as the tracker's inode: the
file the tool reads is not always the file you think you edited.

**Banned by my own house.** Right after the deploy every `curl https://eyes.example.com/...` from the laptop returned
an empty 403, while the Pi got 200 and the container answered directly. CrowdSec had banned the laptop for four
hours (`http-generic-403-bf`): a Wyze stream viewer and Sonarr on the same machine happened to collect a dozen
403s in ten seconds. Lifting the ban lasted a minute, because the still-open apps kept retrying and re-tripping the
same scenario. Lesson: when a whole domain goes 403 with no body, check `cscli decisions list` before touching the
stack, and verify from a second host.

### Build notes: the growl (2026-09-19)
"Can we tie audio in, a low cat/dragon growl when they wake up?" Five things went wrong on the way to yes.

**The growl nobody could have heard.** First version: synthesise it (a growl is a 25–30 Hz glottal pulse train ringing a big
throat, so sawtooth -> soft clip -> three formant band-passes + pulse-gated breath noise). Rendered offline in headless Chrome
with an `OfflineAudioContext` and measured before anyone listened: **88% of the energy was below 100 Hz**, because a sawtooth
falls 6 dB/octave and the chest path piled on. A projector speaker reproduces nothing down there. Fix: a +13 dB high shelf in
front of the formants and a 70 Hz high-pass on the way out, so 200–800 Hz carries ~65% of it; the 27 Hz *spacing* of those
harmonics still reads as a low pitch (missing fundamental). The first fix overshot to a peak of 2.07 (hard clipping) until the
gain staging was redone; eight random renders now peak at 0.86–0.90.

**It measured right and sounded wrong.** Spectrogram: textbook pulse striations, moving formants. Verdict from the one person with
ears: "that does not sound like a growl, it might be good as a softer periodic noise while searching." A formant synth makes a
convincing rumble, not a convincing animal. So the synth was demoted to `{cmd:'growl', soft:true}` (−8 dB, 1.1 kHz top, slower
pulse, every 7–14 s while awake) and the wake growl became recorded samples. Measure to catch the inaudible; listen to judge.

**Silent in Safari, twice over.** The control page's preview iframe is an eye page *without* `?sound=1`, so it is silent by
design, and Safari keeps an `AudioContext` suspended until a trusted gesture inside that document. Fix: a "hear growls on this
device" checkbox on the control page whose click is the gesture (it answers with a growl so you know it took). Headless Chrome
reports `suspended` for a scripted `.click()` for the same reason: not a trusted gesture.

**One sink, two kiosks.** Both Chromium kiosks on the Pi play into the same default audio sink, a few ms apart: comb filtering.
Sound is therefore opt-in per page (`?sound=1` on the left kiosk only) and the *brain* picks the file, so pages never disagree.

**"I don't know what sounds are playing so I can't tell you."** Nine growls in a random pool and a request for feedback on them:
unanswerable until the control page named each one as it played (now playing + history, the pool button lights up). Same
session, the timing went from "a rumble every 7–14 s" to a score, in three drafts: growl + burst of growls on a target + purrs
while searching; then "too many back to back growls is a bit much"; then the keeper: wake and growl, snuffling and squinting,
purring, sleeping. The sniff was the one place the synth won (first render two thirds above 800 Hz = a human nose; retuned low
and rumbly with the purr's throat flutter: "sniff is great", then "a bit loud", −5 dB).

**"When the site reloads it plays all the sounds."** Not a page bug: the test scripts were pointed at the same preview server the
user was listening to, and one of them fires 40 growls in under a second. Tests moved to their own ports; and because a relay
will one day do this by itself, the player is now one voice at a time — every sound has its own bus and a new sound fades the
previous one out in ~80 ms (a soft sound never cuts a growl). 30 growls in 0.6 s now leave one bus connected.

**The limiter that did not limit.** Cutting the pool with `loudnorm` + `alimiter=limit=0.75`, four files still read 0.0 dB peak.
The WAV out of the same chain peaked at −2.6 dB: it was MP3 encode overshoot on dense, already-limited material. `limit=0.6`
and 192 kb/s put every file at −1.7…−2.4 dB. And the alligator's "mic noise" was findable without ears: an envelope of the band
above 2.5 kHz spikes at 7.6, 9.2, 19.0 and 20.7 s where the bellow itself has no energy, so the cuts take bellows 1, 3 and 4.

### Video / blog assets
`video/render.mjs` renders stills and short clips of the eye pages with headless Chrome driven by the real relay
(stills and MP4s land in `video/out/`, git-ignored; shots are one line each in the script's `SHOTS` table).
`video/PLAN.md` is the plan for the TikTok / Reels / YouTube cuts: shot list for the phone footage, scripts,
post copy, and the pre-publish checklist (GitHub move, blog post). The blog post draft lives in the
WellSeasonedDev site repo under `src/content/articles/2026/0912 - garage-door-eyes/`.

### Roadmap
- [ ] Tune tracker (first live test 2026-09-03: works, wakes the eyes, tracker saw the person ~4.5 s before
      Protect's event). Person on the street/sidewalk (~30 px tall at 640×360, foot y≈0.1) flickers in and out:
      acquired/lost every 1–5 s — cause: waist-down partial bodies. Mitigated with street-zone `conf` 0.2,
      `track_conf` 0.15, `lost_after` 3 (untested as of 2026-09-03); consider the Medium (1280×720) RTSP
      channel if far targets still drop. Then gaze map on the real doors: `x_gain`, `y_range`
      (left/right is solved by `?mirror=1` on the projector pages, see Build notes: the mirror).
- [ ] Projector schedule: `pjlink.py on` at dusk, then `input 31` with `--retry` (LAN is down ~47 s after
      power-on), `off` at 11pm; both units. Round-trip verified 2026-09-09 on <left-projector-ip>. UniFi DHCP
      reservations on the IoT VLAN for both, then use names in `PJ_HOSTS`.
- [ ] Zigbee PIR for spots the camera can't see (right under the doors).
- [x] Wake growl + searching rumble (2026-09-19, `eyes/growl.js`). Still open: source + licence of the four user-supplied cuts (`eyes/SOUNDS.md`), which output the Pi's default sink is (projector speaker over HDMI
      vs a powered speaker on the Pi), and a quieter stir rumble when the dark eyes come up to slits.
- [ ] Sound cues on blink / wide-eye.
- [ ] Choreographed sequences (both eyes slowly turn to a visitor, widen, blink).
