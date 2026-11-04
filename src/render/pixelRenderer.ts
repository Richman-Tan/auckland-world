/**
 * The low-resolution renderer: a WebGLRenderer at 1/s of the CSS size, shown with nearest-neighbour
 * upscaling. s = max(2, round(cssHeight / 360)); it is published as the --px CSS variable so the
 * HUD's pixel art lines up with the 3D layer.
 */
import { WebGLRenderer } from 'three';

export const TARGET_HEIGHT = 360;

export function pixelScaleFor(cssHeight: number): number {
  return Math.max(2, Math.round(cssHeight / TARGET_HEIGHT));
}

export class PixelRenderer {
  readonly renderer: WebGLRenderer;
  scale = 2;
  width = 1;
  height = 1;
  contextLost = false;
  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };
  private onRestored = () => {
    this.contextLost = false;
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
    const s = pixelScaleFor(cssHeight);
    const w = Math.max(1, Math.floor(cssWidth / s));
    const h = Math.max(1, Math.floor(cssHeight / s));
    this.scale = s;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w * s}px`;
    this.canvas.style.height = `${h * s}px`;
    document.documentElement.style.setProperty('--px', String(s));
    return { width: w, height: h };
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.renderer.dispose();
  }
}
