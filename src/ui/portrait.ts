/**
 * Richman's pixel portrait for the bridge chat: an 18 x 20 grid drawn as crisp SVG rects.
 * Frames are layered groups (eyes open/closed, mouth closed/open) that CSS switches between, so
 * blinking and talking need no JavaScript timers.
 */

const PALETTE: Record<string, string> = {
  K: '#1a1517', // outline and deepest hair
  H: '#2b2225', // hair
  h: '#4d3d40', // hair highlight
  S: '#d39b70', // skin
  s: '#b27b54', // skin shadow
  E: '#1a1517', // eyes and brows
  M: '#6e2a2c', // mouth
  T: '#f4ecd8', // teeth
  B: '#25282f', // sweater
  b: '#3b404a', // sweater highlight
};

/** Base face with no eyes or mouth ('.' is transparent). */
export const BASE = [
  '.....KKKKKKKK.....',
  '...KKHHHhHHHHKK...',
  '..KHHhHHHHHHhHHK..',
  '.KHHHHHHhHHHHHHHK.',
  '.KHhHHHHHHHHHhHHK.',
  '.KHHHHSHHHHHSHHHK.',
  '.KHHHSSSHSSSSSHHK.',
  '.KHSSHHSSSSHHSSHK.',
  '.KHSSSSSSSSSSSSHK.',
  '.KsSSSSSSSSSSSSsK.',
  '.KsSSSSSSsSSSSSsK.',
  '..KSSSSSSSSSSSSK..',
  '..KSSSSSSSSSSSSK..',
  '...KSSSSSSSSSSK...',
  '....KSSSSSSSSK....',
  '.....KsSSSSsK.....',
  '...KKbBsSSsBbKK...',
  '.KKBbBBBssBBBbBKK.',
  'KBBBbBBBBBBBBbBBBK',
  'KBBBBBBBBBBBBBBBBK',
];

type Layer = [row: number, col: number, pixels: string][];

/** Eyes: open (1 x 2 under the brows) or a closed lid line. */
export const EYES_OPEN: Layer = [[8, 6, 'E'], [9, 6, 'E'], [8, 11, 'E'], [9, 11, 'E']];
export const EYES_CLOSED: Layer = [[9, 5, 'EE'], [9, 11, 'EE']];
/** Mouth: a closed smile, or open mid-word with teeth showing. */
export const MOUTH_CLOSED: Layer = [[12, 6, 'M'], [12, 11, 'M'], [13, 7, 'MMMM']];
export const MOUTH_OPEN: Layer = [[12, 6, 'MTTTTM'], [13, 7, 'MMMM']];

export const WIDTH = BASE[0].length;
export const HEIGHT = BASE.length;

/** Horizontal runs of one colour become one rect each. */
function rects(rows: string[] | Layer): string {
  const out: string[] = [];
  const lines: [number, number, string][] = Array.isArray(rows[0]) ? (rows as Layer) : (rows as string[]).map((r, i) => [i, 0, r]);
  for (const [y, x0, line] of lines) {
    let x = 0;
    while (x < line.length) {
      const c = line[x];
      let run = 1;
      while (x + run < line.length && line[x + run] === c) run++;
      const fill = PALETTE[c];
      if (fill) out.push(`<rect x="${x0 + x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`);
      x += run;
    }
  }
  return out.join('');
}

/** The full portrait SVG. Class names drive the CSS frame switching in ui.css. */
export function portraitSvg(): string {
  return (
    `<svg class="aw-portrait__svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" shape-rendering="crispEdges" aria-hidden="true">` +
    rects(BASE) +
    `<g class="aw-portrait__eyes-open">${rects(EYES_OPEN)}</g>` +
    `<g class="aw-portrait__eyes-closed">${rects(EYES_CLOSED)}</g>` +
    `<g class="aw-portrait__mouth-closed">${rects(MOUTH_CLOSED)}</g>` +
    `<g class="aw-portrait__mouth-open">${rects(MOUTH_OPEN)}</g>` +
    '</svg>'
  );
}

/** Flattened grid for one frame (used by tests and the preview script). */
export function frameGrid(eyes: 'open' | 'closed', mouth: 'closed' | 'open'): string[] {
  const g = BASE.map((r) => r.split(''));
  for (const [y, x, px] of [...(eyes === 'open' ? EYES_OPEN : EYES_CLOSED), ...(mouth === 'open' ? MOUTH_OPEN : MOUTH_CLOSED)]) {
    for (let i = 0; i < px.length; i++) g[y][x + i] = px[i];
  }
  return g.map((r) => r.join(''));
}

export { PALETTE as PORTRAIT_PALETTE };
