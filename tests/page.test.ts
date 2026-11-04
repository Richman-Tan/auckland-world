import { describe, expect, it } from 'vitest';
import { content } from '../src/content/index';
import { inlineHtml, renderPageHtml } from '../src/content/renderHtml';
import type { SiteContent } from '../src/content/types';

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
