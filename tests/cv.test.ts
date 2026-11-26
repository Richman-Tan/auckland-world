import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { content } from '../src/content/index';
import { CV_FILE, CV_URL, SITE_URL } from '../src/content/links';
import { SANDFIELD_DENY } from '../src/content/rules';
import { latexFromInline, publicCvProblems, webCopyTex } from '../scripts/lib/cvWeb';
import { pdfText } from '../scripts/lib/pdfText';

/** A CV source shaped like the real one, with made-up details. */
const SAMPLE = String.raw`
\begin{document}
\begin{center}
    \textbf{\Huge Ada Example} \\
    Software Developer \\
    \small
    \href{mailto:ada@example.org}{ada@example.org} \hspace{1pt} $|$ \hspace{2pt} +00 11 222 3333
    \hspace{2pt} $|$ \hspace{2pt} \href{https://example.org/in/ada}{example.org/in/ada}
    % a comment about the row below
    \\ Citizen of Somewhere \hspace{2pt} $|$ \hspace{2pt} Relocating to Elsewhere \hspace{2pt} $|$ \hspace{2pt} Available February
\end{center}
\section{Experience}
  \resumeSubheadingTwoRoles
    {Sandfield}{Auckland, New Zealand}
    {Software Developer}{Nov 2026 - Present}
    {Software Engineering Intern}{Nov 2025 - Oct 2026}
    \resumeItemListStart
      \resumeItem{}
        {Built a secret thing used by \textbf{200+ engineers}.}
      \resumeItem{}
        {Handled \textbf{1,000+ security alerts} a week.}
    \resumeItemListEnd

  \resumeSubheading
    {Another Place}{Auckland, New Zealand}
    {Intern}{Nov 2024 - Feb 2025}
    \resumeItemListStart
      \resumeItem{}
        {Kept this bullet.}
    \resumeItemListEnd
\end{document}
`;

describe('the public copy of the CV: building it', () => {
  const { tex, notes } = webCopyTex(SAMPLE, ['Built tools in **C#/.NET** & more.', 'Did 100% of the **RAG** work.']);

  it('takes the phone number off the contact line and keeps the rest of it', () => {
    expect(tex).not.toContain('+00 11 222 3333');
    expect(tex).toContain(String.raw`\href{mailto:ada@example.org}{ada@example.org}`);
    expect(tex).toContain(String.raw`\href{https://example.org/in/ada}{example.org/in/ada}`);
  });

  it('drops the status row under the contact line', () => {
    expect(tex).not.toMatch(/Citizen|Relocating|Available February/);
    expect(tex).toContain(String.raw`\end{center}`);
  });

  it("replaces the Sandfield bullets with the site's wording, and only those", () => {
    expect(tex).not.toContain('200+ engineers');
    expect(tex).not.toContain('1,000+ security alerts');
    expect(tex).toContain(String.raw`{Built tools in \textbf{C\#/.NET} \& more.}`);
    expect(tex).toContain(String.raw`{Did 100\% of the \textbf{RAG} work.}`);
    // Titles and dates stay; the next job's bullets are untouched.
    expect(tex).toContain('{Software Developer}{Nov 2026 - Present}');
    expect(tex).toContain('{Kept this bullet.}');
    expect(tex.match(/\\resumeItemListStart/g)).toHaveLength(2);
    expect(tex.match(/\\resumeItemListEnd/g)).toHaveLength(2);
    expect(notes.join(' ')).toMatch(/replaced 2 Sandfield bullet/);
  });

  describe('when the CV lists two roles there, each with its own bullets', () => {
    // The layout the CV moved to: the current role and its bullets, then the earlier role and its own.
    const twoLists = (withMacro: boolean) =>
      (withMacro ? String.raw`\newcommand{\resumeSubheadingTwoRoles}[6]{}` : '') +
      SAMPLE.replace(
        /\\resumeSubheadingTwoRoles[\s\S]*?\\resumeItemListEnd/,
        String.raw`\resumeSubheading
    {Sandfield}{Auckland, New Zealand}
    {Software Developer}{Nov 2026 - Present}
    \resumeItemListStart
      \resumeItem{}
        {Upgraded the freight management system of a company with \textbf{10,000+ staff}.}
    \resumeItemListEnd
  \resumeRole
    {Software Engineering Intern}{Nov 2025 - Oct 2026}
    \resumeItemListStart
      \resumeItem{}
        {Built a secret thing used by \textbf{200+ engineers}.}
      \resumeItem{}
        {Handled \textbf{1,000+ security alerts} a week.}
    \resumeItemListEnd`,
      );

    it('replaces the bullets of both, and puts both roles under the one heading', () => {
      const out = webCopyTex(twoLists(true), ['Built tools in **C#/.NET** & more.']);
      for (const gone of ['200+ engineers', '1,000+ security alerts', '10,000+ staff', 'freight management']) expect(out.tex).not.toContain(gone);
      expect(out.tex).toContain(String.raw`{Built tools in \textbf{C\#/.NET} \& more.}`);
      // One heading carrying both titles and dates, and one list beneath it.
      expect(out.tex).toMatch(/\\resumeSubheadingTwoRoles\s*\{Sandfield\}\{Auckland, New Zealand\}\s*\{Software Developer\}\{Nov 2026 - Present\}\s*\{Software Engineering Intern\}\{Nov 2025 - Oct 2026\}\s*\\resumeItemListStart/);
      expect(out.tex).not.toContain(String.raw`\resumeRole`);
      // Sandfield's one list and the next employer's.
      expect(out.tex.match(/\\resumeItemListStart/g)).toHaveLength(2);
      expect(out.tex.match(/\\resumeItemListEnd/g)).toHaveLength(2);
      expect(out.tex).toContain('{Kept this bullet.}');
      expect(out.tex).toMatch(/\\resumeSubheading\s*\{Another Place\}/);
      expect(out.notes.join(' ')).toMatch(/replaced 3 Sandfield bullet\(s\) in 2 list\(s\)/);
      expect(out.notes.join(' ')).toMatch(/both Sandfield roles under one heading/);
    });

    it('keeps the earlier role as a title and dates when the CV has no heading for two', () => {
      const out = webCopyTex(twoLists(false), ['One line.']);
      expect(out.tex).not.toContain('200+ engineers');
      expect(out.tex).toMatch(/\{Software Developer\}\{Nov 2026 - Present\}\s*\\resumeRole\s*\{Software Engineering Intern\}\{Nov 2025 - Oct 2026\}\s*\\resumeItemListStart\s*\\resumeItem\{\}\s*\{One line\.\}/);
      expect(out.tex.match(/\\resumeItemListStart/g)).toHaveLength(2);
      expect(out.tex).toContain('{Kept this bullet.}');
    });
  });

  it('escapes LaTeX specials in site copy', () => {
    expect(latexFromInline('50% of A&B_C #1 {x} $5 ~ ^')).toBe(String.raw`50\% of A\&B\_C \#1 \{x\} \$5 \~{} \^{}`);
    expect(latexFromInline('**bold** and plain')).toBe(String.raw`\textbf{bold} and plain`);
  });

  it('refuses a source it cannot recognise rather than guessing', () => {
    expect(() => webCopyTex('no header here', [])).toThrow(/header/);
    expect(() => webCopyTex(String.raw`\begin{center}x\end{center} no employer`, [])).toThrow(/Sandfield/);
  });
});

describe('the public copy of the CV: the guard', () => {
  it('passes ordinary CV text, figures and dates included', () => {
    expect(publicCvProblems('Dean\'s Honours List (2023 & 2024): Top 5% of cohort. Nov 2024 - Feb 2025. 1,000+ registered users. 32/32. GPA 8.0/9')).toEqual([]);
  });

  it('names a phone number, the status row and every Sandfield detail the site keeps out', () => {
    expect(publicCvProblems('call +64 21 000 0000')).toHaveLength(1);
    expect(publicCvProblems('call 021 555 0199')).toHaveLength(1);
    expect(publicCvProblems('Relocating to Australia')).toHaveLength(2);
    expect(publicCvProblems('NZ Citizen (full work rights)')).toHaveLength(2);
    for (const d of SANDFIELD_DENY) expect(publicCvProblems(`we built ${d.toLowerCase()} there`).length, d).toBeGreaterThan(0);
  });
});

describe('reading a PDF back', () => {
  /** The smallest thing pdfText accepts: one Flate stream of text operators. */
  const pdf = (ops: string) => Buffer.concat([Buffer.from('%PDF-1.5\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'), deflateSync(Buffer.from(ops, 'latin1')), Buffer.from('\nendstream\nendobj\n')]);

  it('joins kerned pieces into words and wide gaps into spaces', () => {
    expect(pdfText(pdf('BT [(Ric)28(hman)-383(T)94(an)]TJ ET'))).toBe('Richman Tan');
    expect(pdfText(pdf('BT (one) Tj [(two)] TJ ET'))).toBe('one\ntwo');
  });

  it('spells out TeX ligatures, so a word with "fi" or "fl" in it can still be found', () => {
    expect(pdfText(pdf('BT [(Sand\\014eld)]TJ ET'))).toBe('Sandfield');
    expect(pdfText(pdf('BT [(V)83(eri\\014cation)-333(work\\015ow)-333(o\\013)]TJ ET'))).toBe('Verification workflow off');
  });

  it('undoes escaped brackets and skips streams that are not text', () => {
    expect(pdfText(pdf('BT [(\\(Honours\\))]TJ ET'))).toBe('(Honours)');
    expect(pdfText(Buffer.from('%PDF-1.5\nstream\nnot compressed at all\nendstream\n'))).toBe('');
  });
});

describe('the CV on the site', () => {
  const path = resolve(import.meta.dirname, '../public', CV_FILE);

  it('is linked from the contact links, at the site\'s own address', () => {
    const cv = content.profile.links.filter((l) => l.kind === 'cv');
    expect(cv).toHaveLength(1);
    expect(cv[0].href).toBe(CV_URL);
    expect(CV_URL).toBe(`${SITE_URL}/${CV_FILE}`);
    expect(existsSync(path)).toBe(true);
  });

  it('is a small one-document PDF that can be read back', () => {
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeLessThan(300 * 1024);
    const text = pdfText(bytes);
    // If these fail the reader is broken, and the checks below would pass for the wrong reason.
    expect(text).toContain(content.profile.name);
    expect(text).toContain('Sandfield');
    expect(text).toContain('Education');
  });

  it('has no phone number, no status row and no Sandfield detail in it', () => {
    expect(publicCvProblems(pdfText(readFileSync(path)))).toEqual([]);
  });

  it("describes Sandfield in the site's words", () => {
    const text = pdfText(readFileSync(path)).replace(/\s+/g, ' ');
    const page = content.stops.find((s) => s.id === 'work')!.briefing.find((p) => p.id === 'sandfield')!;
    const list = page.blocks.find((b) => b.type === 'list');
    expect(list?.type).toBe('list');
    if (list?.type !== 'list') return;
    for (const item of list.items) {
      // Compare letters only: bold runs and kerning put the spaces and punctuation in different places.
      const letters = (s: string) => s.replace(/\*\*/g, '').replace(/[^A-Za-z]/g, '');
      expect(letters(text), item).toContain(letters(item));
    }
  });
});
