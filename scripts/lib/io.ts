/** File helpers for the pipeline. */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FileEntry } from '../../src/shared/mapFormat';

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function writeFile(path: string, bytes: Uint8Array | string): FileEntry {
  mkdirSync(dirname(path), { recursive: true });
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  writeFileSync(path, buf);
  return { bytes: buf.byteLength, sha256: sha256(buf) };
}

/** Gzip at level 9 and write. Returns the size and hash of the file as served. */
export function writeGz(path: string, bytes: Uint8Array): FileEntry {
  return writeFile(path, gzipSync(bytes, { level: 9 }));
}
