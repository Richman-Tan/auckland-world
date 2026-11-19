import { describe, expect, it } from 'vitest';
import { PROGRESS_KEY, TOUR_ORDER, createProgress, nextStop, onward } from '../src/app/progress';
import { browserStorage, readJson, writeJson } from '../src/app/storage';
import { content } from '../src/content/index';
import type { StopId } from '../src/content/types';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('progress', () => {
  it('the tour covers every stop exactly once and ends at the contact stop', () => {
    expect([...TOUR_ORDER].sort()).toEqual(content.stops.map((s) => s.id).sort());
    expect(new Set(TOUR_ORDER).size).toBe(TOUR_ORDER.length);
    const last = content.stops.find((s) => s.id === TOUR_ORDER[TOUR_ORDER.length - 1])!;
    expect(last.experiences.some((x) => x.kind === 'chat')).toBe(true);
  });

  it('offers the next unseen stop in tour order, wrapping round, and null when all are seen', () => {
    const seen = new Set<StopId>();
    expect(nextStop(TOUR_ORDER, seen, null)).toBe('projects');
    expect(nextStop(TOUR_ORDER, seen, 'projects')).toBe('work');
    seen.add('work');
    expect(nextStop(TOUR_ORDER, seen, 'projects')).toBe('study');
    // From the last stop it wraps to whatever is still unseen.
    expect(nextStop(TOUR_ORDER, seen, 'talk')).toBe('projects');
    for (const id of TOUR_ORDER) seen.add(id);
    expect(nextStop(TOUR_ORDER, seen, 'study')).toBeNull();
    expect(nextStop(TOUR_ORDER, seen, null)).toBeNull();
    // The stop you are at is never offered as "next", even when it is the only unseen one.
    expect(nextStop(TOUR_ORDER, new Set<StopId>(['work', 'study', 'offclock', 'talk']), 'projects')).toBeNull();
  });

  it('the onward button leads to the next unseen stop, then to the chat, then nowhere', () => {
    const p = createProgress(TOUR_ORDER, null);
    p.visit('projects');
    expect(onward(p, 'projects')).toEqual({ stop: 'work', finale: false });
    for (const id of ['work', 'study', 'offclock'] as const) p.visit(id);
    // Only the chat is left: it is simply the next stop.
    expect(onward(p, 'offclock')).toEqual({ stop: 'talk', finale: false });
    p.visit('talk');
    expect(onward(p, 'study')).toEqual({ stop: 'talk', finale: true });
    expect(onward(p, 'talk')).toBeNull();
  });

  it('remembers visits between sessions', () => {
    const store = memory();
    const a = createProgress(TOUR_ORDER, store);
    expect(a.visit('study')).toBe(true);
    expect(a.visit('study')).toBe(false);
    expect(a.visit('projects')).toBe(true);
    expect(JSON.parse(store.data.get(PROGRESS_KEY)!)).toEqual({ visited: ['projects', 'study'] });
    const b = createProgress(TOUR_ORDER, store);
    expect([...b.visited].sort()).toEqual(['projects', 'study']);
    expect(b.total).toBe(5);
    expect(b.next('projects')).toBe('work');
  });

  it('ignores stored junk and stop ids that no longer exist', () => {
    for (const raw of ['not json', '42', '{"visited":"projects"}', '{"visited":[1,null,"gone","work"]}', '[]']) {
      const p = createProgress(TOUR_ORDER, memory({ [PROGRESS_KEY]: raw }));
      expect([...p.visited]).toEqual(raw.includes('"work"') ? ['work'] : []);
    }
  });

  it('works without storage, and when storage throws', () => {
    const none = createProgress(TOUR_ORDER, null);
    expect(none.visit('work')).toBe(true);
    expect(none.visited.has('work')).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readJson(broken, 'k')).toBeNull();
    expect(() => writeJson(broken, 'k', 1)).not.toThrow();
    const p = createProgress(TOUR_ORDER, broken);
    expect(p.visit('talk')).toBe(true);
    // Node has no localStorage: the lookup itself must not throw either.
    expect(() => browserStorage()).not.toThrow();
  });
});
