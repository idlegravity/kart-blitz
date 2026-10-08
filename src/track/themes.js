/**
 * Per-theme atmosphere: sky gradient, fog, sun, hemisphere fill, palette. OWNER: World agent.
 * Colors are hex strings. Sun azimuth/elevation in degrees (azimuth measured from +Z toward +X).
 */
export const THEMES = {
  meadow: {
    sky: {
      zenith: '#1f6fe0', mid: '#4d9dff', horizon: '#bfe4ff', ground: '#b7d9a0',
      sunColor: '#fff3d8', sunSize: 1.0, cloudColor: '#ffffff', cloudShade: '#a9c4e8', cloudCover: 0.52, cloudSpeed: 0.006,
      stars: 0, hazeStrength: 0.55,
    },
    fog: { color: '#c3e4ff', near: 170, far: 1700 },
    sun: { color: '#fff0d2', intensity: 3.4, azimuth: 35, elevation: 52 },
    hemi: { sky: '#bcdcff', ground: '#7a9c4a', intensity: 1.05 },
    envIntensity: 0.9,
    asphalt: { base: [66, 67, 71], speck: 1.0 },
    exposure: 1.0,
  },
  canyon: {
    sky: {
      zenith: '#2f6cc0', mid: '#f0a25c', horizon: '#ffd08c', ground: '#c98a55',
      sunColor: '#ffd9a0', sunSize: 1.6, cloudColor: '#ffe6c4', cloudShade: '#e39a56', cloudCover: 0.32, cloudSpeed: 0.004,
      stars: 0, hazeStrength: 0.8,
    },
    fog: { color: '#f2c18e', near: 140, far: 1500 },
    sun: { color: '#ffc78a', intensity: 3.6, azimuth: -55, elevation: 24 },
    hemi: { sky: '#ffd3a2', ground: '#b5613a', intensity: 1.0 },
    envIntensity: 1.0,
    asphalt: { base: [78, 68, 64], speck: 1.1 },
    exposure: 1.0,
  },
  glacier: {
    sky: {
      zenith: '#2f78dc', mid: '#7cb8f2', horizon: '#d2e8fb', ground: '#c9dcee',
      sunColor: '#f4fbff', sunSize: 1.0, cloudColor: '#ffffff', cloudShade: '#cfe0f4', cloudCover: 0.38, cloudSpeed: 0.005,
      stars: 0, hazeStrength: 0.7,
    },
    fog: { color: '#d2e8fb', near: 190, far: 1650 },
    sun: { color: '#f2f8ff', intensity: 3.0, azimuth: 140, elevation: 36 },
    hemi: { sky: '#c4e0ff', ground: '#8fa9c8', intensity: 0.95 },
    envIntensity: 0.85,
    asphalt: { base: [74, 80, 92], speck: 0.9 },
    exposure: 1.0,
  },
  neon: {
    sky: {
      zenith: '#04020f', mid: '#1c0a3d', horizon: '#6b1d8e', ground: '#12051f',
      sunColor: '#a8b8ff', sunSize: 1.4, cloudColor: '#ffffff', cloudShade: '#ffffff', cloudCover: 0,
      stars: 1, hazeStrength: 0.6, nebula: 1,
    },
    fog: { color: '#2a0d4a', near: 120, far: 1500 },
    sun: { color: '#8fa6ff', intensity: 1.5, azimuth: 200, elevation: 42 },
    hemi: { sky: '#9a5cff', ground: '#19d0ff', intensity: 1.2 },
    envIntensity: 1.4,
    asphalt: { base: [34, 36, 54], speck: 0.8, rough: 0.55, metal: 0.1 },
    exposure: 1.0,
  },
};

/** Sun direction (unit vector toward the sun) from azimuth/elevation degrees. */
export function sunVector(azimuthDeg, elevationDeg, out) {
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  return out.normalize();
}
