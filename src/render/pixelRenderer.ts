/**
 * The low-resolution renderer: a WebGLRenderer at 1/s of the CSS size, shown with nearest-neighbour
 * upscaling. s = max(2, round(cssHeight / 360)); it is published as the --px CSS variable so the
 * HUD's pixel art lines up with the 3D layer.
 *
 * `extraScale` makes the 3D picture coarser still (s + extra) when frames are slow. Only the canvas
 * changes: --px stays at the base scale, so the HUD never resizes under the visitor.
 */
import { WebGLRenderer } from 'three';
import { pixelScaleFor } from '../shared/pixelScale';

export { pixelScaleFor, TARGET_HEIGHT } from '../shared/pixelScale';

export class PixelRenderer {
  readonly renderer: WebGLRenderer;
  /** The scale the 3D view is drawn at: the base scale plus extraScale. */
  scale = 2;
  width = 1;
  height = 1;
  extraScale = 0;
  private cssWidth = 1;
  private cssHeight = 1;
  contextLost = false;
  /** Told when the browser takes the WebGL context away (true) and when it hands it back (false). */
  onContextChange: ((lost: boolean) => void) | null = null;
  private onLost = (e: Event) => {
    // Without preventDefault the browser never restores the context.
    e.preventDefault();
    this.contextLost = true;
    this.onContextChange?.(true);
  };
  private onRestored = () => {
    this.contextLost = false;
    this.onContextChange?.(false);
  };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;
    canvas.style.imageRendering = 'pixelated';
    canvas.style.position = 'absolute';
    canvas.style.left = '50%';
    canvas.style.top = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  /** Returns the internal (low-res) size. */
  resize(cssWidth: number, cssHeight: number): { width: number; height: number } {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    const base = pixelScaleFor(cssHeight);
    const s = base + this.extraScale;
    const w = Math.max(1, Math.floor(cssWidth / s));
    const h = Math.max(1, Math.floor(cssHeight / s));
    this.scale = s;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w * s}px`;
    this.canvas.style.height = `${h * s}px`;
    document.documentElement.style.setProperty('--px', String(base));
    return { width: w, height: h };
  }

  /** Coarser (or back to normal) 3D pixels at the current window size. */
  setExtraScale(extra: number): { width: number; height: number } {
    this.extraScale = Math.max(0, Math.round(extra));
    return this.resize(this.cssWidth, this.cssHeight);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.renderer.dispose();
  }
}
