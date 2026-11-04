/** Pure SiteContent -> HTML for the read-as-page view. M4 replaces this minimal version. */
import type { SiteContent } from './types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderPageHtml(c: SiteContent): string {
  const sections = c.stops
    .map((s) => `<section id="${s.id}"><h2>${esc(s.label)}</h2>${s.briefing.map((p) => `<article><h3>${esc(p.title)}</h3></article>`).join('')}</section>`)
    .join('\n');
  return `<main><h1>${esc(c.profile.name)}</h1><p>${esc(c.profile.title)}</p>${sections}</main>`;
}
