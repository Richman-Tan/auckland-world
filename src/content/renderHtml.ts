/**
 * Pure SiteContent -> HTML. Used for the prerendered read-as-page view (/page/) and, for blocks,
 * by the briefing dialog. Everything is escaped; the only markup a text string can produce is
 * <strong> from **bold** and <a> from [label](https://...) or [label](mailto:...).
 */
import type { Block, Link, Page, SiteContent, Stop } from './types';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only https: and mailto: ever become an href. */
export function safeHref(href: string): string | null {
  return /^(https:\/\/|mailto:)/i.test(href) ? href : null;
}

export interface RenderOptions {
  /** Open external links in a new tab (used inside the 3D app so the flight is not lost). */
  newTab?: boolean;
}

function linkAttrs(href: string, opts: RenderOptions): string {
  const external = href.startsWith('https:');
  return `href="${esc(href)}"${external && opts.newTab ? ' target="_blank"' : ''}${external ? ' rel="noopener noreferrer"' : ''}`;
}

/** Escape, then render **bold** and [label](url). */
export function inlineHtml(text: string, opts: RenderOptions = {}): string {
  let out = esc(text);
  out = out.replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)\s]+)\)/g, (_m, label: string, href: string) => {
    // href was escaped with the rest; undo only for the safety check.
    const raw = href.replace(/&amp;/g, '&');
    return safeHref(raw) ? `<a ${linkAttrs(raw, opts)}>${label}</a>` : label;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

export function linksHtml(links: Link[], opts: RenderOptions = {}): string {
  const items = links
    .map((l) => ({ l, href: safeHref(l.href) }))
    .filter((x): x is { l: Link; href: string } => x.href !== null)
    .map(({ l, href }) => `<li><a class="${l.primary ? 'btn primary' : 'btn'}" ${linkAttrs(href, opts)}>${esc(l.label)}</a></li>`)
    .join('');
  return items ? `<ul class="links">${items}</ul>` : '';
}

export function blockHtml(b: Block, opts: RenderOptions = {}): string {
  switch (b.type) {
    case 'text':
      return `<p>${inlineHtml(b.text, opts)}</p>`;
    case 'list':
      return `<ul>${b.items.map((i) => `<li>${inlineHtml(i, opts)}</li>`).join('')}</ul>`;
    case 'facts':
      return `<dl class="facts">${b.items.map((i) => `<div><dt>${esc(i.label)}</dt><dd>${inlineHtml(i.value, opts)}</dd></div>`).join('')}</dl>`;
    case 'tags':
      return `<ul class="tags" aria-label="Technologies">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'media': {
      const m = b.media;
      return `<figure><img src="${esc(m.src)}" alt="${esc(m.alt)}" width="${Math.round(m.width)}" height="${Math.round(m.height)}" loading="lazy" decoding="async">${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ''}</figure>`;
    }
    case 'links':
      return linksHtml(b.links, opts);
  }
}

export function blocksHtml(blocks: Block[], opts: RenderOptions = {}): string {
  return blocks.map((b) => blockHtml(b, opts)).join('\n');
}

function pageHtml(stop: Stop, p: Page): string {
  const hid = `${stop.id}-${p.id}`;
  return `<article id="${esc(hid)}" aria-labelledby="${esc(hid)}-h">
<h3 id="${esc(hid)}-h">${esc(p.title)}</h3>
${p.subtitle ? `<p class="subtitle">${esc(p.subtitle)}</p>` : ''}
${p.period ? `<p class="period">${esc(p.period)}</p>` : ''}
${blocksHtml(p.blocks, { newTab: false })}
</article>`;
}

function stopHtml(s: Stop): string {
  return `<section id="${esc(s.id)}" aria-labelledby="${esc(s.id)}-title">
<h2 id="${esc(s.id)}-title">${esc(s.label)}</h2>
<p class="place">${esc(s.place)} · ${esc(s.pitch)}</p>
${s.briefing.map((p) => pageHtml(s, p)).join('\n')}
</section>`;
}

export function renderPageHtml(c: SiteContent): string {
  const p = c.profile;
  const nav = c.stops.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.label)}</a></li>`).join('');
  const credits = c.credits
    .map((cr) => {
      const href = cr.href ? safeHref(cr.href) : null;
      return `<li><strong>${esc(cr.label)}.</strong> ${href ? `<a href="${esc(href)}" rel="noopener noreferrer">${esc(cr.text)}</a>` : esc(cr.text)}</li>`;
    })
    .join('');
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<h1>${esc(p.name)}</h1>
<p class="title">${esc(p.title)}</p>
<p class="location">${esc(p.location)}</p>
<p class="tagline">${esc(p.tagline)}</p>
${linksHtml(p.links)}
<p class="fly"><a class="btn fly-link" href="/">Fly it instead</a></p>
<nav aria-label="Sections"><ul class="toc">${nav}</ul></nav>
</header>
<main id="main">
<p class="intro">${esc(p.intro)}</p>
${c.stops.map(stopHtml).join('\n')}
</main>
<footer id="credits">
<h2>Credits</h2>
<ul>${credits}</ul>
<p><a href="/">Fly over Auckland</a> · <a href="#main">Back to top</a></p>
</footer>`;
}

/* ---------------------------------------------------------- for crawlers */

const sentenceCase = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();

/**
 * What the flight's own page says with JavaScript off: who this is, what the site is, and a link
 * to every stop on the plain page. It goes inside <noscript> in index.html, so visitors and
 * crawlers that do not run scripts get real content instead of an empty canvas.
 */
export function homeFallbackHtml(c: SiteContent): string {
  const p = c.profile;
  const stops = c.stops
    .map((s) => `<li><a href="/page/#${esc(s.id)}">${esc(sentenceCase(s.label))}</a>: ${esc(s.place)}. ${esc(s.pitch)}.</li>`)
    .join('\n');
  return `<div class="aw-noscript">
<h1>${esc(p.name)}</h1>
<p>${esc(p.title)}. ${esc(p.location)}.</p>
<p>${esc(p.intro)}</p>
<p>The flight needs JavaScript. Everything it says is also on <a href="/page/">one plain page</a>:</p>
<ul>
${stops}
</ul>
${linksHtml(p.links)}
</div>`;
}

/**
 * schema.org description of the site and its author, for search engines. Only facts already on the
 * site: name, role, employer, city and the public profile links. Contact addresses are left out.
 */
/** "Software Developer · Somewhere" without the somewhere. */
export function jobTitle(title: string): string {
  return title.split(' · ')[0];
}

export function structuredData(c: SiteContent, siteUrl: string): Record<string, unknown> {
  const p = c.profile;
  const employer = p.title.split(' · ')[1];
  const [locality, country] = p.location.split(', ');
  const person: Record<string, unknown> = {
    '@type': 'Person',
    '@id': `${siteUrl}/#person`,
    name: p.name,
    url: `${siteUrl}/`,
    description: p.tagline,
    jobTitle: jobTitle(p.title),
    // Profiles elsewhere, not every link: the CV is a document, and email is left out on purpose.
    sameAs: p.links.filter((l) => l.kind === 'social').map((l) => l.href),
  };
  if (employer) person.worksFor = { '@type': 'Organization', name: employer };
  if (locality) person.address = { '@type': 'PostalAddress', addressLocality: locality, ...(country ? { addressCountry: country } : {}) };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: `${siteUrl}/`, name: p.name, inLanguage: 'en-NZ', author: { '@id': `${siteUrl}/#person` } },
      person,
    ],
  };
}

/** The structured data as a script element. "<" is escaped so no content can close the element early. */
export function jsonLdScript(c: SiteContent, siteUrl: string): string {
  return `<script type="application/ld+json">${JSON.stringify(structuredData(c, siteUrl)).replace(/</g, '\\u003c')}</script>`;
}
