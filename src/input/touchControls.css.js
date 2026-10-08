/**
 * Stylesheet of the touch-controls overlay (#touch-controls). OWNER: Driving agent (docs/MOBILE.md §3.2).
 * Kept as a JS string so it ships with the module and is injected once (<style id="touch-controls-style">).
 * Look: chunky, glossy, ink-outlined cartoon buttons with a hard "ledge" shadow, matching the game's UI.
 *
 * Sizing is driven by viewport height (phones are landscape and short): --tc-d (drift), --tc-i (item), --tc-b
 * (brake / gas), --tc-l (look back). Mirrored for left-handed play through [data-hand="left"].
 */
export const TOUCH_CSS = `
#touch-controls {
  --tc-ink: #140a2e;
  --tc-d: clamp(84px, 27vh, 118px);
  --tc-i: clamp(66px, 20vh, 88px);
  --tc-b: clamp(64px, 17.5vh, 78px);
  --tc-l: clamp(54px, 13vh, 60px);
  --tc-e: max(env(safe-area-inset-right, 0px), 16px);
  --tc-eL: max(env(safe-area-inset-left, 0px), 16px);
  --tc-bot: max(env(safe-area-inset-bottom, 0px), 14px);
  --tc-font: 'Lilita One', 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif;
  position: fixed; inset: 0; z-index: 20; pointer-events: none;
  font-family: var(--tc-font);
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; touch-action: none;
  visibility: hidden;
}
#touch-controls[data-visible="1"], #touch-controls[data-catch="1"] { visibility: visible; }
#touch-controls * { box-sizing: border-box; -webkit-user-select: none; user-select: none; }

/* full-screen catcher; the strip at the top is left free for the HUD's pause button */
#touch-controls .tc-surface {
  position: absolute; left: 0; right: 0; bottom: 0; top: calc(env(safe-area-inset-top, 0px) + 60px);
  pointer-events: none; touch-action: none;
}
#touch-controls[data-visible="1"] .tc-surface, #touch-controls[data-catch="1"] .tc-surface { pointer-events: auto; }
#touch-controls .tc-group { opacity: 0; transition: opacity .18s ease-out; }
#touch-controls[data-visible="1"] .tc-group { opacity: 1; }

/* ---------------------------------------------------------------- buttons */
#touch-controls .tc-btn {
  position: absolute; border-radius: 50%; display: grid; place-items: center; align-content: center; gap: 0;
  --c1: #ffe36b; --c2: #ff9a1c; --glow: 255,170,40;
  background:
    radial-gradient(120% 70% at 50% -8%, rgba(255,255,255,.78) 0, rgba(255,255,255,.28) 38%, rgba(255,255,255,0) 52%),
    linear-gradient(180deg, var(--c1) 0%, var(--c2) 100%);
  border: 3px solid var(--tc-ink);
  box-shadow: 0 5px 0 var(--tc-ink), 0 9px 14px rgba(0,0,0,.35), inset 0 -7px 12px rgba(0,0,0,.24), inset 0 2px 3px rgba(255,255,255,.65);
  opacity: .82; color: #fff; text-align: center;
  transition: transform .07s ease-out, opacity .12s, box-shadow .07s, filter .12s;
  will-change: transform;
}
#touch-controls .tc-btn svg { width: calc(var(--s, 80px) * .42); height: calc(var(--s, 80px) * .42); flex: none; overflow: visible; filter: drop-shadow(0 2px 0 rgba(20,10,46,.55)); }
#touch-controls .tc-btn b {
  font-weight: 400; font-size: clamp(11px, 2.9vh, 14px); letter-spacing: .06em; line-height: 1; margin-top: -1%;
  color: #fff; -webkit-text-stroke: 3px var(--tc-ink); paint-order: stroke fill; text-shadow: 0 2px 0 rgba(20,10,46,.5);
}
#touch-controls .tc-btn.down {
  transform: translateY(4px) scale(.95); opacity: 1; filter: brightness(1.12) saturate(1.1);
  box-shadow: 0 1px 0 var(--tc-ink), 0 3px 6px rgba(0,0,0,.35), inset 0 -4px 8px rgba(0,0,0,.22), inset 0 2px 3px rgba(255,255,255,.65), 0 0 22px 4px rgba(var(--glow), .75);
}
#touch-controls .tc-drift { width: var(--tc-d); height: var(--tc-d); right: var(--tc-e); bottom: var(--tc-bot); }
#touch-controls .tc-drift { --s: var(--tc-d); }
#touch-controls .tc-item { --s: var(--tc-i); }
#touch-controls .tc-item svg { width: calc(var(--s) * .56); height: calc(var(--s) * .56); }
#touch-controls .tc-brake, #touch-controls .tc-gas { --s: var(--tc-b); }
#touch-controls .tc-look { --s: var(--tc-l); }
#touch-controls .tc-item { width: var(--tc-i); height: var(--tc-i); right: calc(var(--tc-e) + var(--tc-d) * .7); bottom: calc(var(--tc-bot) + var(--tc-d) + 6px);
  --c1: #c9a0ff; --c2: #7a3fe4; --glow: 170,110,255; }
#touch-controls .tc-brake { width: var(--tc-b); height: var(--tc-b); right: calc(var(--tc-e) + var(--tc-d) + 14px); bottom: calc(var(--tc-bot) + 4px);
  --c1: #ff8c8c; --c2: #d92b3a; --glow: 255,80,90; }
#touch-controls .tc-gas { width: var(--tc-b); height: var(--tc-b); right: calc(var(--tc-e) + var(--tc-d) + var(--tc-b) + 24px); bottom: calc(var(--tc-bot) + 4px);
  --c1: #8dff9e; --c2: #1fb84a; --glow: 80,255,120; display: none; }
#touch-controls[data-auto="0"] .tc-gas { display: grid; }
#touch-controls .tc-look { width: var(--tc-l); height: var(--tc-l); right: var(--tc-e); bottom: calc(var(--tc-bot) + var(--tc-d) + 14px);
  --c1: #8be9ff; --c2: #1c9fd6; --glow: 60,220,255; }
#touch-controls .tc-look svg { width: calc(var(--s) * .56); height: calc(var(--s) * .56); }
#touch-controls .tc-look b { display: none; }
/* invisible generous hit area is handled in JS (nearest-button hit test with a margin) */

/* item button: pulses while the kart holds an item */
#touch-controls .tc-item.has { opacity: 1; animation: tc-pulse .9s ease-in-out infinite; }
@keyframes tc-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.07); } }
#touch-controls .tc-item.has.down { animation: none; }
/* rocket-start window: the big button rings while pressing now gives the boost */
#touch-controls .tc-drift.rev { animation: tc-rev .32s ease-in-out infinite alternate; }
@keyframes tc-rev { from { box-shadow: 0 5px 0 var(--tc-ink), 0 0 0 4px rgba(255,255,255,.9), 0 0 24px 6px rgba(255,200,60,.9); } to { box-shadow: 0 5px 0 var(--tc-ink), 0 0 0 9px rgba(255,255,255,.35), 0 0 34px 12px rgba(255,120,30,.8); } }
#touch-controls .tc-drift .tc-lvl { position: absolute; inset: -7px; border-radius: 50%; border: 5px solid transparent; pointer-events: none; transition: border-color .12s; }
#touch-controls .tc-drift[data-lvl="1"] .tc-lvl { border-color: #35b6ff; }
#touch-controls .tc-drift[data-lvl="2"] .tc-lvl { border-color: #ff9a1c; }
#touch-controls .tc-drift[data-lvl="3"] .tc-lvl { border-color: #c15cff; }

/* ---------------------------------------------------------------- steering area */
#touch-controls .tc-steer { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
#touch-controls .tc-ring, #touch-controls .tc-knob {
  position: absolute; left: 0; top: 0; border-radius: 50%; will-change: transform;
}
#touch-controls .tc-ring {
  width: calc(var(--tc-r) * 2 + 34px); height: calc(var(--tc-r) * 2 + 34px); margin: calc(var(--tc-r) * -1 - 17px) 0 0 calc(var(--tc-r) * -1 - 17px);
  background: radial-gradient(closest-side, rgba(255,255,255,.04) 62%, rgba(255,255,255,.2) 100%);
  border: 3px solid rgba(255,255,255,.55); box-shadow: 0 0 0 3px rgba(20,10,46,.45), inset 0 0 14px rgba(255,255,255,.18);
  opacity: .35; transition: opacity .15s;
}
#touch-controls .tc-ring::before, #touch-controls .tc-ring::after {
  content: ''; position: absolute; top: 50%; width: 11px; height: 11px; margin-top: -6px;
  border: solid #fff; border-width: 0 0 4px 4px; opacity: .85; filter: drop-shadow(0 2px 0 rgba(20,10,46,.6));
}
#touch-controls .tc-ring::before { left: 13%; transform: rotate(45deg); }
#touch-controls .tc-ring::after { right: 13%; transform: rotate(-135deg); }
#touch-controls .tc-ring.on { opacity: .9; }
#touch-controls .tc-ring.on::before, #touch-controls .tc-ring.on::after { opacity: .5; }
#touch-controls .tc-knob {
  width: calc(var(--tc-r) * 1.15); height: calc(var(--tc-r) * 1.15); margin: calc(var(--tc-r) * -.575) 0 0 calc(var(--tc-r) * -.575);
  background: radial-gradient(120% 70% at 50% -8%, rgba(255,255,255,.95) 0, rgba(255,255,255,.35) 42%, rgba(255,255,255,0) 56%), linear-gradient(180deg, #ffe36b, #ff9a1c);
  border: 3px solid var(--tc-ink); box-shadow: 0 4px 0 var(--tc-ink), 0 8px 12px rgba(0,0,0,.35), inset 0 -6px 10px rgba(0,0,0,.22);
  opacity: .5; transition: opacity .12s;
}
#touch-controls .tc-knob.on { opacity: 1; }
#touch-controls[data-mode="buttons"] .tc-ring, #touch-controls[data-mode="buttons"] .tc-knob,
#touch-controls[data-mode="tilt"] .tc-ring, #touch-controls[data-mode="tilt"] .tc-knob { display: none; }

#touch-controls .tc-pads, #touch-controls .tc-tilt { position: absolute; display: none; }
#touch-controls[data-mode="buttons"] .tc-pads { display: flex; gap: 10px; }
#touch-controls[data-mode="tilt"] .tc-tilt { display: grid; }
#touch-controls .tc-pad { --c1: #8fd0ff; --c2: #2a74e6; --glow: 80,160,255; position: relative; width: clamp(80px, 24vh, 100px); height: clamp(90px, 28vh, 114px); border-radius: 28px; display: grid; place-items: center; }
#touch-controls .tc-pad svg { width: 38px; height: 38px; }
#touch-controls .tc-pad.down { transform: translateY(4px) scale(.96); }
#touch-controls .tc-tilt {
  width: clamp(104px, 31vh, 124px); height: clamp(104px, 31vh, 124px); place-items: center;
}
#touch-controls .tc-tilt .tc-wheel { width: 100%; height: 100%; will-change: transform; opacity: .85; filter: drop-shadow(0 4px 0 rgba(20,10,46,.7)); }
#touch-controls .tc-tilt .tc-cal { position: absolute; bottom: -12px; font-size: 11px; color: #fff; letter-spacing: .08em; -webkit-text-stroke: 3px var(--tc-ink); paint-order: stroke fill; opacity: .8; }

/* ---------------------------------------------------------------- left-handed mirror */
#touch-controls[data-hand="left"] .tc-drift { right: auto; left: var(--tc-eL); }
#touch-controls[data-hand="left"] .tc-item { right: auto; left: calc(var(--tc-eL) + var(--tc-d) * .7); }
#touch-controls[data-hand="left"] .tc-brake { right: auto; left: calc(var(--tc-eL) + var(--tc-d) + 14px); }
#touch-controls[data-hand="left"] .tc-gas { right: auto; left: calc(var(--tc-eL) + var(--tc-d) + var(--tc-b) + 24px); }
#touch-controls[data-hand="left"] .tc-look { right: auto; left: var(--tc-eL); }

@media (prefers-reduced-motion: reduce) {
  #touch-controls .tc-item.has, #touch-controls .tc-drift.rev { animation: none; }
}
`;
