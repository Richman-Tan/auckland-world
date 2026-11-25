/**
 * Where the first load has got to, as one figure and a few words. Pure.
 *
 * The map files are most of the wait and report real bytes, so they get most of the bar. The two
 * steps after them (building the city's geometry, then compiling its shaders) report no progress of
 * their own, so the bar holds at a mark for each rather than pretending to move.
 */
import type { LoadProgress } from '../app/contracts';

/** How much of the bar the download takes, and where it stands during the two steps after it. */
export const DOWNLOAD_SHARE = 0.86;
export const COMPILE_MARK = 0.94;

export interface LoadStage {
  /** 0 to 1. */
  fraction: number;
  /** A few words in sentence case: "Fetching the map". */
  label: string;
  /** Megabytes so far while fetching, otherwise ''. */
  detail: string;
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

export function loadStage(p: LoadProgress): LoadStage {
  if (p.stage === 'compile') return { fraction: COMPILE_MARK, label: 'Compiling shaders', detail: '' };
  if (p.stage === 'build') return { fraction: DOWNLOAD_SHARE, label: 'Building the city', detail: '' };
  if (!(p.totalBytes > 0)) return { fraction: 0, label: 'Fetching the map', detail: '' };
  const got = Math.min(1, Math.max(0, p.loadedBytes / p.totalBytes));
  // One label for all three files: they arrive together, and naming whichever reported last flickers.
  return { fraction: got * DOWNLOAD_SHARE, label: 'Fetching the map', detail: `${mb(p.loadedBytes)} of ${mb(p.totalBytes)} MB` };
}
