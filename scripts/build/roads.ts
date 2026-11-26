/**
 * roads.bin: the road and rail network as centre lines, for the road layer the site draws near the
 * plane (src/world/ribbons.ts). The same roads are painted into the ground image, which is all that
 * is seen from far away; this is what makes them sharp, with lanes and markings, up close.
 *
 * Kept: every drivable road the ground image shows, and rail. Left out: tunnels and road areas
 * (already dropped by transport()), service stubs too short to read, and the roadway on the
 * Harbour Bridge, whose deck is modelled and marked on its own.
 */
import { resolve } from 'node:path';
import { bridgeModel } from '../../src/shared/bridge';
import { type RoadWay, encodeRoads } from '../../src/shared/mapFormat';
import { RAIL, ROAD_CLASSES, type RoadClass, roadFlags } from '../../src/shared/roads';
import { BOUNDS, PUBLIC_MAP_DIR } from '../config';
import { clipLine, douglasPeucker } from '../lib/geom';
import { writeFile, writeGz } from '../lib/io';
import { WORK } from '../lib/paths';
import { transport } from './ground';
import { loadLandmarks } from './landmarks';

/** Detail finer than this cannot be seen at the site's pixel size. */
const SIMPLIFY_M = 0.75;
const MIN_SERVICE_M = 20;
const MIN_ANY_M = 4;
/** Roads stop a little inside the map's edge, where the terrain they lie on stops. */
const EDGE_INSET_M = 1;

const length = (line: ArrayLike<number>) => {
  let d = 0;
  for (let i = 2; i < line.length; i += 2) d += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
  return d;
};

export async function buildRoads() {
  const { roads, rails } = transport();
  const hb = loadLandmarks().landmarks.harbourBridge;
  const bridge = bridgeModel(hb);
  /** On the Harbour Bridge itself, between its abutments. */
  const onHarbourBridge = (x: number, z: number) => {
    const s = (x - hb.a.x) * bridge.ux + (z - hb.a.z) * bridge.uz;
    const lateral = (x - hb.a.x) * bridge.vx + (z - hb.a.z) * bridge.vz;
    return Math.abs(lateral) < 30 && s > bridge.span.first * bridge.step - 5 && s < bridge.span.last * bridge.step + 5;
  };
  const box = [BOUNDS.minX + EDGE_INSET_M, BOUNDS.maxX - EDGE_INSET_M, BOUNDS.minZ + EDGE_INSET_M, BOUNDS.maxZ - EDGE_INSET_M] as const;

  const out: RoadWay[] = [];
  const km: Record<string, number> = {};
  const dropped = { short: 0, harbourBridge: 0 };
  const add = (cls: number, flags: number, raw: number[], name: string) => {
    for (const part of clipLine(raw, ...box)) {
      const line = douglasPeucker(part, SIMPLIFY_M);
      const m = length(line);
      if (m < (name === 'service' ? MIN_SERVICE_M : MIN_ANY_M)) {
        dropped.short++;
        continue;
      }
      const mid = Math.floor(line.length / 4) * 2;
      if (flags & 2 && onHarbourBridge(line[mid], line[mid + 1])) {
        dropped.harbourBridge++;
        continue;
      }
      out.push({ cls, flags, line });
      km[name] = (km[name] ?? 0) + m / 1000;
    }
  };
  // transport() has already sorted the roads minor to major: the order they are painted in.
  for (const r of roads) {
    const cls = ROAD_CLASSES.indexOf(r.cls as RoadClass);
    if (cls < 0 || cls === RAIL) continue;
    add(cls, roadFlags(r.lanes, r.oneway, r.bridge), r.line, r.cls);
  }
  for (const line of rails) add(RAIL, 0, line, 'rail');

  const vertices = out.reduce((n, r) => n + r.line.length / 2, 0);
  const entry = writeGz(resolve(PUBLIC_MAP_DIR, 'roads.bin.gz'), encodeRoads(out));
  const totalKm = Object.values(km).reduce((a, b) => a + b, 0);
  const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  writeFile(resolve(WORK, 'roads.json'), JSON.stringify({ ways: out.length, vertices, km: Math.round(totalKm * 10) / 10, byClassKm: round(km), dropped, bytes: entry.bytes }, null, 1));
  console.log(`roads: ${out.length} ways, ${vertices} vertices, ${totalKm.toFixed(0)} km, ${(entry.bytes / 1024).toFixed(0)} KB gz (dropped ${dropped.short} short, ${dropped.harbourBridge} on the Harbour Bridge)`);
}
