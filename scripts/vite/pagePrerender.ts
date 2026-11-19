/**
 * Prerenders content into the two HTML entry points from the same source as the 3D world:
 *
 *   <!--PAGE-->    in page/index.html: the whole read-as-page view, so it works without JavaScript
 *                  and never loads three.js.
 *   <!--HOME-->    in index.html, inside <noscript>: who this is and a link to every stop.
 *   <!--JSONLD-->  in both heads: schema.org data about the site and its author.
 *
 * The rendering itself is in src/content/renderHtml.ts.
 */
import type { Plugin } from 'vite';

export function pagePrerender(): Plugin {
  return {
    name: 'aw-page-prerender',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        if (!/<!--(PAGE|HOME|JSONLD)-->/.test(html)) return html;
        const { homeFallbackHtml, jsonLdScript, renderPageHtml } = await import('../../src/content/renderHtml');
        const { content } = await import('../../src/content/index');
        const { SITE_URL } = await import('../../src/content/links');
        return html
          .replace('<!--PAGE-->', () => renderPageHtml(content))
          .replace('<!--HOME-->', () => homeFallbackHtml(content))
          .replace('<!--JSONLD-->', () => jsonLdScript(content, SITE_URL));
      },
    },
  };
}
