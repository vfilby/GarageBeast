# Casio XJ-F211WN — network control notes (2026-09-03)

Two units, one per garage door. **Key finding: the LAN port is for CONTROL, not video.**
Video goes over HDMI; each projector needs its own HDMI feed from the host
(dual-output host or two small players). The "network projection" feature technically
exists over wired LAN but requires Casio's C-Connection presentation software —
unsuitable for real-time animation — so treat it as nonexistent for this project.

## Control: PJLink Class 1, TCP port 4352 (confirmed for this model)
- Commands: power on/off, input select (HDMI = 31/32, Network = 44), AV mute (audio+video only), status/error queries.
- Auth on by default; password = web admin password (default `admin`).
- Python: `pypjlink`, or a small raw-socket script. One session per projector.

## Setup checklist (per projector)
1. Network Settings → **[Remote On] = Enable** (ships Disabled; reset by network-settings init).
2. **Static IP** for each unit (Casio warns against DHCP for control).
3. Note: after power-on the LAN link is dead ~1 min (even ping) — retry loops required.
4. INPUT → Network screen shows IP/MAC for initial discovery.

## Also available (not needed, but exists)
- Built-in web page "CASIO Projector Web Service" (default login `admin`); its remote can power OFF but not ON.
- Crestron RoomView (port 41794) and AMX Device Discovery.
- No raw RS-232-over-TCP — PJLink is the scripting protocol.

## Planned use
- Dusk: PJLink power-on both → select HDMI input → eyes page starts asleep.
- Show control: AV mute as a "blackout" between visitors if wanted.
- 11pm: power off both.

Sources: Casio Wired LAN Guide / Network Function Guide / User's Guide for XJ-UT352WN/XJ-F211WN/XJ-S400WN (casio.com support PDFs).

## Live findings, first unit on the LAN (2026-09-09)

- **Address:** DHCP from UniFi gave it `<dhcp-ip>`, hostname `casiolpjXXXX` (`casiolpjXXXX.<lan-domain>`),
  MAC `08:00:74:xx:xx:xx` (Casio OUI). Give both units a UniFi DHCP reservation (or static) before
  anything depends on the address; the doc above says Casio warns against plain DHCP.
- **PJLink works with the default password `admin`.** Greeting is `PJLINK 1 <nonce>` (auth on).
  Wrong password → `PJLINK ERRA` on the first command. Serial (INFO) `<serial>`, Class 1 only.
- **Inputs reported (INST):** 11 12 13 (RGB) · 21 (Video) · 31 32 (HDMI1/2) · 43 (USB) · 44 (Network) · 45.
  Unit was on HDMI1 (31), lamp 2199 h, ERST all zero.
- **Line endings are `\r` only.** Python `makefile().readline()` waits for `\n` and times out; read
  byte-wise until `\r`. `nc` looks fine because it prints whatever arrives.
- **Only the first command of a session carries the MD5 digest**; later commands in the same TCP
  session are sent bare. One session at a time; open a fresh one per action.
- **AV mute quirk:** `AVMT 31` answers `OK` but `AVMT ?` still reports `30` even 2 s later (twice).
  Unverified whether the picture actually blanked — check by eye next time. If it does blank, the
  status query is just wrong on this firmware; if not, "blackout" needs another route (e.g. black
  page on the host).
- **Web UI is Casio-branded AWiND/Barco firmware.** `https://<dhcp-ip>/` sets a `ClickShareSession`
  cookie and its TLS cert is issued by AWiND (Barco subsidiary) — looked like an IP conflict with a
  ClickShare at first. Page title is "CASIO Projector Web Service"; it's the projector. Port 80
  redirects to https; Crestron 41794 also open; no telnet.
- **Tool:** `projector/pjlink.py status|on|off|mute|unmute|input <code>|raw "<CMD arg>"`
  (`--host` repeatable, `PJ_HOSTS`/`PJ_PASSWORD` from the env or the stack `.env` next to compose.yaml,
  `--retry N` for the post-power-on dead minute). Passwords changed 2026-09-09; `.env` holds the Admin one.
- **Power-off test (2026-09-09 11:43):** `POWR 0` answered `OK` at once; the projector showed standby.
  Within 10 s the LAN went fully dark — no PJLink, no ping, ARP entry gone — and stayed dark 4+ min.
  `POWR 1` from the network therefore fails ("host is down"). This is the **[Remote On] = Disable**
  default: the network module is powered off in standby. Enable it in the projector's menu
  (Network Settings → Remote On) on both units, then re-test on/off and time the post-power-on
  dead minute. Until then only power-off, input and status work remotely.
- **From the Wired LAN Guide (v4.01), confirmed:** PJLink password = the Web Service *Setup page*
  password; auth can be turned off with [Network Settings]-[Network Settings]-[PJLINK Authentication].
  [Network Settings]-[Remote On] enables power-on from standby (default Disable) and is reset to
  Disable by "Initialize Network Settings". After power-on the wired LAN is down ~1 min (no ping).
  Casio recommends a fixed IP because DHCP may hand out a different address. Change the password
  on the Web Service page (https://<ip>/, login admin) under Setup; the script takes `PJ_PASSWORD`.
- **IoT VLAN plan:** the projectors will move to the IoT VLAN, so never hardcode `<dhcp-ip>`. Use a
  UniFi DHCP reservation plus DNS name (`PJ_HOSTS="casiolpjXXXX.<iot-domain> <second>"`) and allow the
  eyes host → IoT VLAN on TCP 4352 (and 443 for the web UI) in the UniFi firewall.
- **Wireless needs the YW-41 USB dongle.** Web UI showed Wireless LAN MAC `00:00:00:00:00:00` = no
  adapter detected. UniFi WPA2 PSK is AES/CCMP (no TKIP); the dongle is 2.4 GHz b/g/n, so use a
  2.4 GHz-capable SSID with WPA2 (not WPA3-only). `casiolpj` SSID in the UI is the projector's own AP mode.
- **Network (I/O) firmware:** unit has 0.02.27.0.28; latest 0.02.27.9.03 (2024-10-21) only adds
  C-Connection Chrome support, 0.02.27.0.29 "fixed minor bugs". USB-stick flash, irreversible, bricks
  networking if wrong. Skipped; revisit only if the AVMT status quirk matters. Update both units together.
- **Round-trip with Remote On enabled (2026-09-09, unit now on the IoT VLAN at <left-projector-ip>):**
  `POWR 0` → standby, and the LAN *stayed up*: `POWR ?` answered `0` every 10 s for 90 s.
  `POWR 1` → `OK`; the LAN then dropped (connection refused) for ~45 s and came back reporting `1`
  at +47 s. So: after `on`, retry `status`/`input` every 5 s for at least 90 s. Direct Power On
  (Option Settings) was tried and turned back off — it only reacts to AC power, not PJLink, and is a
  smart-plug fallback if ever wanted.
- **Web UI passwords (Network Function Guide):** Setup page → System Settings → Change Passwords.
  Admin default `admin` (= PJLink password, and the Setup login). Moderator default `moderator`
  (covers Moderator, Projector Remote and Template pages — C-Connection presentation stuff, unused here).
  "Content sharer" on the login page is a C-Connection role, no separate password in the guide.
  5–50 chars, letters/digits/symbols except backslash, double and single quote. Web UI is only up while the projector is on.
- **Both units wired (2026-09-10), DNS names as seen from the street:**
  `left-projector` = <left-projector-ip>, casiolpjXXXX, lamp 2200 h (password changed).
  `right-projector` = <right-projector-ip>, casiolpjXXXX, lamp 1912 h (password changed to match left 2026-09-10; one `PJ_PASSWORD` covers both). Remote On verified on both: network power-on from standby
  worked on each, LAN back after 46–47 s; power-off leaves the LAN answering. `.env` `PJ_HOSTS` lists both names.
- **Startup gap hidden (2026-09-10, both units):** Screen Settings → No Signal Screen = **Black** (was Blue),
  Input Settings → Signal Name Indicator = **Off** (kills the "HDMI1" popup), Auto Input Search = **Off**.
  Verified by eye: nothing visible between power-on and the HDMI picture except lamp warm-up. PJLink can't help
  here — the guide says blank only works once a valid signal is present. Keep the host outputting a signal
  (asleep eyes) before the projectors power on so HDMI locks immediately.
- **Per-unit menu checklist for a fresh/reset projector:** Remote On = Enable · Auto Power Off = Off ·
  No Signal Screen = Black · Signal Name Indicator = Off · Auto Input Search = Off · web Admin password set.

---

# Host hardware research (2026-09-03)

## Decision: dual-HDMI mini PC over Orange Pi 5 Plus

**Orange Pi 5 Plus (RK3588)**: workable but fiddly. Armbian is the only solid OS
(Joshua Riek's ubuntu-rockchip archived Apr 2026); dual HDMI fine on vendor kernel
(mainline needs ≥6.15); Chromium GPU accel is NOT out-of-the-box (libMali vs panthor/Mesa
choice, silent llvmpipe fallback, needs flags). Only advantages: ~5 W, size, GPIO.

**Picks:**
1. **Beelink EQ14** (N150, 16GB/500GB) ~$170–230 — dual native HDMI 2.0, internal PSU
   (no wall-wart to fail), 6 W TDP, best consumer-brand track record. → BUY THIS
2. ASUS NUC 13 Pro (i3-1315U) ~$300–450 — dual HDMI 2.1, 24/7-qualified, 3-yr warranty.
3. GMKtec NucBox G3 Plus (N150) ~$130–160 — budget same-formula.

Notes: N100/N150 drives 3× 4K@60 (two WXGA projectors ≈ 15% of that); Chromium accel
works stock on Ubuntu. NUC 14 Essential is HDMI+DP — doesn't qualify. Business tinies
(ThinkCentre/OptiPlex) need an optional flex-port card for the 2nd HDMI.
PIR sensors: use an ESP32 → WebSocket to the eyes, not host GPIO.

Sources: Intel ARK N100; Starry Hope + Neowin EQ14 reviews; ASUS NUC 13 Pro specs;
Armbian OPi5+ page; Collabora RK3588 upstreaming posts; Armbian forums (RK3588 accel).

## Projection mode (2026-09-09)

Both units run in **rear** projection mode. The leftmost door showed a mirrored eye (wrong slant, gaze
tracking backwards) after the eye-slinger Pi came up; the projector had reverted to front projection.
Setting it back to rear fixed both symptoms. Check this first whenever an eye looks or tracks wrong;
the Pi side (`projector/ansible`, `?eye=left|right&mirror=1` per output) needs no change for it.
