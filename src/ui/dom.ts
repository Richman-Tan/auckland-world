/** Tiny DOM helpers. No framework. */

type Attrs = Record<string, string | number | boolean | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Writes textContent only when it changed (keeps DOM writes cheap in the HUD loop). */
export function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/**
 * True when motion should be kept to a minimum: the visitor's device asks for it, or they chose
 * "Reduced" in the settings (app.ts mirrors that choice onto <html data-motion="reduced">).
 */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The world's integer pixel scale (CSS variable --px, unitless or in px). Default 3. */
export function readPixelScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--px');
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 3;
}
