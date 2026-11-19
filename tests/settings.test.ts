import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SETTING_CHOICES, createSettings, sanitiseSettings } from '../src/app/settings';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('settings', () => {
  it('starts from safe defaults: adaptive graphics, yoke-style pitch, sound off', () => {
    const s = createSettings(null).get();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.sound).toBe(false);
    expect(s.invertPitch).toBe(false);
    for (const key of Object.keys(SETTING_CHOICES) as (keyof typeof SETTING_CHOICES)[]) {
      expect(SETTING_CHOICES[key] as readonly string[]).toContain(DEFAULT_SETTINGS[key]);
    }
  });

  it('remembers changes between visits', () => {
    const store = memory();
    const a = createSettings(store);
    a.set({ graphics: 'low', invertPitch: true });
    a.set({ sound: true });
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)).toEqual({ ...DEFAULT_SETTINGS, graphics: 'low', invertPitch: true, sound: true });
    expect(createSettings(store).get()).toEqual({ ...DEFAULT_SETTINGS, graphics: 'low', invertPitch: true, sound: true });
  });

  it('tells listeners what changed, and stays quiet when nothing did', () => {
    const s = createSettings(null);
    const seen: string[] = [];
    const off = s.subscribe((now, before) => seen.push(`${before.graphics}>${now.graphics}`));
    s.set({ graphics: 'high' });
    s.set({ graphics: 'high' });
    s.set({});
    expect(seen).toEqual(['auto>high']);
    off();
    s.set({ graphics: 'low' });
    expect(seen).toEqual(['auto>high']);
    expect(s.get().graphics).toBe('low');
  });

  it('falls back to defaults for anything unreadable, field by field', () => {
    expect(sanitiseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitiseSettings('high')).toEqual(DEFAULT_SETTINGS);
    expect(sanitiseSettings({ graphics: 'ultra', invertPitch: 'yes', motion: 'reduced', sound: 1, time: 'night', extra: true })).toEqual({
      ...DEFAULT_SETTINGS,
      motion: 'reduced',
      time: 'night',
    });
    for (const raw of ['not json', '[]', '{"graphics":7}']) {
      expect(createSettings(memory({ [SETTINGS_KEY]: raw })).get()).toEqual(DEFAULT_SETTINGS);
    }
    // A bad value passed to set() is ignored rather than stored.
    const s = createSettings(null);
    s.set({ graphics: 'ultra' as never });
    expect(s.get().graphics).toBe('auto');
  });
});
