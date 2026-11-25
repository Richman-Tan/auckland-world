/**
 * The boot scene: what is behind the title and loading views until the live city can be drawn.
 * A low-resolution 2D canvas, scaled up with hard pixels like the 3D view, showing a blueprint of the
 * skyline going up as the map loads (see skyline.ts). When the city is ready, `reveal` dissolves the
 * picture away from the Sky Tower outwards and the WebGL canvas underneath shows through.
 *
 * It needs no assets and draws about fifteen times a second, less when nothing is changing.
 */
import { h, prefersReducedMotion, readPixelScale } from '../dom';
import { type Skyline, bayer4, clearsAt, layoutSkyline, risen, towerHalfWidth, towerRisen, windowLit } from './skyline';

export interface BootScene {
  el: HTMLCanvasElement;
  /** How far the load has got, 0 to 1. The picture eases towards it. */
  setProgress(fraction: number): void;
  /** Give way to the live city. Resolves when the picture is gone; safe to call more than once. */
  reveal(): Promise<void>;
  /** True once reveal has finished. */
  readonly gone: boolean;
}

/* Colours, already mixed against the background: the canvas is opaque until the reveal. */
/** The sky from the top down to the horizon. ui.css paints the same bands before this canvas exists. */
const SKY: [number, number, number][] = [
  [10, 26, 30], [12, 31, 36], [14, 37, 43], [16, 43, 50], [19, 49, 56], [22, 56, 63],
];
const WATER: [number, number, number] = [11, 30, 36];
const GRID: [number, number, number] = [24, 52, 58];
/** How much of each band, at its lower edge, is dithered into the next. */
const BLEND = 0.45;
const RIPPLE = '#16363e';
const HORIZON = '#3f6b6d';
const BACK_FILL = '#12292f';
const BACK_LINE = '#2c5053';
const FRONT_FILL = '#16343b';
const FRONT_LINE = '#7f8f86';
const WINDOW = '#c79f2b';
const WINDOW_BACK = '#6b6226';
const GIRDER = '#f2c230';
const TOWER_LINE = '#d9d2bf';
const TOWER_FILL = '#1b3d45';
const BEACON = '#d7263d';
const PLANE = '#f4ecd8';
const TRAIL = '#35585b';

/** The little side-view plane from the Fly button, as rectangles on a 15 x 7 grid, nose to the right. */
const PLANE_RECTS: [number, number, number, number][] = [
  [1, 0, 2, 3], [2, 3, 11, 2], [5, 2, 6, 1], [14, 1, 1, 5], [13, 3, 1, 2], [6, 5, 1, 1], [10, 5, 1, 1],
];

const REVEAL_MS = 950;
const REVEAL_STEPS = 18;
const FRAME_MS = 66;

export function createBootScene(): BootScene {
  const el = h('canvas', { class: 'aw-boot', 'aria-hidden': 'true' });
  const ctx = el.getContext('2d');
  let gone = false;
  let sky: Skyline = layoutSkyline(1, 1);
  let target = 0;
  let shown = 0;
  let lastDraw = 0;
  let lastTick = performance.now();
  let raf = 0;
  let revealing: Promise<void> | null = null;
  /** The part of the picture that never changes, painted once per size. */
  const backdrop = document.createElement('canvas');

  /** Sky, survey grid and water. Each band of sky is dithered into the one below it. */
  function paintBackdrop(w: number, hgt: number, horizon: number): void {
    backdrop.width = w;
    backdrop.height = hgt;
    const b = backdrop.getContext('2d');
    if (!b) return;
    const image = b.createImageData(w, hgt);
    const data = image.data;
    for (let y = 0, i = 0; y < hgt; y++) {
      const t = (y / horizon) * SKY.length;
      const band = Math.min(SKY.length - 1, Math.floor(t));
      const into = band < SKY.length - 1 ? Math.max(0, (t - band - (1 - BLEND)) / BLEND) : 0;
      for (let x = 0; x < w; x++, i += 4) {
        let c = y >= horizon ? WATER : into > 0 && (bayer4(x, y) + 0.5) / 16 < into ? SKY[band + 1] : SKY[band];
        if (y < horizon && x % 12 === 6 && y % 12 === 6) c = GRID;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    }
    b.putImageData(image, 0, 0);
  }

  function resize(): void {
    const px = readPixelScale();
    const w = Math.max(1, Math.ceil(innerWidth / px));
    const hgt = Math.max(1, Math.ceil(innerHeight / px));
    el.width = w;
    el.height = hgt;
    el.style.width = `${w * px}px`;
    el.style.height = `${hgt * px}px`;
    sky = layoutSkyline(w, hgt);
    paintBackdrop(w, hgt, sky.horizon);
    lastDraw = 0;
  }

  function draw(now: number): void {
    if (!ctx) return;
    const { width: w, height: hgt, horizon } = sky;
    ctx.drawImage(backdrop, 0, 0);

    // A few slow ripples on the water.
    ctx.fillStyle = RIPPLE;
    const drift = prefersReducedMotion() ? 0 : Math.floor(now / 900);
    for (let y = horizon + 3, row = 0; y < hgt; y += 4, row++) {
      const step = 23 + row * 7;
      for (let x = ((row * 13 + drift * (1 + (row & 1))) % step) - step; x < w; x += step) ctx.fillRect(x, y, 3 + (row % 3), 1);
    }

    // Buildings: the back row first.
    for (const b of sky.blocks) {
      const up = risen(b, shown);
      if (up <= 0) continue;
      const top = horizon - up;
      ctx.fillStyle = b.back ? BACK_FILL : FRONT_FILL;
      ctx.fillRect(b.x, top, b.w, up);
      ctx.fillStyle = b.back ? BACK_LINE : FRONT_LINE;
      ctx.fillRect(b.x, top, 1, up);
      ctx.fillRect(b.x + b.w - 1, top, 1, up);
      // Still going up: a girder across the top. Finished: a roof line.
      const building = up < b.height;
      ctx.fillStyle = building ? GIRDER : b.back ? BACK_LINE : FRONT_LINE;
      ctx.fillRect(b.x, top, b.w, 1);
      ctx.fillStyle = b.back ? WINDOW_BACK : WINDOW;
      for (let wy = 3, row = 0; wy < up - 1; wy += 3, row++) {
        for (let wx = 2, col = 0; wx < b.w - 2; wx += 2, col++) {
          if (windowLit(b.seed, col, row)) ctx.fillRect(b.x + wx, horizon - wy, 1, 1);
        }
      }
    }

    // The Sky Tower, as tall as the load is far along.
    const full = sky.tower.height;
    const up = towerRisen(full, shown);
    for (let y = 0; y < up; y++) {
      const half = towerHalfWidth(y, full);
      const row = horizon - 1 - y;
      ctx.fillStyle = TOWER_LINE;
      ctx.fillRect(sky.tower.x - half, row, half * 2 + 1, 1);
      if (half >= 2) {
        ctx.fillStyle = TOWER_FILL;
        ctx.fillRect(sky.tower.x - half + 1, row, half * 2 - 1, 1);
      }
    }
    if (up > 0 && up < full) {
      ctx.fillStyle = GIRDER;
      ctx.fillRect(sky.tower.x - 1, horizon - 1 - up, 3, 1);
    } else if (up >= full && (prefersReducedMotion() || Math.floor(now / 600) % 2 === 0)) {
      ctx.fillStyle = BEACON;
      ctx.fillRect(sky.tower.x - 1, horizon - 1 - full, 3, 2);
    }

    // Horizon line over the feet of everything.
    ctx.fillStyle = HORIZON;
    ctx.fillRect(sky.left > 0 ? Math.floor(sky.left * 0.75) : 0, horizon, w, 1);

    // A plane crossing the sky, once a quarter of a minute.
    const lane = Math.floor(horizon * 0.2);
    const lap = w + 80;
    const px = prefersReducedMotion() ? Math.floor(w * 0.82) : Math.floor(((now / 1000) * 9) % lap) - 40;
    ctx.fillStyle = TRAIL;
    for (let x = px - 6; x > px - 46; x -= 4) ctx.fillRect(x, lane + 3, 2, 1);
    ctx.fillStyle = PLANE;
    for (const [rx, ry, rw, rh] of PLANE_RECTS) ctx.fillRect(px + rx, lane + ry, rw, rh);
  }

  function tick(now: number): void {
    if (gone || revealing) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    // Ease towards the real figure: quick enough to keep up, slow enough that a jump reads as building.
    shown = prefersReducedMotion() ? target : Math.min(target, shown + Math.max(dt * 0.25, (target - shown) * (1 - Math.exp(-dt * 5))));
    if (now - lastDraw < FRAME_MS) return;
    lastDraw = now;
    draw(now);
  }

  function finish(): void {
    gone = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    el.hidden = true;
  }

  function reveal(): Promise<void> {
    if (revealing) return revealing;
    cancelAnimationFrame(raf);
    if (!ctx || prefersReducedMotion()) {
      finish();
      return (revealing = Promise.resolve());
    }
    // One last frame with everything built, then take it apart pixel by pixel.
    shown = target = 1;
    draw(performance.now());
    const { width: w, height: hgt } = sky;
    const image = ctx.getImageData(0, 0, w, hgt);
    const cx = sky.tower.x;
    const cy = sky.horizon - sky.tower.height * 0.65;
    // Which step each pixel goes at, worked out once.
    const at = new Uint8Array(w * hgt);
    for (let y = 0, i = 0; y < hgt; y++) for (let x = 0; x < w; x++, i++) at[i] = Math.min(REVEAL_STEPS, 1 + Math.floor(clearsAt(x, y, w, hgt, cx, cy) * REVEAL_STEPS));
    const began = performance.now();
    let done = 0;
    return (revealing = new Promise<void>((resolve) => {
      const step = (now: number) => {
        const upTo = Math.min(REVEAL_STEPS, Math.floor(((now - began) / REVEAL_MS) * REVEAL_STEPS));
        if (upTo > done) {
          const data = image.data;
          for (let i = 0; i < at.length; i++) if (at[i] > done && at[i] <= upTo) data[i * 4 + 3] = 0;
          done = upTo;
          ctx.putImageData(image, 0, 0);
        }
        if (done >= REVEAL_STEPS) {
          finish();
          resolve();
        } else {
          raf = requestAnimationFrame(step);
        }
      };
      raf = requestAnimationFrame(step);
    }));
  }

  resize();
  addEventListener('resize', resize);
  draw(performance.now());
  raf = requestAnimationFrame(tick);

  return {
    el,
    setProgress(fraction) {
      target = Math.max(target, Math.min(1, Math.max(0, fraction)));
    },
    reveal,
    get gone() {
      return gone;
    },
  };
}
