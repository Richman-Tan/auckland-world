import { describe, expect, it } from 'vitest';
import { SCENE_MIX, createSound, engineVoice } from '../src/audio/index';

describe('sound', () => {
  it('the engine rises in pitch, loudness and brightness with airspeed', () => {
    const slow = engineVoice(35, false);
    const cruise = engineVoice(55, false);
    const fast = engineVoice(130, false);
    for (const k of ['freq', 'gain', 'cutoff', 'wind'] as const) {
      expect(cruise[k]).toBeGreaterThan(slow[k]);
      expect(fast[k]).toBeGreaterThan(cruise[k]);
    }
    // A low growl, not a whine: within the range small speakers can still reproduce.
    expect(slow.freq).toBeGreaterThan(50);
    expect(fast.freq).toBeLessThan(160);
  });

  it('boost lifts the note and opens the filter at the same speed', () => {
    const a = engineVoice(100, false);
    const b = engineVoice(100, true);
    expect(b.freq).toBeGreaterThan(a.freq);
    expect(b.cutoff).toBeGreaterThan(a.cutoff);
    expect(b.gain).toBe(a.gain);
  });

  it('stays in range for any speed, including nonsense', () => {
    for (const speed of [-50, 0, 35, 80, 130, 400, Number.POSITIVE_INFINITY]) {
      const v = engineVoice(speed, true);
      expect(v.gain).toBeGreaterThan(0);
      expect(v.gain).toBeLessThanOrEqual(0.2);
      expect(v.wind).toBeLessThanOrEqual(0.15);
      expect(v.cutoff).toBeLessThan(4000);
    }
  });

  it('is quieter while holding over a stop, has no engine in a room, and nothing when paused', () => {
    expect(SCENE_MIX.flight).toEqual([1, 1]);
    expect(SCENE_MIX.hold[0]).toBeLessThan(1);
    expect(SCENE_MIX.room[0]).toBe(0);
    expect(SCENE_MIX.silent).toEqual([0, 0]);
  });

  it('is simply absent where there is no Web Audio (as here, in Node)', () => {
    expect(createSound()).toBeNull();
  });
});
