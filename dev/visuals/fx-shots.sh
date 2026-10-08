#!/bin/bash
# usage: dev/visuals/fx-shots.sh "emit theme t tag" ...
cd "$(dirname "$0")/../.."
i=0
for spec in "$@"; do
  read -r emit theme t tag <<< "$spec"
  node scripts/snap.mjs "/dev/visuals/fx.html?emit=$emit&theme=$theme&t=$t&freeze=1&follow=1" --out=snaps/visuals/fxe_${tag}.png --wait=2200 --log=errors --size=${SIZE:-800x450} > /tmp/fxe_$tag.log 2>&1 &
  i=$((i+1)); if [ $((i % 4)) -eq 0 ]; then wait; fi
done
wait
