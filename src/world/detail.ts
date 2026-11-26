/**
 * Loads the close-up detail: fetches its files and builds their geometry in the worker. This runs
 * after the city has been shown (WorldScene.startDetail), so nothing here can delay the first view,
 * and none of it is required: a file that is missing or fails just means less to see up close.
 */
import type { QualityTier } from '../shared/detail';
import { type MapMeta, type TerrainGrid, mapFileUrl } from '../shared/mapFormat';
import type { DetailOutput } from './buildDetail';
import type { WorkerRequest, WorkerResponse } from './geometry.worker';
import { fetchBytes } from './loader';

export function loadDetail(base: string, meta: MapMeta, terrain: TerrainGrid, quality: QualityTier): Promise<DetailOutput> {
  const files = meta.detail;
  if (!files?.roads) return Promise.resolve({});
  return fetchBytes(mapFileUrl(base, meta, files.roads.file), () => {}).then(
    (roads) =>
      new Promise<DetailOutput>((resolve, reject) => {
        const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
          worker.terminate();
          if (ev.data.type === 'detail') resolve(ev.data.output);
          else reject(new Error(ev.data.type === 'error' ? `detail worker: ${ev.data.message}` : 'detail worker: unexpected reply'));
        };
        worker.onerror = (ev) => {
          worker.terminate();
          reject(new Error(`detail worker failed: ${ev.message}`));
        };
        // The terrain is copied, not handed over: the main thread still needs it.
        const req: WorkerRequest = { type: 'detail', input: { roads, terrain, bounds: meta.bounds, quality } };
        worker.postMessage(req, [roads.buffer]);
      }),
  );
}
