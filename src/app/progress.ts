/**
 * Which stops a visitor has seen, remembered between visits, and the order the tour takes them in.
 * Pure apart from the injected storage, so it runs in tests and in the entry chunk.
 */
import type { StopId } from '../content/types';
import { type StorageLike, readJson, writeJson } from './storage';

/** The tour ends at the contact stop: by then the visitor has seen what there is to talk about. */
export const TOUR_ORDER: readonly StopId[] = ['projects', 'work', 'study', 'offclock', 'talk'];

export const PROGRESS_KEY = 'aw:progress:v1';

/**
 * The next stop not yet seen, looking forward from `current` in tour order and wrapping round.
 * Null when everything has been seen (or the only stop left is the current one).
 */
export function nextStop(order: readonly StopId[], visited: ReadonlySet<StopId>, current: StopId | null): StopId | null {
  const n = order.length;
  const from = current ? order.indexOf(current) : -1;
  for (let i = 1; i <= n; i++) {
    const id = order[(from + i + n) % n];
    if (id !== current && !visited.has(id)) return id;
  }
  return null;
}

/** What the UI needs to draw ticks and the "next stop" button. */
export interface ProgressView {
  readonly visited: ReadonlySet<StopId>;
  readonly total: number;
  /** See nextStop. */
  next(current: StopId | null): StopId | null;
}

/**
 * Where the "next stop" button leads from `current`: the next stop not yet seen, or, once all of
 * them have been, the last stop of the tour (the chat). Null at that last stop with nothing left.
 */
export function onward(p: ProgressView, current: StopId, order: readonly StopId[] = TOUR_ORDER): { stop: StopId; finale: boolean } | null {
  const next = p.next(current);
  if (next) return { stop: next, finale: false };
  const last = order[order.length - 1];
  return current !== last ? { stop: last, finale: true } : null;
}

export interface Progress extends ProgressView {
  /** Record a stop as seen. Returns true when it was new. */
  visit(id: StopId): boolean;
}

export function createProgress(order: readonly StopId[], storage: StorageLike | null): Progress {
  const visited = new Set<StopId>();
  const stored = readJson(storage, PROGRESS_KEY);
  if (stored && typeof stored === 'object' && Array.isArray((stored as { visited?: unknown }).visited)) {
    // Ids from an older build that no longer exist are dropped rather than counted.
    for (const id of (stored as { visited: unknown[] }).visited) {
      if (typeof id === 'string' && (order as readonly string[]).includes(id)) visited.add(id as StopId);
    }
  }
  return {
    visited,
    total: order.length,
    next: (current) => nextStop(order, visited, current),
    visit(id) {
      if (visited.has(id) || !order.includes(id)) return false;
      visited.add(id);
      writeJson(storage, PROGRESS_KEY, { visited: order.filter((s) => visited.has(s)) });
      return true;
    },
  };
}
