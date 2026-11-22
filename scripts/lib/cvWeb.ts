/**
 * The public copy of the CV. The CV sent to employers carries things the site deliberately does
 * not publish, so the copy linked from the site is rebuilt from the LaTeX source with three edits:
 *
 *   1. the phone number comes off the contact line;
 *   2. the status row under it (citizenship, work rights, relocation, availability) is dropped;
 *   3. the Sandfield bullets are replaced with the site's own capability-level wording, because
 *      the site names no metrics, products or internal projects (see src/content/rules.ts).
 *
 * The edits are best effort: a CV whose layout has changed may slip past them. publicCvProblems is
 * the real guard. It reads the finished PDF's text and names anything that should not be there;
 * the build script refuses to publish, and a test fails, unless it comes back empty.
 */
import { SANDFIELD_DENY } from '../../src/content/rules';

export interface WebCopy {
  tex: string;
  /** What was changed, for the script's log. */
  notes: string[];
}

/** Site copy (plain text with **bold**) as LaTeX. */
export function latexFromInline(text: string): string {
  const escaped = text.replace(/[\\{}#$%&_^~]/g, (c) => {
    if (c === '\\') return '\\textbackslash{}';
    if (c === '^') return '\\^{}';
    if (c === '~') return '\\~{}';
    return `\\${c}`;
  });
  return escaped.replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}');
}

export function webCopyTex(source: string, sandfieldItems: readonly string[]): WebCopy {
  const notes: string[] = [];
  let tex = source;

  // 1. Phone number: everything after the email link on its line, when that tail holds a "+number".
  const phone = /^([ \t]*\\href\{mailto:[^}\n]*\}\{[^}\n]*\})[^\n]*\+[\d ]{6,}[^\n]*$/m;
  if (phone.test(tex)) {
    tex = tex.replace(phone, '$1');
    notes.push('removed the phone number from the contact line');
  } else {
    notes.push('no phone number found on the contact line');
  }

  // 2. Status row: any extra row in the header block, i.e. a line there that starts with "\\".
  const header = /\\begin\{center\}[\s\S]*?\\end\{center\}/.exec(tex);
  if (!header) throw new Error('cv: no \\begin{center} header block found');
  const rows = header[0].match(/^[ \t]*\\\\[ \t]+\S.*\n/gm) ?? [];
  if (rows.length) {
    tex = tex.replace(header[0], header[0].replace(/^[ \t]*\\\\[ \t]+\S.*\n/gm, ''));
    notes.push(`removed ${rows.length} status row(s) under the contact line`);
  } else {
    notes.push('no status row found under the contact line');
  }

  // 3. Sandfield: swap the bullets under its heading for the site's wording.
  const heading = tex.indexOf('{Sandfield}');
  if (heading < 0) throw new Error('cv: no {Sandfield} heading found');
  const start = tex.indexOf('\\resumeItemListStart', heading);
  const end = tex.indexOf('\\resumeItemListEnd', start);
  if (start < 0 || end < 0) throw new Error('cv: no bullet list found under the Sandfield heading');
  const before = (tex.slice(start, end).match(/\\resumeItem\b/g) ?? []).length;
  const items = sandfieldItems.map((i) => `      \\resumeItem{}\n        {${latexFromInline(i)}}\n`).join('');
  tex = `${tex.slice(0, start)}\\resumeItemListStart\n${items}    ${tex.slice(end)}`;
  notes.push(`replaced ${before} Sandfield bullet(s) with the site's ${sandfieldItems.length}`);

  return { tex, notes };
}

/** Words that only appear in the status row. A guard for this CV, not a general filter. */
const STATUS_WORDS = ['relocat', 'citizen', 'work rights', 'australia', 'available feb'];

/**
 * Everything in a CV's text that must not be on the public site. Empty means it may be published.
 * `text` is what scripts/lib/pdfText.ts reads out of the PDF.
 */
export function publicCvProblems(text: string): string[] {
  const problems: string[] = [];
  const flat = text.replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  if (/\+\d/.test(flat) || /\b\d{2,4}[ -]\d{3}[ -]\d{3,4}\b/.test(flat)) problems.push('something that looks like a phone number');
  for (const w of STATUS_WORDS) if (lower.includes(w)) problems.push(`the status row ("${w}")`);
  for (const d of SANDFIELD_DENY) if (lower.includes(d.toLowerCase())) problems.push(`a Sandfield detail the site does not publish ("${d}")`);
  return problems;
}
