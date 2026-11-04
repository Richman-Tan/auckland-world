/** Read cached Overpass JSON (out geom) and turn it into local-metre polygons and lines. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleRings, pointInRing, signedArea } from './geom';
import { lonLatToLocal } from './geo';
import { RAW_OSM } from './paths';

export type Tags = Record<string, string>;

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Tags;
  lat?: number;
  lon?: number;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  nodes?: number[];
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; ref: number; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}

export interface OsmFile {
  elements: OsmElement[];
  osm3s?: { timestamp_osm_base?: string };
}

export function loadOsm(name: string): OsmFile {
  return JSON.parse(readFileSync(resolve(RAW_OSM, `${name}.json`), 'utf8'));
}

/** Project [{lat, lon}] to flat local [x, z, ...]. Skips null points. */
export function geomToLocal(g: ({ lat: number; lon: number } | null)[] | undefined): number[] {
  const out: number[] = [];
  if (!g) return out;
  for (const p of g) {
    if (!p) continue;
    const { x, z } = lonLatToLocal(p.lon, p.lat);
    out.push(x, z);
  }
  return out;
}

export interface Polygon {
  /** rings[0] outer, rest holes; local x, z. Not closed. Orientation not normalised. */
  rings: number[][];
}

function isClosed(g: ({ lat: number; lon: number } | null)[]): boolean {
  const a = g[0], b = g[g.length - 1];
  return !!a && !!b && g.length >= 4 && a.lat === b.lat && a.lon === b.lon;
}

function toLonLatFlat(g: ({ lat: number; lon: number } | null)[] | undefined): number[] {
  const out: number[] = [];
  for (const p of g ?? []) if (p) out.push(p.lon, p.lat);
  return out;
}

function projectRing(r: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < r.length; i += 2) {
    const { x, z } = lonLatToLocal(r[i], r[i + 1]);
    out.push(x, z);
  }
  return out;
}

/** Polygons for a way (closed) or a multipolygon/boundary relation (members joined end-to-end). */
export function polygonsOf(el: OsmElement): Polygon[] {
  if (el.type === 'way') {
    if (!el.geometry || !isClosed(el.geometry)) return [];
    const ring = geomToLocal(el.geometry);
    return [{ rings: [ring.slice(0, ring.length - 2)] }];
  }
  if (el.type !== 'relation' || !el.members) return [];
  const outerSegs = [];
  const innerSegs = [];
  for (const m of el.members) {
    if (m.type !== 'way' || !m.geometry) continue;
    const seg = { pts: toLonLatFlat(m.geometry) };
    if (m.role === 'inner') innerSegs.push(seg);
    else if (m.role === 'outer' || m.role === '') outerSegs.push(seg);
  }
  const outers = assembleRings(outerSegs).rings.map(projectRing);
  const inners = assembleRings(innerSegs).rings.map(projectRing);
  const polys: Polygon[] = outers.map((o) => ({ rings: [o] }));
  for (const inn of inners) {
    const px = inn[0], pz = inn[1];
    // Smallest containing outer wins.
    let best = -1, bestArea = Infinity;
    outers.forEach((o, i) => {
      if (pointInRing(px, pz, o)) {
        const a = Math.abs(signedArea(o));
        if (a < bestArea) { bestArea = a; best = i; }
      }
    });
    if (best >= 0) polys[best].rings.push(inn);
  }
  return polys;
}

/** Open or closed polylines for a way, in local metres. */
export function lineOf(el: OsmElement): number[] {
  return el.type === 'way' ? geomToLocal(el.geometry) : [];
}

/** A representative lat/lon for any element. */
export function elementLatLon(el: OsmElement): { lat: number; lon: number } | null {
  if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) return { lat: el.lat, lon: el.lon };
  if (el.bounds) return { lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lon: (el.bounds.minlon + el.bounds.maxlon) / 2 };
  const g = el.geometry?.filter(Boolean) as { lat: number; lon: number }[] | undefined;
  if (g && g.length) {
    let la = 0, lo = 0;
    for (const p of g) { la += p.lat; lo += p.lon; }
    return { lat: la / g.length, lon: lo / g.length };
  }
  return null;
}
