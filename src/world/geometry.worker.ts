/** Vite module worker: decode, extrude and build the collision grid off the main thread. */
import { type DetailInput, type DetailOutput, buildDetail, detailTransferables } from './buildDetail';
import { type BuildInput, buildWorld, transferables } from './buildWorld';

export type WorkerRequest = { type: 'build'; input: BuildInput } | { type: 'detail'; input: DetailInput };
export type WorkerResponse =
  | { type: 'done'; output: Awaited<ReturnType<typeof buildWorld>> }
  | { type: 'detail'; output: DetailOutput }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  postMessage(message: WorkerResponse): void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  try {
    if (ev.data.type === 'build') {
      const output = await buildWorld(ev.data.input);
      ctx.postMessage({ type: 'done', output } satisfies WorkerResponse, transferables(output));
    } else if (ev.data.type === 'detail') {
      const output = await buildDetail(ev.data.input);
      ctx.postMessage({ type: 'detail', output } satisfies WorkerResponse, detailTransferables(output));
    }
  } catch (e) {
    ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies WorkerResponse);
  }
};
