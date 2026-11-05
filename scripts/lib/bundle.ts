/** Parsing helpers for scripts/check/bundle.ts (kept separate so tests can import them). */
import { posix } from 'node:path';

/** Attributes of one HTML tag, lower-cased names; quoted, unquoted and bare attributes all count. */
function attrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * What an HTML page loads as modules: paths of module scripts and modulepreloads (in any attribute
 * order, quoted or not), plus the static imports written inside inline module scripts.
 */
export function htmlModules(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) {
    const a = attrs(m[1]);
    if (a.get('type')?.toLowerCase() !== 'module') continue;
    const src = a.get('src');
    if (src) out.push(src);
    else out.push(...staticImports(m[2]));
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = a.get('href');
    if (rel.includes('modulepreload') && href) out.push(href);
  }
  return out;
}

/**
 * Specifiers a chunk imports statically: `import ... from "x"`, `import "x"`, `export ... from "x"`,
 * for relative ("./", "../") and site-absolute ("/assets/...") paths. Lazy `import("x")` never matches:
 * after `import` the pattern needs a quote or a binding list, not `(`.
 */
export function staticImports(code: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:import|export)\s*(?:[\w$*\s{},]*?\bfrom\s*)?["']((?:\.{1,2})?\/[^"']+)["']/g;
  for (const m of code.matchAll(re)) out.add(m[1]);
  return [...out];
}

/**
 * A specifier found in `fromRel` (a dist-relative file path; for an HTML page, the page's own path)
 * as a dist-relative path. Site-absolute paths start at dist; query strings and hashes are dropped.
 */
export function resolveSpecifier(fromRel: string, spec: string): string {
  const clean = spec.split(/[?#]/)[0];
  if (clean.startsWith('/')) return posix.normalize(clean.slice(1));
  return posix.normalize(posix.join(posix.dirname(fromRel), clean));
}
