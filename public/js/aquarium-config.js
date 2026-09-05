export const PATTERNS = ['wavy', 'darter', 'circler', 'glider', 'zigzag'];

export const SPECIES_TRAITS = {
  fish1: { locomotion: 'swimmer', yMinF: 0.18, yMaxF: 0.70, speedMul: 1 },
  fish2: { locomotion: 'swimmer', yMinF: 0.20, yMaxF: 0.72, speedMul: 1 },
  fish3: { locomotion: 'swimmer', yMinF: 0.15, yMaxF: 0.65, speedMul: 1 },
  fish4: { locomotion: 'swimmer', yMinF: 0.18, yMaxF: 0.68, speedMul: 1 },
  fish5: { locomotion: 'swimmer', yMinF: 0.20, yMaxF: 0.72, speedMul: 1 },
  puffer1: { locomotion: 'swimmer', yMinF: 0.28, yMaxF: 0.75, speedMul: 0.75 },
  seahorse1: { locomotion: 'floater', yMinF: 0.25, yMaxF: 0.70, speedMul: 0.45 },
  eel1: { locomotion: 'slitherer', yMinF: 0.70, yMaxF: 0.90, speedMul: 0.70, ampMul: 2.6, freqMul: 0.85 },
  stingray1: { locomotion: 'glider', yMinF: 0.72, yMaxF: 0.90, speedMul: 0.70, ampMul: 0.30, flap: true },
  seaslug1: { locomotion: 'crawler', yMinF: 0.90, yMaxF: 0.97, speedMul: 0.20, ampMul: 0.25, freqMul: 0.45, glide: true },
  shark1: { locomotion: 'predator', yMinF: 0.35, yMaxF: 0.82, speedMul: 0.85, sizeMul: 1.75, intimidateRadius: 260 },
  seastar1: { locomotion: 'clinger', yMinF: 0.90, yMaxF: 0.97, speedMul: 0.08, ampMul: 0, sizeMul: 0.55 },
  shrimp1: { locomotion: 'walker', yMinF: 0.86, yMaxF: 0.96, speedMul: 0.35, ampMul: 0, freqMul: 2.6, sizeMul: 0.58, legs: true },
  octo1: { locomotion: 'jetter', yMinF: 0.40, yMaxF: 0.85, speedMul: 0.55, ampMul: 0, freqMul: 0.8, sizeMul: 0.95, jetPulse: true },
  squid1: { locomotion: 'jetter', yMinF: 0.22, yMaxF: 0.68, speedMul: 0.85, ampMul: 0, freqMul: 1.1, sizeMul: 0.90, jetPulse: true, burst: true },
};
export const DEFAULT_TRAITS = { locomotion: 'swimmer', yMinF: 0.15, yMaxF: 0.80, speedMul: 1 };

export const PERSONALITIES = {
  shy: { id: 'shy', encounterK: 0.55, glassK: 0.45, scareMul: 1.45, cohesionK: 1.30, idleBoost: 1.15 },
  bold: { id: 'bold', encounterK: 1.55, glassK: 1.80, scareMul: 0.65, cohesionK: 0.85, idleBoost: 0.80 },
  curious: { id: 'curious', encounterK: 1.35, glassK: 1.90, scareMul: 1, cohesionK: 1, idleBoost: 0.95 },
  lazy: { id: 'lazy', encounterK: 0.60, glassK: 0.60, scareMul: 1.15, cohesionK: 1.10, idleBoost: 1.80 },
  leader: { id: 'leader', encounterK: 1.10, glassK: 1, scareMul: 0.80, cohesionK: 0.70, idleBoost: 0.90 },
};
export const PERSONALITY_ORDER = ['shy', 'bold', 'curious', 'lazy', 'leader'];
export const DEFAULT_PERSONALITY = PERSONALITIES.curious;
export const TERRITORIAL_SPECIES = new Set(['shark1', 'eel1', 'octo1']);
export const TERRITORY_RADIUS = 220;

export const SPECIES_ARRIVALS = {
  fish1: { effect: 'glow', path: 'playful', splashBand: [0.24, 0.34], endYF: 0.53, sway: 0.65 },
  fish2: { effect: 'glow', path: 'graceful', splashBand: [0.22, 0.32], endYF: 0.5, sway: 0.45 },
  fish3: { effect: 'bubbles', path: 'playful', splashBand: [0.24, 0.34], endYF: 0.55, sway: 0.75 },
  fish4: { effect: 'ribbon', path: 'playful', splashBand: [0.22, 0.32], endYF: 0.52, sway: 0.58 },
  fish5: { effect: 'glow', path: 'playful', splashBand: [0.24, 0.34], endYF: 0.54, sway: 0.7 },
  puffer1: { effect: 'bubbles', path: 'playful', splashBand: [0.28, 0.38], endYF: 0.6, sway: 0.52, scaleMul: 1.04 },
  seahorse1: { effect: 'pearls', path: 'floaty', splashBand: [0.18, 0.28], endYF: 0.46, sway: 1.05, scaleMul: 0.94 },
  eel1: { effect: 'ribbon', path: 'slink', splashBand: [0.7, 0.8], endYF: 0.76, sway: 0.32, scaleMul: 0.96 },
  stingray1: { effect: 'sand', path: 'glide', splashBand: [0.72, 0.82], endYF: 0.74, sway: 0.2, scaleMul: 1.08 },
  seaslug1: { effect: 'silt', path: 'heavy', splashBand: [0.82, 0.9], endYF: 0.86, sway: 0.18, scaleMul: 0.9 },
  shark1: { effect: 'wake', path: 'heavy', splashBand: [0.34, 0.46], endYF: 0.48, sway: 0.12, scaleMul: 1.14, spotlight: 'predator' },
  seastar1: { effect: 'sand', path: 'heavy', splashBand: [0.86, 0.92], endYF: 0.92, sway: 0.1, scaleMul: 0.85 },
  shrimp1: { effect: 'silt', path: 'heavy', splashBand: [0.82, 0.9], endYF: 0.9, sway: 0.22, scaleMul: 0.85 },
  octo1: { effect: 'bubbles', path: 'floaty', splashBand: [0.42, 0.55], endYF: 0.6, sway: 0.55, scaleMul: 1 },
  squid1: { effect: 'ribbon', path: 'slink', splashBand: [0.28, 0.4], endYF: 0.46, sway: 0.5, scaleMul: 0.95 },
};
export const DEFAULT_ARRIVAL = { effect: 'glow', path: 'playful', splashBand: [0.24, 0.34], endYF: 0.54, sway: 0.55, scaleMul: 1 };
