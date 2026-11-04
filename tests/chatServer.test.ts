import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, siteLinks } from '../src/chat/prompt';
import { CHAT_MODEL, createChatHandler, isSiteOrigin, parseTurns, tidyAnswer } from '../src/chat/server';
import { content } from '../src/content';
import { siteModule } from '../scripts/chat/site';
import { readFileSync } from 'node:fs';

const ORIGIN = 'https://richmantan.vercel.app';
const okMessage = (text: string, stop = 'end_turn') => ({
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }],
  stop_reason: stop,
  usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
});

function setup(create = vi.fn(async () => okMessage('I build software across web, mobile and AI.')), extra = {}) {
  const handler = createChatHandler({
    client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
    system: 'SYSTEM',
    isAllowedOrigin: isSiteOrigin,
    allowedLinks: siteLinks(content),
    log: () => {},
    ...extra,
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handler(new Request('https://richmantan.vercel.app/api/chat', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
  return { handler, create, post };
}
const ask = (text: string) => ({ messages: [{ role: 'user', text }] });

describe('chat endpoint', () => {
  it('reports enabled on GET, and disabled with no client', async () => {
    const { handler } = setup();
    expect(await (await handler(new Request('https://x/api/chat'))).json()).toEqual({ enabled: true });
    const off = createChatHandler({ client: null, system: '', isAllowedOrigin: isSiteOrigin, allowedLinks: new Set(), log: () => {} });
    expect(await (await off(new Request('https://x/api/chat'))).json()).toEqual({ enabled: false });
    const r = await off(new Request('https://x/api/chat', { method: 'POST', headers: { origin: ORIGIN }, body: '{}' }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'disabled' });
  });

  it('answers with Haiku 5.5, a cached system prompt and no sampling parameters', async () => {
    const { post, create } = setup();
    const r = await post(ask('What do you do?'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: 'I build software across web, mobile and AI.' });
    const [params, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params.model).toBe(CHAT_MODEL);
    expect(CHAT_MODEL).toBe('claude-haiku-5-5');
    expect(params.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(params.messages).toEqual([{ role: 'user', content: 'What do you do?' }]);
    expect(params).not.toHaveProperty('temperature');
    expect(params.max_tokens).toBeLessThanOrEqual(1024);
    expect(options).toMatchObject({ maxRetries: 0 });
  });

  it('rejects other sites, bad bodies and long questions', async () => {
    const { post, create } = setup();
    expect((await post(ask('hi'), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(ask('hi'), { origin: '' })).status).toBe(403);
    expect((await post('not json')).status).toBe(400);
    expect((await post(ask('x'.repeat(201)))).status).toBe(400);
    expect((await post({ messages: [{ role: 'assistant', text: 'hi' }] })).status).toBe(400);
    expect((await post('x'.repeat(17_000))).status).toBe(413);
    expect((await post(ask('hi'), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post({ messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'x'.repeat(601) }, { role: 'user', text: 'b' }] })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rate limits each visitor and the instance', async () => {
    let t = 0;
    const { post } = setup(undefined, { now: () => t, limits: { perIp: 2, windowMs: 1000, perHour: 3 } });
    expect((await post(ask('a'), { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await post(ask('b'))).status).toBe(200);
    expect((await post(ask('c'))).status).toBe(429);
    expect((await post(ask('d'), { 'x-forwarded-for': '5.6.7.8' })).status).toBe(200);
    expect((await post(ask('e'), { 'x-forwarded-for': '9.9.9.9' })).status).toBe(429);
    t = 3_700_000;
    expect((await post(ask('f'))).status).toBe(200);
  });

  it('maps refusals and upstream errors to a failure the site falls back from', async () => {
    const refused = setup(vi.fn(async () => okMessage('', 'refusal')));
    expect((await refused.post(ask('hi'))).status).toBe(502);
    const limited = setup(vi.fn(async () => {
      throw new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers());
    }));
    expect((await limited.post(ask('hi'))).status).toBe(503);
    const broken = setup(vi.fn(async () => {
      throw new Error('network');
    }));
    expect((await broken.post(ask('hi'))).status).toBe(502);
  });
});

describe('chat endpoint helpers', () => {
  it('accepts alternating turns ending with the visitor', () => {
    expect(parseTurns({ messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }] })).toHaveLength(3);
    expect(typeof parseTurns({ messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }] })).toBe('string');
    expect(typeof parseTurns({ messages: Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x' })) })).toBe('string');
    expect(typeof parseTurns(null)).toBe('string');
  });
  it('keeps only links the site already uses', () => {
    const links = siteLinks(content);
    expect(links.has('https://github.com/Richman-Tan')).toBe(true);
    expect(links.has('mailto:richmantan0@gmail.com')).toBe(true);
    expect(tidyAnswer('See [my GitHub](https://github.com/Richman-Tan) or [this](https://evil.example/x).', false, links)).toBe(
      'See [my GitHub](https://github.com/Richman-Tan) or this.',
    );
  });
  it('removes em dashes and ends a truncated answer at a sentence', () => {
    expect(tidyAnswer('Snowboarding — mostly.', false)).toBe('Snowboarding, mostly.');
    expect(tidyAnswer('I build internal tools at work. I also do native iOS and Android work and I really like the', true)).toBe('I build internal tools at work.');
  });
  it('allows only the site, its previews and localhost', () => {
    expect(isSiteOrigin('https://richmantan.vercel.app')).toBe(true);
    expect(isSiteOrigin('https://richmantan.dev')).toBe(true);
    expect(isSiteOrigin('https://richmantan-kd23swomc-richman-tans-projects-2141fd6d.vercel.app')).toBe(true);
    expect(isSiteOrigin('http://localhost:5173')).toBe(true);
    expect(isSiteOrigin('https://richmantan.vercel.app.evil.com')).toBe(false);
    expect(isSiteOrigin('https://evil-richman-tans-projects-2141fd6d.vercel.app')).toBe(false);
  });
});

describe('system prompt', () => {
  const prompt = buildSystemPrompt(content);
  it('carries the site facts and the house rules', () => {
    for (const fact of ['Sandfield', 'DementiaGuide AI', '449 curated passages', '8.0 / 9', 'Scrum Master', 'Snowboarding', 'richmantan0@gmail.com']) {
      expect(prompt).toContain(fact);
    }
    expect(prompt).toMatch(/rather answer properly over email/);
    expect(prompt).toMatch(/Use only those facts/);
    expect(prompt).toMatch(/untrusted/);
    expect(prompt).toMatch(/haven't put that on the site/);
    expect(prompt).not.toMatch(/employer may read/);
  });
  it('is deterministic, cacheable and private', () => {
    expect(buildSystemPrompt(content)).toBe(prompt);
    expect(prompt.length).toBeGreaterThan(3000);
    expect(prompt.length).toBeLessThan(40_000);
    expect(prompt).not.toMatch(/\+?64\s?2\d/);
    expect(prompt).not.toMatch(/\d{1,2}:\d{2}|20\d\d-\d\d-\d\d/);
  });
});

describe('generated api/_site.ts', () => {
  it('matches the current content (run npm run chat:site if this fails)', () => {
    expect(readFileSync(new URL('../api/_site.ts', import.meta.url), 'utf8')).toBe(siteModule());
  });
});
