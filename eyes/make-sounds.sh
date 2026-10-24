#!/bin/bash
# Rebuild the publicly sourced wake growls in eyes/sounds/ from their original URLs: the recipe behind the committed files
# (sources and licences are in eyes/SOUNDS.md). Needs curl, ffmpeg and tar (bsdtar reads .7z).
#   eyes/make-sounds.sh [outdir]      default: eyes/sounds next to this script. Existing files are overwritten.
# Files cut from the owner's own downloads (fx-monster-*, rumble-breath-*) are not rebuilt here: see SOUNDS.md for their cuts.
set -euo pipefail
OUT=${1:-"$(cd "$(dirname "$0")" && pwd)/sounds"}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
UA="HalloweenEyes-make-sounds/1.0 (garage prop; curl)"   # Wikimedia refuses requests without a descriptive User-Agent
mkdir -p "$OUT"
get() { curl -fsSL --retry 3 --retry-delay 5 -A "$UA" -o "$TMP/$1" "$2"; }
# cut <name> <source> <start> <len> <fade-in> <extra filters, may be empty> <TP>
cut() {
  local fo; fo=$(awk -v l="$4" 'BEGIN { printf "%.3f", l - 0.45 }')
  ffmpeg -v error -y -ss "$3" -t "$4" -i "$TMP/$2" -ac 1 -ar 44100 \
    -af "${6:+$6,}afade=in:d=$5,afade=out:st=$fo:d=0.45,loudnorm=I=-14:TP=$7" -b:a 160k "$OUT/$1.mp3"
  echo "  $1.mp3"
}
echo "fetching sources..."
get gator.mp3 "https://www.nps.gov/nps-audiovideo/legacy/mp3/nri/avElement/nri-AlligatorEVER1.mp3"
get dog.ogg   "https://upload.wikimedia.org/wikipedia/commons/4/44/Dogs%27-Expectation-about-Signalers%27-Body-Size-by-Virtue-of-Their-Growls-pone.0015175.s007.ogg"
get beast.7z  "https://opengameart.org/sites/default/files/beast_or_animal.7z"
tar -xf "$TMP/beast.7z" -C "$TMP" "Beast or Animal/Growl.wav" && mv "$TMP/Beast or Animal/Growl.wav" "$TMP/beast.wav"
echo "cutting into $OUT"
# the alligator recording has handling noise on bellow 2 (7.6 s, 8.9–9.4 s) and at 19.0 / 20.7 s: bellows 1, 3 and 4 only
cut gator-1    gator.mp3  0.0   3.45 0.12 "lowpass=f=2600" -2
cut gator-2    gator.mp3 14.75  3.25 0.15 "lowpass=f=2600" -2
cut gator-3    gator.mp3 21.75  3.25 0.06 ""               -1.5
cut big-dog    dog.ogg    0     2.1  0.06 ""               -1.5
cut deep-beast beast.wav  0     2.75 0.06 ""               -2
