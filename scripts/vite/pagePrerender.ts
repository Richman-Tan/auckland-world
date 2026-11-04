/**
 * Prerenders /page/ from the same content as the 3D world, so the plain version works without
 * JavaScript and never loads three.js. M4 owns this file and src/content/renderHtml.ts.
 */
import type { Plugin } from 'vite';

export function pagePrerender(): Plugin {
  return {
    name: 'aw-page-prerender',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        if (!ctx.path.endsWith('/page/index.html') && !ctx.filename.endsWith('page/index.html')) return html;
        const { renderPageHtml } = await import('../../src/content/renderHtml');
        const { content } = await import('../../src/content/index');
        return html.replace('<!--PAGE-->', renderPageHtml(content));
      },
    },
  };
}
