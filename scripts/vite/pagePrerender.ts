/**
 * Prerenders content into the two HTML entry points from the same source as the 3D world:
 *
 *   <!--PAGE-->    in page/index.html: the whole read-as-page view, so it works without JavaScript
 *                  and never loads three.js.
 *   <!--HOME-->    in index.html, inside <noscript>: who this is and a link to every stop.
 *   <!--TITLE-->   in index.html: the landing screen itself, so it is painted from the first
 *                  response and the script only has to take it over (src/ui/views/title.ts).
 *   <!--BOOT-->    in index.html's head: the few lines that must run before that first paint.
 *   <!--JSONLD-->  in both heads: schema.org data about the site and its author.
 *
 * The rendering itself is in src/content/renderHtml.ts and src/ui/views/titleHtml.ts.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Ties the home page to the map it was built with: the preload of meta.json and the address the
 * script fetches (src/world/loader.ts reads data-map-version) both carry the file's hash, so a
 * deploy that changes the map is picked up at once rather than when a cached copy expires.
 */
export function withMapVersion(html: string, version: string | null): string {
  if (!version || !html.includes('href="/map/meta.json"')) return html;
  return html.replace('href="/map/meta.json"', `href="/map/meta.json?v=${version}"`).replace(/<html([^>]*)>/, `<html$1 data-map-version="${version}">`);
}

function mapVersion(): string | null {
  const file = resolve(import.meta.dirname, '../../public/map/meta.json');
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12) : null;
}

/**
 * Runs before the first paint, so the prerendered title is drawn at the size and in the state the
 * script will want: the pixel scale (the same rule as src/shared/pixelScale.ts, which a test holds
 * it to), and a mark on links that open a stop directly, whose first view is not the title.
 */
export function bootScript(targetHeight: number): string {
  return `<script>(function(d){d.style.setProperty('--px',Math.max(2,Math.round(innerHeight/${targetHeight})));if(/[?&]stop=/.test(location.search))d.classList.add('aw-deep')})(document.documentElement)</script>`;
}

export function pagePrerender(): Plugin {
  return {
    name: 'aw-page-prerender',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        html = withMapVersion(html, mapVersion());
        if (!/<!--(PAGE|HOME|TITLE|BOOT|JSONLD)-->/.test(html)) return html;
        const { homeFallbackHtml, jsonLdScript, renderPageHtml } = await import('../../src/content/renderHtml');
        const { titleHtml } = await import('../../src/ui/views/titleHtml');
        const { TARGET_HEIGHT } = await import('../../src/shared/pixelScale');
        const { content } = await import('../../src/content/index');
        const { SITE_URL } = await import('../../src/content/links');
        return html
          .replace('<!--PAGE-->', () => renderPageHtml(content))
          .replace('<!--HOME-->', () => homeFallbackHtml(content))
          .replace('<!--TITLE-->', () => titleHtml(content))
          .replace('<!--BOOT-->', () => bootScript(TARGET_HEIGHT))
          .replace('<!--JSONLD-->', () => jsonLdScript(content, SITE_URL));
      },
    },
  };
}
