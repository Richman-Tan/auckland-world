/**
 * npm run check:bundle: run after `npm run build`. Checks what each page downloads before the visitor
 * does anything: the title page must not pull in three.js or the map code (they load in the
 * background), /page/ must work without the 3D code at all, and both stay inside their size budgets.
 * Exits non-zero on any failure.
 *
 * "Downloads up front" means the page's module scripts and modulepreloads plus everything they import
 * statically. Lazy `import("./x.js")` chunks are not counted, and neither is the preload table Vite
 * writes into the entry (it names three.js as a string, which is why a plain text search won't do).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';
import { REPO_ROOT } from '../config';
import { htmlModules, resolveSpecifier, staticImports } from '../lib/bundle';

/** AW_DIST points the check at another build folder (used to test that it fails when it should). */
const DIST = process.env.AW_DIST ?? join(REPO_ROOT, 'dist');
/** From the plan: the title page's JavaScript, gzipped. */
const ENTRY_JS_BUDGET = 250 * 1024;
/** The Sky Deck's four screen loops (downloaded on the first visit only). */
const SKYDECK_MEDIA_BUDGET = 2 * 1024 * 1024;
/**
 * Strings only three.js contains: a chunk with these is three.js whatever its name. Known limit: a
 * small chunk holding a few three.js helpers (say Vector3 only) has neither these nor, in theory, the
 * three.module file name; Rollup names such chunks after three.module, and the size budget backs it up.
 */
const THREE_MARKERS = ['WebGLRenderer', 'WebGL2RenderingContext'];

const results: { ok: boolean }[] = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const gz = (buf: Buffer) => gzipSync(buf, { level: 9 }).length;

/** Every file a page loads up front: its entry modules and their static imports, transitively. */
function upFront(pagePath: string): { files: string[]; missing: string[] } {
  const html = readFileSync(join(DIST, pagePath), 'utf8');
  const seen = new Set<string>();
  const missing: string[] = [];
  const queue = htmlModules(html).map((src) => resolveSpecifier(pagePath, src));
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const file = join(DIST, rel);
    if (!existsSync(file)) {
      missing.push(rel);
      continue;
    }
    for (const spec of staticImports(readFileSync(file, 'utf8'))) queue.push(resolveSpecifier(rel, spec));
  }
  return { files: [...seen].filter((f) => !missing.includes(f)), missing };
}

function isThree(rel: string): boolean {
  if (/three(\.module)?[-.]/.test(posix.basename(rel))) return true;
  const code = readFileSync(join(DIST, rel), 'utf8');
  return THREE_MARKERS.some((m) => code.includes(m));
}

function main(): void {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('No dist/ build found. Run `npm run build` first.');
    process.exit(1);
  }

  // The 3D code must exist somewhere, or the "not up front" checks below prove nothing.
  const assets = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
  const threeChunks = assets.filter((f) => isThree(`assets/${f}`));
  check('three.js is built as its own chunk', threeChunks.length > 0, threeChunks.join(', ') || 'none found');

  // Title page.
  const title = upFront('index.html');
  // The title page always has an entry script; finding none means the HTML was not parsed.
  check('title page entry script found', title.files.length + title.missing.length > 0, `${title.files.length + title.missing.length} module file(s)`);
  check('title page modules all exist', title.missing.length === 0, title.missing.join(', ') || `${title.files.length} file(s)`);
  const titleThree = title.files.filter(isThree);
  check('title page does not load three.js up front', titleThree.length === 0, titleThree.join(', ') || title.files.join(', '));
  const titleJs = title.files.filter((f) => f.endsWith('.js')).reduce((n, f) => n + gz(readFileSync(join(DIST, f))), 0);
  check('title page JavaScript within budget', titleJs <= ENTRY_JS_BUDGET, `${kb(titleJs)} gzipped of ${kb(ENTRY_JS_BUDGET)}`);

  // Read-as-page.
  const page = upFront('page/index.html');
  check('/page/ modules all exist', page.missing.length === 0, page.missing.join(', ') || `${page.files.length} file(s)`);
  const pageThree = page.files.filter(isThree);
  check('/page/ never loads three.js', pageThree.length === 0, pageThree.join(', ') || `${page.files.length} script file(s), none of them three.js`);

  // Sky Deck media.
  const mediaDir = join(DIST, 'media', 'skydeck');
  const media = existsSync(mediaDir) ? readdirSync(mediaDir).map((f) => statSync(join(mediaDir, f)).size) : [];
  const mediaTotal = media.reduce((a, b) => a + b, 0);
  check('Sky Deck videos within budget', media.length > 0 && mediaTotal <= SKYDECK_MEDIA_BUDGET, `${media.length} file(s), ${kb(mediaTotal)} of ${kb(SKYDECK_MEDIA_BUDGET)}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll bundle checks passed.');
  process.exit(failed ? 1 : 0);
}

main();
