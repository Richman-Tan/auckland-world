/** meta.json, assembled from the stage outputs the way fake.ts does, with real values. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeBuildings, decodeRoads, decodeTerrain, MAP_FORMAT_VERSION, type FileEntry, type MapMeta } from '../../src/shared/mapFormat';
import { ATTRIBUTION, BOUNDS, COLLISION_CELL, GROUND_MPP, LINZ, PUBLIC_MAP_DIR, TERRAIN_CELL, WORLD } from '../config';
import { fitGeo, localToLonLat, trueNorthAngleRad } from '../lib/geo';
import { sha256 } from '../lib/io';
import { DEBUG_DIR, RAW_OSM, WORK, ensure } from '../lib/paths';
import { loadLandmarks } from './landmarks';
import { loadPlaces } from './places';
import { loadWater } from './water';

const FILES = ['terrain.bin.gz', 'buildings.bin.gz', 'ground.webp', 'ground-lo.webp', 'minimap.webp'];
/** Close-up detail: each is listed only if its stage has been run. */
const ROADS_FILE = 'roads.bin.gz';

export function buildMeta() {
  const files: Record<string, FileEntry> = {};
  const raw: Record<string, Buffer> = {};
  for (const f of FILES) {
    const b = readFileSync(resolve(PUBLIC_MAP_DIR, f));
    raw[f] = b;
    files[f] = { bytes: b.byteLength, sha256: sha256(b) };
  }
  const detail: NonNullable<MapMeta['detail']> = {};
  if (existsSync(resolve(PUBLIC_MAP_DIR, ROADS_FILE))) {
    const b = readFileSync(resolve(PUBLIC_MAP_DIR, ROADS_FILE));
    files[ROADS_FILE] = { bytes: b.byteLength, sha256: sha256(b) };
    const roads = decodeRoads(new Uint8Array(gunzipSync(b)));
    detail.roads = { file: ROADS_FILE, ways: roads.count, vertices: roads.vertexCount };
  }
  const terrain = decodeTerrain(new Uint8Array(gunzipSync(raw['terrain.bin.gz'])));
  const bld = decodeBuildings(new Uint8Array(gunzipSync(raw['buildings.bin.gz'])));
  let maxHeight = 0;
  for (let i = 0; i < bld.count; i++) maxHeight = Math.max(maxHeight, bld.topY[i] - bld.baseY[i]);
  const dims = (webp: Buffer) => {
    // VP8/VP8L/VP8X headers: read the canvas size.
    if (webp.toString('ascii', 12, 16) === 'VP8X') return { w: 1 + webp.readUIntLE(24, 3), h: 1 + webp.readUIntLE(27, 3) };
    if (webp.toString('ascii', 12, 16) === 'VP8 ') return { w: webp.readUInt16LE(26) & 0x3fff, h: webp.readUInt16LE(28) & 0x3fff };
    const b = webp.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  };
  const g = dims(raw['ground.webp']);
  const mm = dims(raw['minimap.webp']);
  const { landmarks } = loadLandmarks();
  const { places } = loadPlaces();
  const osmBase = JSON.parse(readFileSync(resolve(RAW_OSM, 'buildings.meta.json'), 'utf8')).osmBase ?? new Date().toISOString();
  const [west, south] = localToLonLat(BOUNDS.minX, BOUNDS.maxZ);
  const [east, north] = localToLonLat(BOUNDS.maxX, BOUNDS.minZ);
  const meta: MapMeta = {
    version: MAP_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    sources: {
      osm: { baseTimestamp: osmBase },
      linz: { collection: 'auckland/auckland-part-1_2024 (dem_1m, dsm_1m, EPSG:2193)', tiles: [...LINZ.expectedTiles], captured: '2024' },
    },
    attribution: ATTRIBUTION,
    crs: { epsg: 2193, originE: WORLD.originE, originN: WORLD.originN, trueNorthAngleRad: trueNorthAngleRad() },
    geo: fitGeo(),
    bounds: BOUNDS,
    latLonBounds: { south, west, north, east },
    water: { level: 0 },
    terrain: { file: 'terrain.bin.gz', cols: terrain.cols, rows: terrain.rows, cell: TERRAIN_CELL, minH: terrain.minH, maxH: terrain.maxH },
    buildings: { file: 'buildings.bin.gz', count: bld.count, rings: bld.ringCount, vertices: bld.vertexCount, maxHeight },
    collision: { cell: COLLISION_CELL },
    ground: { file: 'ground.webp', loFile: 'ground-lo.webp', width: g.w, height: g.h, metresPerPixel: GROUND_MPP },
    minimap: { file: 'minimap.webp', width: mm.w, height: mm.h },
    landmarks,
    places,
    ...(Object.keys(detail).length ? { detail } : {}),
    files,
  };
  writeFileSync(resolve(PUBLIC_MAP_DIR, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(`meta: ${bld.count} buildings, ground ${g.w}x${g.h}, minimap ${mm.w}x${mm.h}, geo residual ${meta.geo.maxResidualM.toFixed(4)} m`);
  const water = loadWater().report;
  const lm = loadLandmarks().report;
  const pl = loadPlaces();
  const buildings = JSON.parse(readFileSync(resolve(WORK, 'buildings.json'), 'utf8'));
  ensure(WORK);
  writeFileSync(
    resolve(WORK, 'report.json'),
    JSON.stringify(
      {
        generatedAt: meta.generatedAt,
        osmBase,
        files,
        totalBytes: Object.values(files).reduce((s, f) => s + f.bytes, 0),
        water,
        buildings,
        landmarks: lm,
        ponsonbyRoad130: pl.ponsonby,
        debugImages: DEBUG_DIR,
      },
      null,
      1,
    ),
  );
  return meta;
}
