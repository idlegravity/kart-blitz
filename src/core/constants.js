/**
 * Cross-cutting constants. OWNER: orchestrator.
 * Module-specific tuning (physics numbers, item timings, etc.) belongs in the owning module.
 */
export const GAME_TITLE = 'KART BLITZ';
export const MAX_KARTS = 8;
export const DEFAULT_LAPS = 3;

/** Seconds of camera flyover before the countdown. The camera 'intro' mode must fill exactly this. */
export const INTRO_DURATION = 4.0;
/** Seconds between countdown beats (3 → 2 → 1 → GO). GO happens 3 * COUNTDOWN_STEP after countdown starts. */
export const COUNTDOWN_STEP = 1.0;
/** After the player finishes, seconds to wait for AI to finish before forcing results. */
export const FINISH_TIMEOUT = 10.0;
/** After results are shown the race keeps simulating in the background (AI autopilots everyone). */

/**
 * Rocket start timing, in seconds BEFORE the GO beat. Physics implements it; AI uses it to time presses.
 * Throttle first pressed inside [windowStart, windowEnd] before GO and held → 'rocketstart' boost
 * (best near the middle of the window). Pressed earlier than stallIfBefore → burnout (KART_STALL).
 */
export const ROCKET_START = { windowStart: 1.1, windowEnd: 0.3, stallIfBefore: 1.6 };

/** Engine classes. speedMul scales kart top speed/accel; aiSkill is the base skill (0..1) for AI drivers. */
export const CC_CLASSES = {
  50: { id: 50, label: '50cc', speedMul: 0.8, aiSkill: 0.35 },
  100: { id: 100, label: '100cc', speedMul: 0.9, aiSkill: 0.6 },
  150: { id: 150, label: '150cc', speedMul: 1.0, aiSkill: 0.82 },
  200: { id: 200, label: '200cc', speedMul: 1.18, aiSkill: 0.95 },
};

/** Grand Prix points by finishing place (index 0 = 1st). */
export const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

/** Race modes. */
export const MODES = {
  gp: { id: 'gp', label: 'Grand Prix', items: true, ai: true },
  quick: { id: 'quick', label: 'Quick Race', items: true, ai: true },
  timetrial: { id: 'timetrial', label: 'Time Trial', items: false, ai: false },
};

/** Render quality presets. Systems read game.settings.quality and adapt. */
export const QUALITY = {
  low: { pixelRatio: 1.0, shadowMapSize: 1024, bloom: false, decorDensity: 0.4, particles: 0.5 },
  medium: { pixelRatio: 1.5, shadowMapSize: 2048, bloom: true, decorDensity: 0.7, particles: 0.8 },
  high: { pixelRatio: 2.0, shadowMapSize: 4096, bloom: true, decorDensity: 1.0, particles: 1.0 },
};

export const DEFAULT_SETTINGS = {
  cc: 150,
  quality: 'high',
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.85,
  showFps: false,
};
