/** Resolve content stops (lat/lon or landmark anchors) into world coordinates. Pure. */
import type { SiteContent, Stop } from '../content/types';
import { SKY_TOWER } from '../shared/collision';
import { type MapMeta, latLonToLocal } from '../shared/mapFormat';
import type { StopPlacement, Vec3 } from './contracts';

type GroundFn = (x: number, z: number) => number;

function anchorPoint(stop: Stop, meta: MapMeta, groundAt: GroundFn): { x: number; z: number; anchorY: number } {
  const at = stop.beacon.at;
  if (at.kind === 'geo') {
    const p = latLonToLocal(meta.geo, at.lat, at.lon);
    return { ...p, anchorY: groundAt(p.x, p.z) };
  }
  if (at.id === 'skyTower') {
    const st = meta.landmarks.skyTower;
    return { x: st.x, z: st.z, anchorY: st.groundY + SKY_TOWER.podTop };
  }
  const top = meta.landmarks.harbourBridge.archTop;
  return { x: top.x, z: top.z, anchorY: top.y };
}

export function placeStop(stop: Stop, meta: MapMeta, groundAt: GroundFn): StopPlacement {
  const { x, z, anchorY } = anchorPoint(stop, meta, groundAt);
  const groundY = groundAt(x, z);
  const h = stop.beacon.height;
  const baseY = h.ref === 'ground' ? groundY + h.metres : h.ref === 'sea' ? h.metres : anchorY + h.metres;
  const orbitY = Math.max(baseY + 60, groundY + 110);
  return {
    id: stop.id,
    hotkey: stop.hotkey,
    label: stop.label,
    place: stop.place,
    color: stop.beacon.color,
    icon: stop.beacon.icon,
    x,
    z,
    groundY,
    baseY,
    triggerRadius: stop.beacon.triggerRadius,
    orbitRadius: stop.beacon.orbitRadius,
    orbitY,
  };
}

export function placeStops(content: SiteContent, meta: MapMeta, groundAt: GroundFn): StopPlacement[] {
  return content.stops.map((s) => placeStop(s, meta, groundAt));
}

/** Spawn position and heading (grid radians) from content.spawn. */
export function spawnPoint(content: SiteContent, meta: MapMeta): { pos: Vec3; heading: number } {
  const p = latLonToLocal(meta.geo, content.spawn.at.lat, content.spawn.at.lon);
  const heading = (content.spawn.headingDeg * Math.PI) / 180 + meta.crs.trueNorthAngleRad;
  return { pos: { x: p.x, y: content.spawn.altitudeAsl, z: p.z }, heading };
}
