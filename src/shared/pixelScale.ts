/**
 * The world's integer pixel scale: the 3D view renders at 1/s of the CSS size and the UI draws its
 * pixel art in the same units (the --px CSS variable). Pure, so the page can set --px before three.js
 * and the map load; otherwise the UI would resize the moment the renderer took over.
 */
export const TARGET_HEIGHT = 360;

export function pixelScaleFor(cssHeight: number): number {
  return Math.max(2, Math.round(cssHeight / TARGET_HEIGHT));
}

export function applyPixelScale(cssHeight: number, root: HTMLElement = document.documentElement): number {
  const s = pixelScaleFor(cssHeight);
  root.style.setProperty('--px', String(s));
  return s;
}
