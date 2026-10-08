#!/bin/bash
# usage: dev/visuals/shots.sh <view> <anim> <prefix> [chars...]   -> snaps/visuals/<prefix>_<char>.png (parallel)
view=$1; anim=$2; prefix=$3; shift 3
chars=${@:-"blaze bolt mochi rex frost nova grizz pepper"}
cd "$(dirname "$0")/../.."
for c in $chars; do
  node scripts/snap.mjs "/dev/visuals/lineup.html?only=$c&view=$view&anim=$anim&freeze=1&t=${T:-1.2}" --out=snaps/visuals/${prefix}_$c.png --wait=${WAIT:-1800} --log=errors --size=${SIZE:-900x640} > /tmp/shot_$c.log 2>&1 &
done
wait
grep -h "PAGE ERROR\|Error" /tmp/shot_*.log | head -20
