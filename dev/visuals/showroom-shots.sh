#!/bin/bash
# usage: dev/visuals/showroom-shots.sh "mode char track prefix" ...   (bash: word splitting)
cd "$(dirname "$0")/../.."
for spec in "$@"; do
  read -r mode char track tag <<< "$spec"
  node scripts/snap.mjs "/dev/visuals/showroom.html?mode=$mode&char=$char&track=$track&t=${T:-3.5}&freeze=1&mock=${MOCK:-1}" --out=snaps/visuals/sr_${tag}.png --wait=3500 --log=errors --size=${SIZE:-1280x720} > /tmp/srs_$tag.log 2>&1 &
done
wait
