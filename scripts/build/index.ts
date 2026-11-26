/** npm run map:build [-- --stage=water,terrain,...]. Stages read earlier outputs from data/work and public/map. */
import { mkdirSync } from 'node:fs';
import { PUBLIC_MAP_DIR } from '../config';
import { ensure, WORK } from '../lib/paths';
import { buildWater, loadWater } from './water';
import { buildTerrain } from './terrain';
import { buildLandmarks } from './landmarks';
import { buildPlaces } from './places';
import { buildBuildings } from './buildings';
import { buildGround } from './ground';
import { buildRoads } from './roads';
import { buildMinimap } from './minimap';
import { buildMeta } from './meta';

const ORDER = ['water', 'terrain', 'landmarks', 'places', 'buildings', 'roads', 'ground', 'minimap', 'meta'] as const;
type Stage = (typeof ORDER)[number];

const arg = process.argv.find((a) => a.startsWith('--stage='));
const wanted: Stage[] = arg ? (arg.slice(8).split(',') as Stage[]) : [...ORDER];
for (const s of wanted) if (!ORDER.includes(s)) throw new Error(`Unknown stage ${s}; stages: ${ORDER.join(', ')}`);

ensure(WORK);
mkdirSync(PUBLIC_MAP_DIR, { recursive: true });

for (const stage of ORDER) {
  if (!wanted.includes(stage)) continue;
  const t0 = Date.now();
  console.log(`== stage ${stage}`);
  switch (stage) {
    case 'water':
      await buildWater();
      break;
    case 'terrain':
      await buildTerrain(loadWater().mask);
      break;
    case 'landmarks':
      await buildLandmarks();
      break;
    case 'places':
      buildPlaces();
      break;
    case 'buildings':
      await buildBuildings();
      break;
    case 'roads':
      await buildRoads();
      break;
    case 'ground':
      await buildGround();
      break;
    case 'minimap':
      await buildMinimap();
      break;
    case 'meta':
      buildMeta();
      break;
  }
  console.log(`== ${stage} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
