/** Keys shown in hints. Keep in step with src/input. */
export const CONTROLS: { keys: string; does: string }[] = [
  { keys: 'W A S D / Arrows', does: 'Steer and pitch' },
  { keys: 'Shift', does: 'Boost' },
  { keys: 'Tab / M', does: 'Destinations map (M closes it again)' },
  { keys: 'Space', does: 'Read briefing at a beacon' },
  { keys: 'E', does: 'Land at a stop with a room, or use what you face inside' },
  { keys: '1 to 5', does: 'Pick a destination' },
  { keys: 'Enter', does: 'Fly me there (autopilot)' },
  { keys: '← → / A D', does: 'Page through a briefing' },
  { keys: 'H', does: 'Show the keys while flying' },
  { keys: 'N', does: 'Next stop, from a briefing' },
  { keys: 'Esc', does: 'Close, or pause' },
  { keys: 'Gamepad', does: 'Stick steers · RT boost · A read · X land · B back · Y map · Start pause' },
];
export const CONTROLS_HINT = 'WASD / arrows steer · Shift boost · Tab destinations · Esc pause';
