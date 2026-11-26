/**
 * The site icon: the initials in the title screen's own style (cream pixel letters with a red drop
 * shadow on ink), drawn on a 16 x 16 grid so it is sharp in a browser tab.
 *
 *   npm run icon
 *
 * writes public/favicon.svg, public/favicon-32.png and public/apple-touch-icon.png.
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INK = '#0b1c20';
const CREAM = '#f4ecd8';
const RED = '#d7263d';

/** One character per pixel: C is a letter pixel. Two-pixel strokes, so it holds at 16 px. */
const LETTERS = [
  '................',
  '................',
  '................',
  '................',
  '.CCCCC..CCCCCC..',
  '.CC..CC.CCCCCC..',
  '.CC..CC...CC....',
  '.CC..CC...CC....',
  '.CCCCC....CC....',
  '.CC.CC....CC....',
  '.CC..CC...CC....',
  '.CC..CC...CC....',
  '................',
  '................',
  '................',
  '................',
];

/** The letters over their shadow (one pixel down and right), over the background. */
export function iconPixels(): string[][] {
  const letter = (x: number, y: number) => LETTERS[y]?.[x] === 'C';
  return Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (letter(x, y) ? CREAM : letter(x - 1, y - 1) ? RED : INK)));
}

/** The grid as an SVG: one rect per horizontal run of a colour, over a full background. */
export function iconSvg(): string {
  const px = iconPixels();
  const rects: Record<string, string[]> = { [RED]: [], [CREAM]: [] };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; ) {
      const c = px[y][x];
      let w = 1;
      while (x + w < 16 && px[y][x + w] === c) w++;
      if (c !== INK) rects[c].push(`<rect x="${x}" y="${y}" width="${w}" height="1"/>`);
      x += w;
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">' +
    `<rect width="16" height="16" fill="${INK}"/>` +
    `<g fill="${RED}">${rects[RED].join('')}</g><g fill="${CREAM}">${rects[CREAM].join('')}</g></svg>\n`
  );
}

/** A PNG `size` pixels square: the grid scaled by a whole number and centred on ink. */
export function iconPng(size: number, scale: number): Buffer {
  const canvas = createCanvas(size, size);
  const g = canvas.getContext('2d');
  g.fillStyle = INK;
  g.fillRect(0, 0, size, size);
  const off = Math.floor((size - 16 * scale) / 2);
  iconPixels().forEach((row, y) =>
    row.forEach((c, x) => {
      g.fillStyle = c;
      g.fillRect(off + x * scale, off + y * scale, scale, scale);
    }),
  );
  return canvas.toBuffer('image/png');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(import.meta.dirname, '../../public');
  writeFileSync(resolve(out, 'favicon.svg'), iconSvg());
  writeFileSync(resolve(out, 'favicon-32.png'), iconPng(32, 2));
  // Home-screen icon: phones round the corners, so the mark keeps a margin.
  writeFileSync(resolve(out, 'apple-touch-icon.png'), iconPng(180, 10));
  console.log('wrote favicon.svg, favicon-32.png and apple-touch-icon.png');
}
