/**
 * Builds the public copy of the CV into public/ from the LaTeX source:
 *
 *   npm run cv:web -- ~/Documents/cv/cv.tex
 *
 * See scripts/lib/cvWeb.ts for what is taken out and why. The source file and its folder are only
 * read; the build happens in a temporary directory. Needs latexmk (TeX Live or MacTeX).
 * Nothing is published unless the finished PDF passes publicCvProblems and fits on one page.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CV_FILE } from '../../src/content/links';
import { workPages } from '../../src/content/work';
import { publicCvProblems, webCopyTex } from '../lib/cvWeb';
import { pdfText } from '../lib/pdfText';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: npm run cv:web -- <path to cv.tex>');
  process.exit(2);
}
const source = resolve(arg.replace(/^~(?=\/)/, homedir()));

const sandfield = workPages.find((p) => p.id === 'sandfield');
const list = sandfield?.blocks.find((b) => b.type === 'list');
if (!list || list.type !== 'list') throw new Error('cv: the site has no Sandfield bullet list to use');

const { tex, notes } = webCopyTex(readFileSync(source, 'utf8'), list.items);
for (const n of notes) console.log(`  ${n}`);

const dir = mkdtempSync(join(tmpdir(), 'aw-cv-'));
try {
  writeFileSync(join(dir, 'cv-web.tex'), tex);
  try {
    execFileSync('latexmk', ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'cv-web.tex'], { cwd: dir, stdio: 'pipe' });
  } catch (err) {
    const out = (err as { stdout?: Buffer }).stdout?.toString() ?? '';
    console.error(out.split('\n').slice(-25).join('\n'));
    throw new Error('cv: latexmk failed (is TeX Live installed?)');
  }
  const pdf = readFileSync(join(dir, 'cv-web.pdf'));
  const text = pdfText(pdf);
  if (!text.includes('Sandfield')) throw new Error('cv: could not read the built PDF back, so it cannot be checked');
  const problems = publicCvProblems(text);
  if (problems.length) throw new Error(`cv: not publishing, the PDF still contains:\n  ${problems.join('\n  ')}`);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
  const log = readFileSync(join(dir, 'cv-web.log'), 'latin1');
  const logged = /Output written on [^\n]*\((\d+) pages?/.exec(log);
  const pageCount = logged ? Number(logged[1]) : pages;
  if (pageCount !== 1) throw new Error(`cv: the web copy is ${pageCount} pages; it must fit on one`);
  const out = resolve(import.meta.dirname, '../../public', CV_FILE);
  copyFileSync(join(dir, 'cv-web.pdf'), out);
  console.log(`wrote ${out} (${(pdf.length / 1024).toFixed(0)} KB, 1 page)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
