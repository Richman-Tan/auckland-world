/** STAC `file:checksum` values are multihashes: 0x12 (sha2-256), 0x20 (32 bytes), then the digest. */
export function parseMultihashSha256(mh: string): string {
  if (!/^[0-9a-f]+$/i.test(mh)) throw new Error(`Not a hex multihash: ${mh}`);
  if (!mh.toLowerCase().startsWith('1220')) throw new Error(`Unsupported multihash prefix: ${mh.slice(0, 4)}`);
  const digest = mh.slice(4).toLowerCase();
  if (digest.length !== 64) throw new Error(`Bad sha256 digest length ${digest.length}`);
  return digest;
}
