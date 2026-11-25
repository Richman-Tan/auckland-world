/**
 * loadWorld: fetch the map, build geometry in a worker, assemble the low-res 3D world.
 * The main thread only fetches, wraps buffers and uploads; decoding, extrusion, terrain meshes
 * and the collision grid are done in geometry.worker.ts.
 */
import { Texture, NearestFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping } from 'three';
import type { LoadWorld, LoadWorldOptions, WorldScene } from '../app/contracts';
import { WorldSceneImpl } from '../render/worldScene';
import { createWorldQuery, landmarkColliders } from '../shared/collision';
import type { BuildOutput } from './buildWorld';
import type { WorkerRequest, WorkerResponse } from './geometry.worker';
import { ProgressTracker, fetchBytes, fetchMeta } from './loader';

export { createSkyDeck, type SkyDeck } from '../room/skyDeck';

function runWorker(req: WorkerRequest): Promise<BuildOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if (ev.data.type === 'done') resolve(ev.data.output);
      else reject(new Error(`geometry worker: ${ev.data.message}`));
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(`geometry worker failed: ${ev.message}`));
    };
    worker.postMessage(req, [req.input.terrain.buffer, req.input.buildings.buffer]);
  });
}

async function loadGround(url: string, onBytes: (n: number) => void): Promise<Texture> {
  const bytes = await fetchBytes(url, onBytes);
  const blob = new Blob([bytes as BlobPart], { type: 'image/webp' });
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = new Texture(bitmap);
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export const loadWorld: LoadWorld = async (opts: LoadWorldOptions): Promise<WorldScene> => {
  const base = opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`;
  const meta = await fetchMeta(base);
  const groundFile = opts.quality === 'low' ? meta.ground.loFile : meta.ground.file;
  const names = [meta.terrain.file, meta.buildings.file, groundFile];
  const totals = new Map<string, number>();
  for (const n of names) totals.set(n, meta.files[n]?.bytes ?? 0);
  const progress = new ProgressTracker(totals, opts.onProgress);
  progress.report(names[0], 0, 'Fetching the map');

  const [terrain, buildings, ground] = await Promise.all([
    fetchBytes(base + meta.terrain.file, (n) => progress.report(meta.terrain.file, n, 'Fetching terrain')),
    fetchBytes(base + meta.buildings.file, (n) => progress.report(meta.buildings.file, n, 'Fetching buildings')),
    loadGround(base + groundFile, (n) => progress.report(groundFile, n, 'Fetching ground')),
  ]);
  progress.enter('build', 'Building the city');

  const built = await runWorker({
    type: 'build',
    input: {
      terrain,
      buildings,
      bounds: meta.bounds,
      collisionCell: meta.collision.cell,
      waterLevel: meta.water.level,
      quality: opts.quality,
    },
  });

  const query = createWorldQuery(built.terrain, built.grid, landmarkColliders(meta), meta.bounds, meta.water.level);
  const world = new WorldSceneImpl({ canvas: opts.canvas, meta, query, quality: opts.quality, ground, built });
  progress.enter('compile', 'Compiling shaders');
  await world.warmUp();
  return world;
};
