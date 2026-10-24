# Eye-movement mechanics — research notes (2026-08-27)

## 1. Vergence geometry (per-eye look-at)
Compute each eye's rotation directly from that eye's position to the target, then split into
version (shared) + vergence (opposite halves) — Hering's law.
```
d = T - E_i ; yaw_i = atan2(d.x, d.z) ; pitch_i = atan2(d.y, hypot(d.x, d.z))
version  = (yaw_L + yaw_R)/2
vergence = yaw_L - yaw_R ≈ 2·atan(IPD / (2·D))
yaw_L = version + vergence/2 ; yaw_R = version - vergence/2
```
At our scale IPD = 9 ft: literal geometry gives 26° vergence for a target at 6 m → cross-eyed.
Keep version exact; scale vergence ×0.3–0.5 or clamp ≈ 8–10°. Vergence is slow (τ ≈ 200 ms,
latency ~180 ms) and separate from saccades — low-pass it.
Sources: https://pubmed.ncbi.nlm.nih.gov/7425080/ , http://www.opt.indiana.edu/v665/CD/CD_Version/CH19/CH19.HTM ,
https://pubmed.ncbi.nlm.nih.gov/1293528/

## 2. Saccades — main sequence (Bahill, Clark & Stark 1975)
- Duration D(ms) ≈ 25 + 2.4·A(deg)  → 5°: 37 ms, 10°: 49 ms, 20°: 73 ms
- Peak velocity ≈ 473·(1 − e^(−A/7.8)) °/s
- Bell/skewed velocity profile: smoothstep or 1−(1−t)^3
- Latency 150–250 ms after target moves; ~10% undershoot + corrective saccade ~120 ms later
- Smooth pursuit for target < ~30°/s (latency ~110 ms); otherwise catch-up saccade
Sources: https://www.sciencedirect.com/science/article/abs/pii/0025556475900759 ,
http://www.scholarpedia.org/article/Human_saccadic_eye_movements , https://tore-knabe.com/experiments-with-animation-for-eyes-and-head/

## 3. Micro-behaviour
- Microsaccades 0.3–1°, 1–3 Hz, 25 ms; drift as 1/f pink noise ±0.1°
- Blinks ~17/min; interval gamma mean 3.5 s, min 1 s; close 90 ms / hold 50 / open 180 ms
- Blink forced on saccades ≥ 20°
- Fixation dwell lognormal, median 250 ms scanning; 1–5 s idle. Saccades mostly ≤15°, horizontal-biased (Eyes Alive, Lee/Badler 2002)
- Head (socket/brow) follows gaze for shifts >20°, lagging 50–100 ms: v = 54.9 + 1.94·A °/s

## 4. Lids & pupil
- Upper lid follows vertical gaze ~0.9 gain, lower lid ~0.4
- Pupil: first-order low-pass, τ_constrict 0.4 s, τ_dilate 1.2 s, latency 200 ms, hippus ±3%

## 5. References worth borrowing
- Eyes Alive (Lee, Badler & Badler 2002) https://dl.acm.org/doi/10.1145/566654.566629
- Duchowski pink-noise eye synthesis https://people.computing.clemson.edu/~sjoerg/docs/Duchowski15_PinkNoise.pdf
- Tore Knabe, Realistic Eye Movements (Unity) — best engineered summary
- EyeSyn (Python) https://github.com/EyeSyn/EyeSynResource
