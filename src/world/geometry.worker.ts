/** Vite module worker: decode, extrude and build the collision grid off the main thread. */
import { type BuildInput, buildWorld, transferables } from './buildWorld';

export type WorkerRequest = { type: 'build'; input: BuildInput };
export type WorkerResponse =
  | { type: 'done'; output: Awaited<ReturnType<typeof buildWorld>> }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  postMessage(message: WorkerResponse): void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  if (ev.data.type !== 'build') return;
  try {
    const output = await buildWorld(ev.data.input);
    ctx.postMessage({ type: 'done', output } satisfies WorkerResponse, transferables(output));
  } catch (e) {
    ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies WorkerResponse);
  }
};
