/** Cache and work paths. DATA_DIR may be shared between checkouts via AW_DATA_DIR. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../config';

export const RAW_OSM = resolve(DATA_DIR, 'raw/osm');
export const RAW_LINZ = resolve(DATA_DIR, 'raw/linz');
export const STAC_DIR = resolve(RAW_LINZ, 'stac');
export const WORK = resolve(DATA_DIR, 'work');
export const DEBUG_DIR = resolve(WORK, 'debug');

export function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
