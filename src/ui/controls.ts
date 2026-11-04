/** Keys shown in hints. Keep in step with src/input. */
export const CONTROLS: { keys: string; does: string }[] = [
  { keys: 'W A S D / Arrows', does: 'Steer and pitch' },
  { keys: 'Shift', does: 'Boost' },
  { keys: 'Tab / M', does: 'Destinations map' },
  { keys: 'Space', does: 'Read briefing at a beacon' },
  { keys: '1 to 5', does: 'Pick a destination' },
  { keys: 'Enter', does: 'Fly me there (autopilot)' },
  { keys: '← → / A D', does: 'Page through a briefing' },
  { keys: 'Esc', does: 'Close, or pause' },
];
export const CONTROLS_HINT = 'WASD / arrows steer · Shift boost · Tab destinations · Esc pause';
