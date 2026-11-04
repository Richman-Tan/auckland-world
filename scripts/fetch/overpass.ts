/** Overpass fetch: sequential, cached, multi-endpoint with backoff, 2x2 split on timeout. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORLD } from '../config';
import { nztmToLonLat } from '../lib/geo';
import { RAW_OSM, ensure } from '../lib/paths';

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'auckland-world-pipeline/0.1 (personal portfolio; richmantan0@gmail.com)';
const BACKOFF_S = [5, 15, 45];
const SPACING_MS = 2000;

export interface BBox {
  s: number;
  w: number;
  n: number;
  e: number;
}

/** World rectangle grown by `marginM`, as a lat/lon bbox covering all four corners. */
export function worldBBox(marginM: number): BBox {
  const lons: number[] = [];
  const lats: number[] = [];
  for (const e of [WORLD.minE - marginM, WORLD.maxE + marginM]) {
    for (const n of [WORLD.minN - marginM, WORLD.maxN + marginM]) {
      const [lon, lat] = nztmToLonLat(e, n);
      lons.push(lon);
      lats.push(lat);
    }
  }
  return { s: Math.min(...lats), w: Math.min(...lons), n: Math.max(...lats), e: Math.max(...lons) };
}

const bb = (b: BBox) => `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;
const HEAD = '[out:json][timeout:180][maxsize:1073741824];';

export interface QueryDef {
  name: string;
  marginM: number;
  /** Builds the full Overpass QL for a bbox. */
  build: (b: string) => string;
}

export const QUERIES: QueryDef[] = [
  {
    name: 'buildings',
    marginM: 500,
    build: (b) => `${HEAD}(way["building"](${b});relation["building"](${b});way["building:part"](${b}););out geom;`,
  },
  {
    name: 'areas',
    marginM: 500,
    build: (b) =>
      `${HEAD}(` +
      `nwr["landuse"](${b});` +
      `nwr["leisure"~"^(park|pitch|golf_course|garden|playground|stadium|track|nature_reserve)$"](${b});` +
      `nwr["natural"~"^(wood|scrub|grassland|heath|wetland|beach|sand|bare_rock)$"](${b});` +
      `nwr["amenity"~"^(parking|school|university|hospital)$"](${b});` +
      `);out geom;`,
  },
  {
    name: 'water',
    marginM: 2000,
    build: (b) =>
      `${HEAD}(` +
      `way["natural"="coastline"](${b});` +
      `nwr["natural"="water"](${b});` +
      `way["waterway"~"^(river|stream|canal)$"](${b});` +
      `nwr["man_made"~"^(pier|breakwater|groyne)$"](${b});` +
      `);out geom;`,
  },
  {
    name: 'transport',
    marginM: 500,
    build: (b) => `${HEAD}(way["highway"](${b});way["railway"~"^(rail|light_rail|subway)$"](${b}););out geom;`,
  },
  {
    name: 'places',
    marginM: 500,
    build: (b) =>
      `${HEAD}(` +
      `node["place"~"^(suburb|neighbourhood|quarter)$"](${b});` +
      `node["natural"="peak"](${b});` +
      `nwr["name"="Sky Tower"](${b});` +
      `nwr["name"~"Harbour Bridge"](${b});` +
      `nwr["man_made"~"^(tower|bridge)$"](${b});` +
      `nwr["addr:street"="Ponsonby Road"]["addr:housenumber"="130"](${b});` +
      `);out geom;`,
  },
];

let requests = 0;
export function osmNetworkRequests() {
  return requests;
}

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TimeoutError extends Error {}

async function post(endpoint: string, ql: string): Promise<any> {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  requests++;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'data=' + encodeURIComponent(ql),
  });
  lastRequestAt = Date.now();
  const text = await res.text();
  if (res.status === 504 || res.status === 429 || res.status >= 500) throw new TimeoutError(`${endpoint}: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} ${text.slice(0, 200)}`);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TimeoutError(`${endpoint}: non-JSON response ${text.slice(0, 120)}`);
  }
  if (typeof json.remark === 'string' && /error|timed out|out of memory/i.test(json.remark)) {
    throw new TimeoutError(`${endpoint}: ${json.remark}`);
  }
  return json;
}

async function tryAll(ql: string, label: string): Promise<{ json: any; endpoint: string }> {
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt <= BACKOFF_S.length; attempt++) {
      try {
        const json = await post(endpoint, ql);
        return { json, endpoint };
      } catch (err) {
        lastErr = err;
        console.warn(`overpass ${label}: ${(err as Error).message}`);
        if (!(err instanceof TimeoutError)) break;
        if (attempt < BACKOFF_S.length) {
          console.warn(`  backing off ${BACKOFF_S[attempt]} s`);
          await sleep(BACKOFF_S[attempt] * 1000);
        }
      }
    }
  }
  throw lastErr;
}

function splitBBox(b: BBox): BBox[] {
  const ms = (b.s + b.n) / 2;
  const mw = (b.w + b.e) / 2;
  return [
    { s: b.s, w: b.w, n: ms, e: mw },
    { s: b.s, w: mw, n: ms, e: b.e },
    { s: ms, w: b.w, n: b.n, e: mw },
    { s: ms, w: mw, n: b.n, e: b.e },
  ];
}

export function mergeElements(parts: any[]): any[] {
  const seen = new Map<string, any>();
  for (const p of parts) for (const el of p.elements ?? []) seen.set(`${el.type}/${el.id}`, el);
  return [...seen.values()];
}

async function runQuery(q: QueryDef, box: BBox): Promise<{ json: any; endpoint: string; split: boolean }> {
  try {
    const r = await tryAll(q.build(bb(box)), q.name);
    return { ...r, split: false };
  } catch (err) {
    console.warn(`overpass ${q.name}: full query failed (${(err as Error).message}); splitting 2x2`);
  }
  const parts: any[] = [];
  let endpoint = '';
  for (const [i, sub] of splitBBox(box).entries()) {
    const r = await tryAll(q.build(bb(sub)), `${q.name}[${i + 1}/4]`);
    parts.push(r.json);
    endpoint = r.endpoint;
  }
  const base = parts[0];
  return { json: { ...base, elements: mergeElements(parts) }, endpoint, split: true };
}

export async function fetchOsm(refresh: boolean): Promise<void> {
  ensure(RAW_OSM);
  for (const q of QUERIES) {
    const box = worldBBox(q.marginM);
    const hash = createHash('sha256').update(q.build(bb(box))).digest('hex');
    const dataPath = resolve(RAW_OSM, `${q.name}.json`);
    const metaPath = resolve(RAW_OSM, `${q.name}.meta.json`);
    if (!refresh && existsSync(dataPath) && existsSync(metaPath)) {
      const old = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (old.queryHash === hash) {
        console.log(`osm: cached ${q.name} (${old.elementCount} elements, base ${old.osmBase})`);
        continue;
      }
    }
    console.log(`osm: fetching ${q.name} bbox ${bb(box)}`);
    const { json, endpoint, split } = await runQuery(q, box);
    writeFileSync(dataPath, JSON.stringify(json));
    const meta = {
      name: q.name,
      queryHash: hash,
      bbox: box,
      endpoint,
      split,
      fetchedAt: new Date().toISOString(),
      osmBase: json.osm3s?.timestamp_osm_base ?? null,
      elementCount: json.elements.length,
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 1));
    console.log(`osm: saved ${q.name}, ${json.elements.length} elements${split ? ' (split)' : ''}`);
  }
}
