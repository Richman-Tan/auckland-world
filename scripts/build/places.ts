/** Place labels (suburbs, neighbourhoods, quarters, peaks) and the 130 Ponsonby Road geocode. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapMeta } from '../../src/shared/mapFormat';
import { BOUNDS } from '../config';
import { lonLatToLocal } from '../lib/geo';
import { elementLatLon, loadOsm } from '../lib/osm';
import { WORK, ensure } from '../lib/paths';

export type Place = MapMeta['places'][number];

export interface PonsonbyGeocode {
  found: boolean;
  element?: string;
  lat?: number;
  lon?: number;
  x?: number;
  z?: number;
  tags?: Record<string, string>;
}

export function buildPlaces(): { places: Place[]; ponsonby: PonsonbyGeocode } {
  const els = loadOsm('places').elements;
  const places: Place[] = [];
  const seen = new Set<string>();
  for (const e of els) {
    if (e.type !== 'node' || !e.tags?.name || e.lat === undefined || e.lon === undefined) continue;
    const kind = e.tags.place ?? (e.tags.natural === 'peak' ? 'peak' : undefined);
    if (!kind || !['suburb', 'neighbourhood', 'quarter', 'peak'].includes(kind)) continue;
    const { x, z } = lonLatToLocal(e.lon, e.lat);
    if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) continue;
    const k = `${kind}:${e.tags.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    places.push({ name: e.tags.name, kind, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  }
  places.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  const pe = els.find((e) => e.tags?.['addr:street'] === 'Ponsonby Road' && e.tags?.['addr:housenumber'] === '130');
  let ponsonby: PonsonbyGeocode = { found: false };
  if (pe) {
    const ll = elementLatLon(pe)!;
    const { x, z } = lonLatToLocal(ll.lon, ll.lat);
    ponsonby = { found: true, element: `${pe.type}/${pe.id}`, lat: ll.lat, lon: ll.lon, x, z, tags: pe.tags };
    console.log(`places: 130 Ponsonby Road -> ${pe.type}/${pe.id} lat ${ll.lat.toFixed(6)} lon ${ll.lon.toFixed(6)} x ${x.toFixed(1)} z ${z.toFixed(1)} (user must confirm)`);
  } else {
    console.warn('places: 130 Ponsonby Road NOT found in OSM; the stop keeps its placeholder lat/lon');
  }
  console.log(`places: ${places.length} places (${[...new Set(places.map((p) => p.kind))].join(', ')})`);
  ensure(WORK);
  writeFileSync(resolve(WORK, 'places.json'), JSON.stringify({ places, ponsonby }, null, 1));
  return { places, ponsonby };
}

export function loadPlaces(): { places: Place[]; ponsonby: PonsonbyGeocode } {
  return JSON.parse(readFileSync(resolve(WORK, 'places.json'), 'utf8'));
}
