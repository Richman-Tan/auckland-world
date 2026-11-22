/**
 * Just enough PDF reading to check what a pdfTeX-built document says, with no dependencies:
 * inflate every stream and collect the strings its text operators show. It is not a general PDF
 * text extractor (no font decoding), but pdfTeX's standard fonts keep letters, digits and "+" at
 * their ASCII codes, which is all the checks in cvWeb.ts need.
 */
import { inflateSync } from 'node:zlib';

/** A kerning adjustment more negative than this (thousandths of an em) is a space between words. */
const WORD_GAP = -150;

/**
 * TeX fonts draw "fi", "fl" and friends as single glyphs, at these codes in the OT1 (default) and
 * T1 encodings. Without putting the letters back, "Sandfield" reads as "Sand?eld" and a check for
 * a word containing one of these pairs would silently never match.
 */
const LIGATURES: Record<number, string> = {
  0x0b: 'ff', 0x0c: 'fi', 0x0d: 'fl', 0x0e: 'ffi', 0x0f: 'ffl',
  0x1b: 'ff', 0x1c: 'fi', 0x1d: 'fl', 0x1e: 'ffi', 0x1f: 'ffl',
};
const NAMED: Record<string, number> = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c };

/** A PDF literal string body as text: undo the escapes, then spell out the ligatures. */
function unescape(s: string): string {
  const raw = s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_m, e: string) => {
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    if (e in NAMED) return String.fromCharCode(NAMED[e]);
    if (e.startsWith('\n') || e.startsWith('\r')) return '';
    return e;
  });
  let out = '';
  for (const ch of raw) out += LIGATURES[ch.charCodeAt(0)] ?? ch;
  return out;
}

/** The text one content stream shows, one chunk per text-showing operator. */
function streamText(content: string): string[] {
  const out: string[] = [];
  // [ (Str) -333 (ing) ] TJ   or   (String) Tj
  const op = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  for (let m = op.exec(content); m; m = op.exec(content)) {
    if (m[2] !== undefined) {
      out.push(unescape(m[2]));
      continue;
    }
    let chunk = '';
    const part = /\(((?:[^()\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g;
    for (let p = part.exec(m[1]); p; p = part.exec(m[1])) {
      if (p[1] !== undefined) chunk += unescape(p[1]);
      else if (Number(p[2]) < WORD_GAP) chunk += ' ';
    }
    out.push(chunk);
  }
  return out;
}

/** All the text a PDF shows, chunks joined by newlines. Streams that are not Flate data are skipped. */
export function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = buf.indexOf('stream', at);
    if (start < 0) break;
    // The keyword is followed by CRLF or LF, then the data, then "endstream".
    let data = start + 6;
    if (buf[data] === 0x0d) data++;
    if (buf[data] === 0x0a) data++;
    const end = buf.indexOf('endstream', data);
    if (end < 0) break;
    at = end + 9;
    try {
      out.push(...streamText(inflateSync(buf.subarray(data, end)).toString('latin1')));
    } catch {
      // An image, a font program in another filter, or not a stream at all.
    }
  }
  return out.join('\n');
}
