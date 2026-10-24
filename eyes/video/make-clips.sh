#!/usr/bin/env bash
# Synthetic test clips for video.html: does the projector host (a Raspberry Pi 5 running Chromium) decode
# door-sized video without dropping frames, which codecs does its browser accept at all, and how badly do
# dark gradients band at a given codec/bitrate on a black door?
#
# Per-door clips are 1152×896: exactly 9:7 (the door), both sides a multiple of 16, about the same pixel
# count as the 1029×800 door box on a WXGA projector. The "wide" clip is the two-door scene (2 doors + the
# 4% post) at 2352×896, for the case where one browser window spans both projectors.
#
# Every clip is 10 s and loops seamlessly (the sources are periodic or static+noise), so a video element with
# `loop` shows no seam. Content:
#   gradient  slow-moving dark gradients over black — the banding test (what a night sky or a snow drift looks like)
#   grain     the same gradient with temporal film grain — the decode-cost worst case, and the banding fix
#   motion    ffmpeg's testsrc2: bright, busy, full-frame motion — a plain decode-throughput test
#
# Usage: eyes/video/make-clips.sh            (writes eyes/video/clips/*.mp4|webm; skips clips that already exist)
#        FORCE=1 eyes/video/make-clips.sh    (re-encode everything)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p clips
DUR=10
W=1152; H=896; WW=2352

# A periodic dark gradient field. gradients= is a moving multi-stop gradient; with speed and duration matched so
# the pattern is back where it started at t=DUR the loop is seamless enough that the eye can't find the wrap.
grad() { # $1 fps  $2 width
  echo "gradients=s=${2}x${H}:c0=0x000000:c1=0x0a1030:c2=0x000000:c3=0x14102c:c4=0x000000:nb_colors=5:speed=0.02:type=linear:r=$1:d=$DUR"
}

enc() { # name  out  fps  width  filter  codec-args...
  local name=$1 out=$2 fps=$3 w=$4 filt=$5; shift 5
  if [[ -f "clips/$out" && -z "${FORCE:-}" ]]; then echo "keep   clips/$out"; return; fi
  echo "encode clips/$out"
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$filt" -t $DUR -r $fps -pix_fmt yuv420p -an "$@" "clips/$out"
}

# --- gradient: banding vs codec/quality (H.264 at two CRFs, HEVC, VP9, AV1) ---
enc gradient gradient-h264-crf23-30.mp4  30 $W "$(grad 30 $W)" -c:v libx264 -preset medium -crf 23 -g 60 -movflags +faststart
enc gradient gradient-h264-crf16-30.mp4  30 $W "$(grad 30 $W)" -c:v libx264 -preset medium -crf 16 -g 60 -movflags +faststart
enc gradient gradient-h264-crf16-60.mp4  60 $W "$(grad 60 $W)" -c:v libx264 -preset medium -crf 16 -g 120 -movflags +faststart
enc gradient gradient-hevc-crf20-30.mp4  30 $W "$(grad 30 $W)" -c:v libx265 -preset medium -crf 20 -g 60 -tag:v hvc1 -x265-params log-level=error -movflags +faststart
enc gradient gradient-vp9-crf28-30.webm  30 $W "$(grad 30 $W)" -c:v libvpx-vp9 -crf 28 -b:v 0 -row-mt 1 -g 60
enc gradient gradient-av1-crf28-30.mp4   30 $W "$(grad 30 $W)" -c:v libsvtav1 -crf 28 -preset 8 -g 60 -movflags +faststart

# --- grain: decode cost worst case (temporal noise), and the banding fix ---
GR="$(grad 30 $W),noise=alls=12:allf=t"
GR60="$(grad 60 $W),noise=alls=12:allf=t"
enc grain grain-h264-30.mp4  30 $W "$GR"   -c:v libx264 -preset medium -crf 20 -maxrate 10M -bufsize 20M -g 60 -movflags +faststart
enc grain grain-h264-60.mp4  60 $W "$GR60" -c:v libx264 -preset medium -crf 20 -maxrate 16M -bufsize 32M -g 120 -movflags +faststart
enc grain grain-vp9-30.webm  30 $W "$GR"   -c:v libvpx-vp9 -crf 30 -b:v 8M -row-mt 1 -g 60

# --- motion: plain throughput ---
enc motion motion-h264-30.mp4 30 $W "testsrc2=s=${W}x${H}:r=30:d=$DUR" -c:v libx264 -preset medium -crf 20 -g 60 -movflags +faststart
enc motion motion-h264-60.mp4 60 $W "testsrc2=s=${W}x${H}:r=60:d=$DUR" -c:v libx264 -preset medium -crf 20 -g 120 -movflags +faststart

# --- wide: one clip across both doors (2352×896), grain content (worst case) ---
enc wide wide-grain-h264-30.mp4 30 $WW "$(grad 30 $WW),noise=alls=12:allf=t" -c:v libx264 -preset medium -crf 20 -maxrate 16M -bufsize 32M -g 60 -movflags +faststart

ls -la clips
