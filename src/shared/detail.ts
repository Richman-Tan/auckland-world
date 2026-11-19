/**
 * The runtime detail ladder: what each level of the frame-rate governor (src/app/governor.ts) means
 * in draw distance and pixel size. Pure, so the app can read it without loading three.js.
 */
export type QualityTier = 'high' | 'low';

export interface WorldDetail {
  /** Fog and draw distance, metres. */
  fogFar: number;
  /** Added to the base pixel scale: 0 is the normal chunky pixel, 1 and 2 are coarser and cheaper. */
  extraScale: number;
}

/** Full-detail fog distance for each load-time tier. */
export const FOG_FAR: Record<QualityTier, number> = { high: 3200, low: 2400 };

/**
 * Level 0 is the tier's full detail. Each step down is cheaper: first a shorter draw distance (fewer
 * buildings, same crispness), then coarser pixels, which cuts the fill cost by roughly half a step.
 */
export function detailLadder(tier: QualityTier): WorldDetail[] {
  const base = FOG_FAR[tier];
  const near = Math.min(base, 2400);
  const steps: WorldDetail[] = [
    { fogFar: base, extraScale: 0 },
    { fogFar: near, extraScale: 0 },
    { fogFar: near, extraScale: 1 },
    { fogFar: Math.min(near, 2000), extraScale: 2 },
  ];
  // The low tier already starts at the shorter distance: drop the step that would change nothing.
  return steps.filter((d, i) => i === 0 || d.fogFar !== steps[i - 1].fogFar || d.extraScale !== steps[i - 1].extraScale);
}

/** The level a "low" graphics setting pins: the first one with coarser pixels. */
export function lowDetailLevel(ladder: readonly WorldDetail[]): number {
  const i = ladder.findIndex((d) => d.extraScale >= 1);
  return i < 0 ? ladder.length - 1 : i;
}
