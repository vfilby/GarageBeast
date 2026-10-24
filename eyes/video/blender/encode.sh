#!/usr/bin/env bash
# Encode rendered wide frames (2352×896, see winter.py) into what show.html plays.
#
#   encode.sh bg    <frames-dir> <show> <name>   → eyes/video/shows/<show>/<name>-{left,right}.mp4 + <name>-wide.mp4 + contact
#   encode.sh event <frames-dir> <show> <name>   → eyes/video/shows/<show>/<name>-{left,right}.webm  (VP9 with alpha)
#
# Per the Pi 5 benchmark (README "Video decode test"): backgrounds are H.264 High CRF 16 with light grain (they loop
# forever, dark gradients band on the black door); events are VP9 in WebM with an alpha channel (the only transparent
# video Chromium plays; decoded fine on the Pi), layered over the background by show.html. Both are cropped from the
# wide render into the two 1152×896 door files.
set -euo pipefail
MODE=$1; FRAMES=$2; SHOW=$3; NAME=$4
cd "$(dirname "$0")/.."
OUT=shows/$SHOW; mkdir -p "$OUT"
FPS=30; DW=1152; GAP=48
CROP_L="crop=$DW:896:0:0"; CROP_R="crop=$DW:896:$((DW + GAP)):0"
case $MODE in
  bg)
    X264="-c:v libx264 -preset slow -crf 16 -profile:v high -pix_fmt yuv420p -g 60 -x264-params aq-mode=3 -movflags +faststart"
    GRAIN="noise=alls=3:allf=t+u"
    ffmpeg -hide_banner -loglevel error -y -framerate $FPS -i "$FRAMES/frame_%04d.png" -filter_complex \
      "[0]split=3[a][b][c];[a]$CROP_L,$GRAIN[l];[b]$CROP_R,$GRAIN[r];[c]$GRAIN[w]" \
      -map "[l]" $X264 "$OUT/$NAME-left.mp4" -map "[r]" $X264 "$OUT/$NAME-right.mp4" -map "[w]" $X264 "$OUT/$NAME-wide.mp4"
    ffmpeg -hide_banner -loglevel error -y -i "$OUT/$NAME-wide.mp4" -vf "select=not(mod(n\,50)),scale=588:-1,tile=4x3" -frames:v 1 "$OUT/$NAME-contact.png"
    ;;
  event)
    VP9="-c:v libvpx-vp9 -pix_fmt yuva420p -crf 22 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -auto-alt-ref 0 -g 30"
    ffmpeg -hide_banner -loglevel error -y -framerate $FPS -i "$FRAMES/frame_%04d.png" -filter_complex \
      "[0]format=rgba,split=2[a][b];[a]$CROP_L[l];[b]$CROP_R[r]" \
      -map "[l]" $VP9 "$OUT/$NAME-left.webm" -map "[r]" $VP9 "$OUT/$NAME-right.webm"
    ;;
  *) echo "mode must be bg or event"; exit 1 ;;
esac
ls -la "$OUT" | grep "$NAME"
