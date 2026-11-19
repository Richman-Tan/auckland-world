import { describe, expect, it } from 'vitest';
import { FOG_FAR, detailLadder, lowDetailLevel } from '../src/shared/detail';

describe('detail ladder', () => {
  it('starts at the tier\'s full detail and only ever gets cheaper', () => {
    for (const tier of ['high', 'low'] as const) {
      const ladder = detailLadder(tier);
      expect(ladder[0]).toEqual({ fogFar: FOG_FAR[tier], extraScale: 0 });
      expect(ladder.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i].fogFar).toBeLessThanOrEqual(ladder[i - 1].fogFar);
        expect(ladder[i].extraScale).toBeGreaterThanOrEqual(ladder[i - 1].extraScale);
        // Every step changes something, so the governor never spends a step on nothing.
        expect(ladder[i]).not.toEqual(ladder[i - 1]);
      }
    }
  });

  it('the high tier shortens the draw distance before it coarsens the pixels', () => {
    const [, second] = detailLadder('high');
    expect(second.extraScale).toBe(0);
    expect(second.fogFar).toBeLessThan(FOG_FAR.high);
  });

  it('a Fast graphics setting pins the first level with coarser pixels', () => {
    for (const tier of ['high', 'low'] as const) {
      const ladder = detailLadder(tier);
      const i = lowDetailLevel(ladder);
      expect(ladder[i].extraScale).toBe(1);
      expect(i).toBeGreaterThan(0);
    }
    expect(lowDetailLevel([{ fogFar: 100, extraScale: 0 }])).toBe(0);
  });
});
