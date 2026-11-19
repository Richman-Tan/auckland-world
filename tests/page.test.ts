import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { content } from '../src/content/index';
import { EMAIL, SITE_URL } from '../src/content/links';
import { homeFallbackHtml, inlineHtml, jsonLdScript, renderPageHtml, structuredData } from '../src/content/renderHtml';
import type { SiteContent } from '../src/content/types';

const file = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');

describe('renderPageHtml', () => {
  const html = renderPageHtml(content);
  it('has a skip link, one h1, an h2 per stop and an article per page', () => {
    expect(html).toContain('class="skip"');
    expect(html.match(/<h1>/g)).toHaveLength(1);
    for (const s of content.stops) {
      expect(html).toContain(`<section id="${s.id}"`);
      expect(html).toContain(`>${s.label}</h2>`);
    }
    const pages = content.stops.reduce((n, s) => n + s.briefing.length, 0);
    expect(html.match(/<article /g)).toHaveLength(pages);
    expect(html).toContain('href="/"');
    expect(html).toContain('id="credits"');
  });
  it('has no script tag', () => {
    expect(html).not.toMatch(/<script/i);
  });
  it('escapes everything and allows only bold and safe links', () => {
    expect(inlineHtml('<img src=x onerror=1> & "q"')).toBe('&lt;img src=x onerror=1&gt; &amp; &quot;q&quot;');
    expect(inlineHtml('**b** [a](https://x.nz/?a=1&b=2)')).toBe('<strong>b</strong> <a href="https://x.nz/?a=1&amp;b=2" rel="noopener noreferrer">a</a>');
    expect(inlineHtml('[bad](javascript:alert(1))')).not.toContain('<a');
    expect(inlineHtml('[bad](http://insecure.example)')).not.toContain('<a');
    const evil: SiteContent = { ...content, profile: { ...content.profile, name: '<script>alert(1)</script>' } };
    expect(renderPageHtml(evil)).not.toMatch(/<script/i);
  });
  it('renders the GPA as on the CV', () => {
    expect(html).toContain('8.0 / 9');
    expect(html).not.toContain('8.25');
  });
});

describe('what crawlers and script-less visitors get', () => {
  it('the home page fallback names the author and links every stop on the plain page', () => {
    const html = homeFallbackHtml(content);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain(`<h1>${content.profile.name}</h1>`);
    expect(html).toContain('href="/page/"');
    for (const s of content.stops) expect(html).toContain(`href="/page/#${s.id}"`);
    expect(html).not.toMatch(/<script/i);
    const evil: SiteContent = { ...content, profile: { ...content.profile, intro: '<img src=x onerror=1>' } };
    expect(homeFallbackHtml(evil)).not.toContain('<img');
  });

  it('the structured data describes the person with facts from the site, and no contact address', () => {
    const data = structuredData(content, SITE_URL) as { '@graph': Record<string, unknown>[] };
    const person = data['@graph'].find((n) => n['@type'] === 'Person')!;
    expect(person.name).toBe(content.profile.name);
    expect(person.jobTitle).toBe('Software Developer');
    expect(person.worksFor).toEqual({ '@type': 'Organization', name: 'Sandfield' });
    expect(person.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Auckland', addressCountry: 'New Zealand' });
    expect(person.url).toBe(`${SITE_URL}/`);
    const sameAs = person.sameAs as string[];
    expect(sameAs.length).toBeGreaterThanOrEqual(2);
    for (const url of sameAs) expect(url).toMatch(/^https:\/\//);
    const script = jsonLdScript(content, SITE_URL);
    expect(script).not.toContain(EMAIL);
    expect(script).not.toContain('mailto:');
    // It is valid JSON inside one script element, and content cannot close that element early.
    const body = script.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
    expect(() => JSON.parse(body)).not.toThrow();
    const evil: SiteContent = { ...content, profile: { ...content.profile, tagline: '</script><script>alert(1)</script>' } };
    expect(jsonLdScript(evil, SITE_URL).match(/<\/script>/g)).toHaveLength(1);
  });

  it('canonical links, the sitemap and robots.txt all use the one site address', () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+$/);
    const home = file('index.html');
    const page = file('page/index.html');
    expect(home).toContain(`<link rel="canonical" href="${SITE_URL}/" />`);
    expect(page).toContain(`<link rel="canonical" href="${SITE_URL}/page/" />`);
    for (const html of [home, page]) {
      expect(html).toContain(`content="${SITE_URL}/og.jpg"`);
      expect(html).toContain('<!--JSONLD-->');
    }
    expect(home).toContain('<!--HOME-->');
    const locs = [...file('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${SITE_URL}/`, `${SITE_URL}/page/`]);
    const robots = file('public/robots.txt');
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toMatch(/^Disallow: \/$/m);
  });
});
