/** Pure formatting helpers for the HUD and views (unit-tested). */

export function pad3(n: number): string {
  const d = ((Math.round(n) % 360) + 360) % 360;
  return String(d).padStart(3, '0');
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '--';
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} M`;
  return `${(m / 1000).toFixed(1)} KM`;
}

export function formatEta(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '--:--';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function formatMb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

export function loadingFraction(loaded: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.min(1, Math.max(0, loaded / total));
}

export function loadingText(loaded: number, total: number): string {
  return total > 0 ? `${formatMb(loaded)} / ${formatMb(total)} MB` : `${formatMb(loaded)} MB`;
}

/** Main HUD line, e.g. "OVER PONSONBY · HDG 045 · SKY TOWER 1.2 KM". */
export function hudLine(t: {
  place: string | null;
  headingDeg: number;
  target: { label: string; distanceM: number } | null;
  pullUp?: boolean;
}): string {
  if (t.pullUp) return 'PULL UP · PULL UP';
  const parts = [`OVER ${(t.place ?? 'AUCKLAND').toUpperCase()}`, `HDG ${pad3(t.headingDeg)}`];
  if (t.target) parts.push(`${t.target.label} ${formatDistance(t.target.distanceM)}`);
  return parts.join(' · ');
}

/** Cardinal label for a compass bearing that is a multiple of 45, else null. */
export function cardinal(deg: number): string | null {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  const map: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  return map[d] ?? null;
}

/** Signed shortest angle difference b - a, in -180..180. */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Position on an ellipse around the screen centre for an off-screen arrow. relativeDeg: 0 = up. */
export function edgeArrow(relativeDeg: number, w: number, h: number): { x: number; y: number; rotDeg: number } {
  const a = (relativeDeg * Math.PI) / 180;
  const rx = w * 0.4;
  const ry = h * 0.36;
  return { x: w / 2 + Math.sin(a) * rx, y: h * 0.46 - Math.cos(a) * ry, rotDeg: relativeDeg };
}

/** The plain page's anchor for a stop, or for one of its pages. */
export function stopHash(stop: string, pageId?: string): string {
  return `/page/#${stop}${pageId ? `-${pageId}` : ''}`;
}
