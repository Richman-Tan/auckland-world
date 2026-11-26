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
  /**
   * How far out the close-up detail reaches, as a share of its full radius: road markings, ground
   * texture, wall and roof patterns. 0 turns it off.
   */
  near: number;
  /** How many of the small things are drawn (trees, boats, parked cars), as a share of the full count. */
  props: number;
}

/** Full-detail fog distance for each load-time tier. */
export const FOG_FAR: Record<QualityTier, number> = { high: 3200, low: 2400 };

/** How far from the camera each kind of close-up detail is drawn at `near` = 1, metres. */
export const NEAR_RADIUS = { roads: 700, ground: 420, buildings: 500, bridge: 900, trees: 340 } as const;

/** The most trees drawn at once, at `props` = 1: the nearest ones. */
export const TREE_CAP = 1600;

/**
 * Level 0 is the tier's full detail. Each step down is cheaper: first a shorter draw distance and
 * fewer small things (same crispness), then coarser pixels and a tighter ring of close-up detail,
 * and at the last step no close-up detail at all.
 */
export function detailLadder(tier: QualityTier): WorldDetail[] {
  if (tier === 'low') {
    return [
      { fogFar: FOG_FAR.low, extraScale: 0, near: 0.6, props: 0.3 },
      { fogFar: FOG_FAR.low, extraScale: 1, near: 0.4, props: 0.15 },
      { fogFar: 2000, extraScale: 2, near: 0, props: 0 },
    ];
  }
  return [
    { fogFar: FOG_FAR.high, extraScale: 0, near: 1, props: 1 },
    { fogFar: 2400, extraScale: 0, near: 1, props: 0.6 },
    { fogFar: 2400, extraScale: 1, near: 0.6, props: 0.3 },
    { fogFar: 2000, extraScale: 2, near: 0, props: 0 },
  ];
}

/** The level a "low" graphics setting pins: the first one with coarser pixels. */
export function lowDetailLevel(ladder: readonly WorldDetail[]): number {
  const i = ladder.findIndex((d) => d.extraScale >= 1);
  return i < 0 ? ladder.length - 1 : i;
}
