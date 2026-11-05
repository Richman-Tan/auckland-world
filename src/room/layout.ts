/**
 * The Sky Deck: a ring-shaped observation deck inside the Sky Tower's pod, matching the pod's 12
 * sides so its windows line up with the tower's glass band. Room-local coordinates: origin on the
 * tower's axis at floor level, x and z in metres, angle phi measured from +x towards +z (the same
 * convention as the landmark meshes). Pure data and maths: no three.js.
 */

export const SKY_DECK = {
  /** Floor height above the tower's ground: the bottom of the pod's window band. */
  floor: 192,
  height: 3.6,
  sides: 12,
  /** Circumradius of the central core (lifts, screens). */
  coreRadius: 6.5,
  /** Circumradius of the window ring (inside the pod's 20 m skin). */
  windowRadius: 19.4,
  eye: 1.62,
} as const;

export type HotspotKind = 'screen' | 'lift';

export interface Hotspot {
  id: string;
  kind: HotspotKind;
  /** Core facet the hotspot is mounted on (0..11); facet k is centred at phi = (k + 0.5) * 30 degrees. */
  facet: number;
  /** Shown on the plaque and in the prompt. */
  title: string;
  /** Prompt text, e.g. "Read about DementiaGuide AI". */
  action: string;
  /** The projects briefing page this screen opens. */
  pageId?: string;
  video?: string;
}

export const SKY_DECK_SPOTS: Hotspot[] = [
  { id: 'dementiaguide', kind: 'screen', facet: 0, title: 'DementiaGuide AI', action: 'Read about DementiaGuide AI', pageId: 'dementiaguide', video: '/media/skydeck/dementiaguide.mp4' },
  { id: 'wie', kind: 'screen', facet: 3, title: 'WIE Academy', action: 'Read about WIE Academy', pageId: 'wie-academy', video: '/media/skydeck/wie.mp4' },
  { id: 'lift', kind: 'lift', facet: 4, title: 'Lift', action: 'Take the lift back to the plane' },
  { id: 'chudvents', kind: 'screen', facet: 6, title: 'Chudvents', action: 'Read about Chudvents', pageId: 'chudvents', video: '/media/skydeck/chudvents.mp4' },
  { id: 'this-site', kind: 'screen', facet: 9, title: 'This site', action: 'Read about this site', pageId: 'this-site', video: '/media/skydeck/this-site.mp4' },
];

const FACET = (Math.PI * 2) / SKY_DECK.sides;

export function facetAngle(facet: number): number {
  return (facet + 0.5) * FACET;
}

/** Distance from the axis to the middle of a facet of a regular polygon with circumradius r. */
export function apothem(r: number): number {
  return r * Math.cos(FACET / 2);
}

/** Where a hotspot sits: on the core facet, at the given distance out from the wall. */
export function hotspotPoint(spot: Hotspot, out = 0): { x: number; z: number; phi: number } {
  const phi = facetAngle(spot.facet);
  const r = apothem(SKY_DECK.coreRadius) + out;
  return { x: Math.cos(phi) * r, z: Math.sin(phi) * r, phi };
}
