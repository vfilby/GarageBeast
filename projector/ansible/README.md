# eye-slinger: projector host provisioning

Raspberry Pi 5 on the garage switch driving both Casio XJ-F211WN projectors, one eye each.
Everything on the box comes from `site.yml`; a dead SD card is "reimage, run playbook".

## Reimage (Raspberry Pi Imager)
Pi 5 → Raspberry Pi OS (64-bit, desktop) → Edit settings: hostname `eye-slinger`, user `vfilby`,
SSH on with the Mac's `~/.ssh/id_ed25519.pub`, Wi-Fi off. Boot on the wired port.

## Provision
```sh
./provision.sh            # first run reboots once for the kernel cmdline + tmpfs
./provision.sh --check    # dry run
```

## What it sets up
- **Displays pinned on**: `video=HDMI-A-1:1280x800@60D video=HDMI-A-2:...D` on the kernel cmdline.
  The `D` forces each connector "connected" at WXGA, so projector power cycles never trigger a
  hotplug and nothing moves between outputs.
- **Kiosk session** `/usr/local/bin/eye-slinger-session`: X11, no blanking/DPMS, hidden cursor,
  xrandr side-by-side, one Chromium `--kiosk` per output pointing at
  `https://eyes.example.com/index.html?eye=left|right&mirror=1`, relaunched 2 s after any exit.
  LightDM autologins into it and restarts it if it ever exits.
- **Nightly refresh** `eye-slinger-refresh.timer` (04:00) kills Chromium; the session relaunches it.
- **Logs in RAM**: journald volatile, `/var/log` on tmpfs, no swap file.
- **Unattended security updates**, never auto-reboots.
- **Unused desktop services off**: rpcbind + nfs-blkmap (port 111), cups, avahi, wayvnc-control. The kiosk is X11 +
  Chromium + ssh, so nothing answers on the LAN except ssh. (No `eye-slinger.local` any more: use `<pi-ip>`.)

Swap `eye=left`/`eye=right` in `site.yml` `outputs` if the projectors are on the other doors.
