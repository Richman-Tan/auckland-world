/** Top compass strip: a 120 degree window of the heading tape, plus a destination bug. */
import { ACCENTS } from '../../shared/palette';
import { angleDelta, cardinal, pad3 } from '../format';

export const COMPASS_W = 480;
export const COMPASS_H = 46;
const WINDOW_DEG = 120;

export function drawCompass(
  ctx: CanvasRenderingContext2D,
  headingDeg: number,
  target: { bearingDeg: number; label: string } | null,
): void {
  const W = COMPASS_W;
  const H = COMPASS_H;
  const ppd = W / WINDOW_DEG;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(9,27,31,.84)';
  ctx.fillRect(0, 0, W, 30);
  ctx.fillStyle = 'rgba(244,236,216,.55)';
  ctx.fillRect(0, 0, W, 3);
  ctx.fillRect(0, 27, W, 3);
  ctx.font = '11px "Departure Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const start = Math.floor((headingDeg - WINDOW_DEG / 2) / 5) * 5;
  for (let d = start; d <= headingDeg + WINDOW_DEG / 2 + 5; d += 5) {
    const x = Math.round(W / 2 + (d - headingDeg) * ppd);
    if (x < 2 || x > W - 2) continue;
    const norm = ((d % 360) + 360) % 360;
    const card = norm % 45 === 0 ? cardinal(norm) : null;
    ctx.fillStyle = '#f4ecd8';
    if (card) {
      ctx.fillStyle = card.length === 1 ? '#f2c230' : '#f4ecd8';
      ctx.fillText(card, x, 15);
      ctx.fillRect(x, 3, 1, 4);
    } else if (norm % 15 === 0) {
      ctx.fillRect(x, 3, 1, 8);
      if (norm % 30 === 0) ctx.fillText(String(norm / 10).padStart(2, '0'), x, 19);
    } else {
      ctx.fillRect(x, 3, 1, 4);
    }
  }
  // lubber line / caret
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(W / 2 - 1, 0, 3, 8);
  ctx.fillRect(W / 2 - 3, 30, 7, 3);
  ctx.fillRect(W / 2 - 1, 33, 3, 3);
  // destination bug
  if (target) {
    const rel = angleDelta(headingDeg, target.bearingDeg);
    const inView = Math.abs(rel) <= WINDOW_DEG / 2 - 4;
    ctx.fillStyle = ACCENTS.kowhai;
    if (inView) {
      const x = Math.round(W / 2 + rel * ppd);
      ctx.beginPath();
      ctx.moveTo(x - 6, 31);
      ctx.lineTo(x + 6, 31);
      ctx.lineTo(x, 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f2c230';
      ctx.fillRect(x - 1, 8, 3, 14);
    } else {
      const left = rel < 0;
      const x = left ? 8 : W - 8;
      ctx.beginPath();
      ctx.moveTo(x + (left ? -6 : 6), 15);
      ctx.lineTo(x + (left ? 4 : -4), 8);
      ctx.lineTo(x + (left ? 4 : -4), 22);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#f4ecd8';
    ctx.textAlign = 'center';
    ctx.fillText(`${target.label}`, W / 2, 41);
  } else {
    ctx.fillStyle = '#f4ecd8';
    ctx.fillText(`HDG ${pad3(headingDeg)}`, W / 2, 41);
  }
}
