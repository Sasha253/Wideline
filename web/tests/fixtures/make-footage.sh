#!/bin/sh
# Test footage for C06 (upload, probe, e2e), generated with ffmpeg's test
# pattern so no real match video sits in the repo. Run in the web container
# (`make fixtures`); existing files are kept. The .mp4 files are git-ignored.
#
#  footage-1080p.mp4     1920x1080, 25 fps, 5 min 30 s, about 20 MiB at a fixed
#                        500 kbit/s: three 8 MiB upload parts. Accepted.
#  footage-720p.mp4      1280x720, 25 fps, 5 min 30 s, small. Rejected (720p).
#  footage-portrait.mp4  1080x1920, 25 fps, 10 s. Rejected (portrait, short).
set -eu
cd "$(dirname "$0")"

make_clip() {
  out=$1 size=$2 seconds=$3 rate=$4
  if [ -s "$out" ]; then
    echo "kept $out"
    return
  fi
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=${size}:rate=25:duration=${seconds}" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
    -b:v "$rate" -minrate "$rate" -maxrate "$rate" -bufsize "$rate" \
    -x264-params nal-hrd=cbr:force-cfr=1 \
    -movflags +faststart "$out.tmp.mp4"
  mv "$out.tmp.mp4" "$out"
  echo "made $out ($(wc -c < "$out") bytes)"
}

make_clip footage-1080p.mp4 1920x1080 330 500k
make_clip footage-720p.mp4 1280x720 330 64k
make_clip footage-portrait.mp4 1080x1920 10 200k
