/**
 * Pipeline configuration: the world rectangle, grid sizes, paths. The world rectangle is
 * aligned to the LINZ 1:10k tile grid, so exactly four DEM and four DSM tiles cover it.
 */
import { resolve } from 'node:path';
import type { Bounds } from '../src/shared/mapFormat';

export const REPO_ROOT = resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.AW_DATA_DIR ? resolve(process.env.AW_DATA_DIR) : resolve(REPO_ROOT, 'data');
export const PUBLIC_MAP_DIR = resolve(REPO_ROOT, 'public/map');
export const PUBLIC_FAKE_DIR = resolve(REPO_ROOT, 'public/map-fake');

/** NZTM2000 (EPSG:2193) world rectangle and local origin. */
export const WORLD = {
  originE: 1_757_200,
  originN: 5_920_400,
  minE: 1_753_600,
  maxE: 1_760_800,
  minN: 5_916_400,
  maxN: 5_924_400,
} as const;

/** The same rectangle in local metres (x = E - originE, z = -(N - originN)). */
export const BOUNDS: Bounds = {
  minX: WORLD.minE - WORLD.originE,
  maxX: WORLD.maxE - WORLD.originE,
  minZ: -(WORLD.maxN - WORLD.originN),
  maxZ: -(WORLD.minN - WORLD.originN),
};

export const TERRAIN_CELL = 20;
export const COLLISION_CELL = 6;
export const GROUND_MPP = 3;
export const GROUND_LO_MPP = 6;
export const MINIMAP_WIDTH = 512;

export const LINZ = {
  bucket: 'https://nz-elevation.s3.ap-southeast-2.amazonaws.com',
  collections: [
    'auckland/auckland-part-1_2024/dem_1m/2193',
    'auckland/auckland-part-1_2024/dsm_1m/2193',
    'auckland/auckland-part-2_2024/dem_1m/2193',
    'auckland/auckland-part-2_2024/dsm_1m/2193',
  ],
  expectedTiles: ['BA31_10000_0405', 'BA31_10000_0505', 'BA32_10000_0401', 'BA32_10000_0501'],
} as const;

export const ATTRIBUTION = [
  'Map data © OpenStreetMap contributors, ODbL (openstreetmap.org/copyright). Derived map data in /map/ is available under the ODbL.',
  'Elevation and building heights derived from the Auckland LiDAR 1m DEM & DSM (2024), Toitū Te Whenua LINZ, CC BY 4.0.',
];
