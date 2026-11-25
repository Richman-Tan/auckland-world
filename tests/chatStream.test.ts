import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteLinks } from '../src/chat/prompt';
import { CHAT_MODEL, createChatHandler, createTidyStream, houseStyle, isSiteOrigin, tidyAnswer } from '../src/chat/server';
import { inlineHtml } from '../src/content/renderHtml';
import { content } from '../src/content';
import { GITHUB } from '../src/content/links';
import { rng } from './flightWorld';

const ORIGIN = 'https://richmantan.vercel.app';
const LINKS = siteLinks(content);

/* ------------------------------------------------------------ a stand-in for the SDK's stream */

type Ev = Record<string, unknown>;
const start = (): Ev => ({ type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } } });
const text = (t: string): Ev => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } });
const thinking = (): Ev => ({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } });
const stop = (reason = 'end_turn'): Ev => ({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 30 } });

interface FakeOptions {
  /** Throw this instead of the event at this position. */
  fail?: { at: number; error: unknown };
  /** After this many events, never produce another until aborted. */
  hangAfter?: number;
}

/** Behaves like MessageStream as the handler uses it: async iteration, abort(), and abort on early exit. */
function fakeStream(events: Ev[], opts: FakeOptions = {}) {
  const abort = vi.fn();
  let aborted = false;
  let wake: (() => void) | null = null;
  const stream = {
    abort() {
      aborted = true;
      abort();
      wake?.();
    },
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next(): Promise<IteratorResult<Ev>> {
          if (aborted) throw new Error('Request was aborted.');
          if (opts.fail && i === opts.fail.at) throw opts.fail.error;
          if (opts.hangAfter !== undefined && i >= opts.hangAfter) {
            await new Promise<void>((r) => (wake = r));
            throw new Error('Request was aborted.');
          }
          if (i >= events.length) return { value: undefined, done: true };
          return { value: events[i++], done: false };
        },
        async return(): Promise<IteratorResult<Ev>> {
          aborted = true;
          abort();
          return { value: undefined, done: true };
        },
      };
    },
  };
  return { stream, abort };
}

function setup(events: Ev[], opts: FakeOptions = {}, extra = {}) {
  const fake = fakeStream(events, opts);
  const streamFn = vi.fn((_params: unknown, _options?: unknown) => fake.stream);
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'From create.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  const logged: Record<string, unknown>[] = [];
  const handler = createChatHandler({
    client: { messages: { stream: streamFn, create } } as unknown as Pick<Anthropic, 'messages'>,
    system: 'SYSTEM',
    isAllowedOrigin: isSiteOrigin,
    allowedLinks: LINKS,
    log: (e) => logged.push(e),
    ...extra,
  });
  const post = (question: string, headers: Record<string, string> = {}) =>
    handler(
      new Request('https://richmantan.vercel.app/api/chat', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', accept: 'text/event-stream, application/json', 'x-forwarded-for': '1.2.3.4', ...headers },
        body: JSON.stringify({ messages: [{ role: 'user', text: question }] }),
      }),
    );
  return { post, streamFn, create, abort: fake.abort, logged };
}

/** A response's events, in order. */
async function events(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)![1],
      data: JSON.parse(/^data: (.*)$/m.exec(block)![1]) as Record<string, unknown>,
    }));
}
const answerOf = (evs: { event: string; data: Record<string, unknown> }[]) => evs.filter((e) => e.event === 'text').map((e) => e.data.text).join('');

afterEach(() => vi.useRealTimers());

/* ------------------------------------------------------------------------------ the endpoint */

describe('chat endpoint, streamed', () => {
  it('sends the answer a sentence at a time, then "done"', async () => {
    const { post, streamFn, create, logged } = setup([
      start(),
      thinking(),
      text('I build soft'),
      text('ware across web, mob'),
      text('ile and AI. Most of it is '),
      text('TypeScript.'),
      stop(),
    ]);
    const res = await post('What do you do?');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const evs = await events(res);
    expect(evs).toEqual([
      { event: 'text', data: { text: 'I build software across web, mobile and AI.' } },
      { event: 'text', data: { text: ' Most of it is TypeScript.' } },
      { event: 'done', data: {} },
    ]);
    // Same model, prompt and limits as the one-shot path; and only one of the two is called.
    const [params, options] = streamFn.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params.model).toBe(CHAT_MODEL);
    expect(params.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(params.messages).toEqual([{ role: 'user', content: 'What do you do?' }]);
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.max_tokens).toBeLessThanOrEqual(1024);
    expect(params).not.toHaveProperty('temperature');
    expect(options).toMatchObject({ maxRetries: 0 });
    expect(create).not.toHaveBeenCalled();
    // Token counts are logged; the visitor's words and the answer are not.
    expect(logged).toEqual([{ chat: 'ok', stream: true, stop: 'end_turn', in: 20, out: 30, cacheRead: 4000, cacheWrite: 0 }]);
  });

  it('answers in one JSON object when a stream was not asked for', async () => {
    const { post, streamFn, create } = setup([start(), text('Unused.'), stop()]);
    const res = await post('hi', { accept: 'application/json' });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ text: 'From create.' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it('keeps a link the site uses and strips one it does not, however the text is cut up', async () => {
    const answer = `See [my GitHub](${GITHUB}) or [this page](https://evil.example/x). Thanks!`;
    for (const size of [1, 2, 3, 7, 13, 40]) {
      const pieces = answer.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))!;
      const { post } = setup([start(), ...pieces.map(text), stop()]);
      const evs = await events(await post('links?'));
      expect(answerOf(evs), `pieces of ${size}`).toBe(`See [my GitHub](${GITHUB}) or this page. Thanks!`);
      // No single event carries part of a link.
      for (const e of evs.filter((x) => x.event === 'text')) expect(String(e.data.text)).not.toMatch(/\[[^\]]*$|\]\([^)]*$/);
    }
  });

  it('a refusal after text has gone out ends in "error", so the reader discards it', async () => {
    const { post, logged } = setup([start(), text('Sure. Here is how you would '), stop('refusal')]);
    const evs = await events(await post('something it will not answer'));
    expect(evs[0]).toEqual({ event: 'text', data: { text: 'Sure.' } });
    expect(evs[evs.length - 1]).toEqual({ event: 'error', data: { error: 'refused' } });
    expect(evs.some((e) => e.event === 'done')).toBe(false);
    expect(logged[0]).toMatchObject({ chat: 'ok', stop: 'refusal' });
  });

  it('a failure before the first sentence is a plain JSON error with a status', async () => {
    const busy = setup([start()], { fail: { at: 0, error: new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers()) } });
    const r1 = await busy.post('hi');
    expect(r1.status).toBe(503);
    expect(await r1.json()).toEqual({ error: 'busy' });

    const broken = setup([start(), text('Half a sent')], { fail: { at: 2, error: new Error('socket hang up') } });
    const r2 = await broken.post('hi');
    expect(r2.status).toBe(502);
    expect(await r2.json()).toEqual({ error: 'upstream' });

    const refused = setup([start(), stop('refusal')]);
    const r3 = await refused.post('hi');
    expect(r3.status).toBe(502);
    expect(await r3.json()).toEqual({ error: 'refused' });

    const empty = setup([start(), thinking(), stop()]);
    const r4 = await empty.post('hi');
    expect(r4.status).toBe(502);
    expect(await r4.json()).toEqual({ error: 'empty' });
  });

  it('a failure after text has gone out ends in "error"', async () => {
    const { post } = setup([start(), text('First sentence. Second sent')], { fail: { at: 2, error: new Error('socket hang up') } });
    const evs = await events(await post('hi'));
    expect(evs).toEqual([
      { event: 'text', data: { text: 'First sentence.' } },
      { event: 'error', data: { error: 'upstream' } },
    ]);
  });

  it('an answer cut off by max_tokens stops at its last full sentence', async () => {
    const { post } = setup([start(), text('I build internal tools at work. I also do native iOS and Android work and I really like the'), stop('max_tokens')]);
    const evs = await events(await post('hi'));
    expect(answerOf(evs)).toBe('I build internal tools at work.');
    expect(evs[evs.length - 1].event).toBe('done');
  });

  it('stops asking for more once the answer is long enough', async () => {
    const sentence = 'This sentence is exactly forty chars ok. ';
    expect(sentence.length).toBe(41);
    const { post, abort, logged } = setup([start(), ...Array.from({ length: 40 }, () => text(sentence)), stop()]);
    const evs = await events(await post('tell me everything'));
    const answer = answerOf(evs);
    expect(answer.length).toBeLessThanOrEqual(600);
    expect(answer.length).toBeGreaterThan(550);
    expect(evs[evs.length - 1].event).toBe('done');
    expect(abort).toHaveBeenCalled();
    expect(logged[0]).toMatchObject({ stop: 'capped' });
  });

  it('stops generating when the visitor goes away', async () => {
    const { post, abort } = setup([start(), text('One. '), text('Two. '), text('Three. '), stop()]);
    const res = await post('hi');
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(abort).toHaveBeenCalled();
  });

  it('stops at once if the visitor goes away while the next sentence is still being written', async () => {
    const { post, abort, logged } = setup([start(), text('One. '), text('Two is still being wri')], { hangAfter: 3 });
    const res = await post('hi');
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('One.');
    // Ask for the next piece, which will never be ready, then leave.
    const waiting = reader.read();
    await new Promise((r) => setTimeout(r, 0));
    expect(abort).not.toHaveBeenCalled();
    await reader.cancel();
    await waiting;
    await new Promise((r) => setTimeout(r, 0));
    expect(abort).toHaveBeenCalled();
    expect(logged[0]).toMatchObject({ chat: 'ok', stop: 'gone' });
  });

  it('gives up after nine seconds: keeps what was complete, or fails if nothing was', async () => {
    vi.useFakeTimers();
    const some = setup([start(), text('This part arrived. And then it sta')], { hangAfter: 2 });
    const p1 = some.post('hi').then(events);
    await vi.advanceTimersByTimeAsync(9_100);
    const evs = await p1;
    expect(answerOf(evs)).toBe('This part arrived.');
    expect(evs[evs.length - 1].event).toBe('done');
    expect(some.abort).toHaveBeenCalled();
    expect(some.logged[0]).toMatchObject({ stop: 'timeout' });

    const none = setup([start(), text('Not a whole sent')], { hangAfter: 2 });
    const p2 = none.post('hi');
    await vi.advanceTimersByTimeAsync(9_100);
    const r = await p2;
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: 'upstream' });
  });

  it('applies the same checks and rate limits as the one-shot path', async () => {
    let t = 0;
    const { post, streamFn } = setup([start(), text('Hi.'), stop()], {}, { now: () => t, limits: { perIp: 1, windowMs: 1000, perHour: 10 } });
    expect((await post('a', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('a', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post('x'.repeat(201))).status).toBe(400);
    expect(streamFn).not.toHaveBeenCalled();
    expect((await post('a')).status).toBe(200);
    const limited = await post('b');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    t = 2000;
    expect(streamFn).toHaveBeenCalledTimes(1);
  });
});

/* --------------------------------------------------------------------- the piece-wise tidying */

/** Feed text to a tidy stream in the given pieces; returns what came out, piece by piece. */
function feed(pieces: string[], truncated = false, links: ReadonlySet<string> = LINKS): string[] {
  const t = createTidyStream(links);
  const out: string[] = [];
  for (const p of pieces) {
    const o = t.push(p);
    if (o) out.push(o);
  }
  const last = t.end(truncated);
  if (last) out.push(last);
  return out;
}

/** Cut a string into random pieces of 1 to `max` characters. */
function chop(s: string, max: number, random: () => number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    const n = 1 + Math.floor(random() * max);
    out.push(s.slice(i, i + n));
    i += n;
  }
  return out;
}

const SAMPLES = [
  'I build software across web, mobile and AI.',
  'Snowboarding — mostly. And the beach — when it is warm!',
  `See [my GitHub](${GITHUB}) or [this](https://evil.example/x). Thanks.`,
  `A link at the very end: [GitHub](${GITHUB})`,
  'Brackets that are not links: [sic] and [see above]. Still fine? Yes.',
  'A bracket then a parenthesis, apart: [one] (two). Done.',
  'He said "ship it." Then we did. (It worked.) [Mostly.] And so on.',
  'Two paragraphs.\n\nThe second one — with a dash — and [a bad link](https://evil.example/a.b?c=d. e). End.',
  '  Leading and trailing space.  ',
  'No full stop at the end of this one',
  'Version 2.0 of the app. It costs $3.50 e.g. per month... roughly. Ok?!',
];

/** What a reader's browser would turn into links: the hrefs in the chat bubble's HTML. */
const hrefs = (answer: string) => [...inlineHtml(answer).matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

/** Square brackets that are not the two around a link the site allows. */
const strayBrackets = (answer: string) =>
  answer.replace(/\[[^[\]]*\]\(([^)\s]*)\)/g, (all, href: string) => (LINKS.has(href) ? '' : all)).replace(/[^[\]]/g, '');

describe('house style', () => {
  it('keeps a link the site uses and takes the address off any other', () => {
    expect(houseStyle(`See [my GitHub](${GITHUB}) or [this](https://evil.example/x).`, LINKS)).toBe(`See [my GitHub](${GITHUB}) or this.`);
    expect(houseStyle('Snowboarding — mostly.', LINKS)).toBe('Snowboarding, mostly.');
  });

  it('cannot be talked into a link by nesting one inside another', () => {
    // Taking the inner link out used to leave the outer one behind, address and all.
    for (const attack of [
      '[[x](a)](https://evil.example)',
      '[[[x](a)](b)](https://evil.example)',
      `[[x](${GITHUB})](https://evil.example)`,
      '[x]\u2014(https://evil.example)',
      '[a [b](https://evil.example)',
    ]) {
      const out = houseStyle(attack, LINKS);
      expect(hrefs(out).filter((h) => !LINKS.has(h)), attack).toEqual([]);
      expect(strayBrackets(out), attack).toBe('');
      expect(tidyAnswer(attack, false, LINKS)).toBe(out.trim());
    }
    // The address may survive as plain text; what matters is that nothing is a link.
    expect(houseStyle('[[x](a)](https://evil.example)', LINKS)).toBe('(x)(https://evil.example)');
  });

  it('turns every other square bracket into a round one', () => {
    expect(houseStyle('As he put it [sic], see [1] and x[0].', LINKS)).toBe('As he put it (sic), see (1) and x(0).');
    expect(houseStyle(`A [label [with] brackets](${GITHUB}).`, LINKS)).toBe('A (label (with) brackets)(' + GITHUB + ').');
  });
});

describe('tidying an answer as it arrives', () => {
  it('pieces joined together equal tidying the whole answer, however it was cut up', () => {
    const random = rng(7);
    for (const sample of SAMPLES) {
      const whole = tidyAnswer(sample, false, LINKS);
      for (const max of [1, 2, 3, 5, 9, 17, 60]) {
        for (let round = 0; round < 12; round++) {
          const pieces = chop(sample, max, random);
          expect(feed(pieces).join(''), JSON.stringify(pieces)).toBe(whole);
        }
      }
    }
  });

  it('never lets a link to somewhere else through, whole or in halves', () => {
    const random = rng(11);
    const evil = /\[[^\]]*\]\((?!https:\/\/github\.com\/Richman-Tan\))[^)\s]*\)/;
    const attack = `Click [here](https://evil.example/login) now. Or [h](javascript:alert(1)) or [my GitHub](${GITHUB}). [x]\n(https://evil.example) [y](https://evil.example/2)`;
    for (let round = 0; round < 300; round++) {
      const out = feed(chop(attack, 1 + Math.floor(random() * 12), random));
      // Check every prefix: this is what a reader has on screen as the pieces arrive.
      let soFar = '';
      for (const piece of out) {
        soFar += piece;
        expect(soFar).not.toMatch(evil);
        expect(soFar).not.toContain('evil.example/login');
      }
      expect(soFar).toContain(`[my GitHub](${GITHUB})`);
    }
  });

  it('leaves nothing that could be joined into a link, wherever the pieces fall', () => {
    const random = rng(23);
    const long = 'word '.repeat(70);
    const attacks = [
      // A bracket let out with one sentence, the rest of the "link" arriving after a long run.
      `[a [b. ${long}](https://evil.example) done. `,
      `Look [here. ${long}](https://evil.example/x) ok. `,
      `[x](https://evil.example/[a. b](q)). Then [y](https://evil.example/z). `,
      `One [two] three. (https://evil.example) four. [five]\n(https://evil.example) six.`,
      `[[x](a)](https://evil.example) and [[[y](b)](c)](https://evil.example/2). End.`,
      `Fine: [my GitHub](${GITHUB}). Not fine: [my GitHub](${GITHUB}x). ]( [ ]( ) [`,
    ];
    for (const attack of attacks) {
      for (let round = 0; round < 120; round++) {
        const out = feed(chop(attack, 1 + Math.floor(random() * 40), random));
        let soFar = '';
        for (const piece of out) {
          soFar += piece;
          expect(hrefs(soFar).filter((h) => !LINKS.has(h)), JSON.stringify(out)).toEqual([]);
          expect(soFar).not.toMatch(/\]\((?!https:\/\/github\.com\/Richman-Tan\))/);
        }
        expect(strayBrackets(soFar), JSON.stringify(out)).toBe('');
      }
    }
  });

  it('releases whole sentences, and holds a link back until it is complete', () => {
    const t = createTidyStream(LINKS);
    expect(t.push('Hello the')).toBe('');
    expect(t.push('re. How')).toBe('Hello there.');
    expect(t.push(' are you? See [my Git')).toBe(' How are you?');
    expect(t.push(`Hub](${GITHUB}`)).toBe('');
    expect(t.push(') for more. Bye')).toBe(` See [my GitHub](${GITHUB}) for more.`);
    expect(t.end(false)).toBe(' Bye');
    expect(t.emitted).toBe(`Hello there. How are you? See [my GitHub](${GITHUB}) for more. Bye`.length);
  });

  it('drops the unfinished sentence of a cut-off answer, unless that is all there is', () => {
    expect(feed(['I build internal tools at work. I also do native iOS and'], true).join('')).toBe('I build internal tools at work.');
    expect(feed(['Just the start of a sent'], true).join('')).toBe('Just the start of a sent');
    expect(feed(['Complete. Also complete.'], false).join('')).toBe('Complete. Also complete.');
  });

  it('does not wait for ever: a long run with no sentence end is let go, with any link defused', () => {
    const run = `[a label ${'word '.repeat(70)}`;
    const t = createTidyStream(LINKS);
    const first = t.push(run);
    expect(first.length).toBeGreaterThan(250);
    expect(first).not.toContain('[');
    // What arrives next cannot turn the earlier text into a link.
    const rest = t.push('](https://evil.example) and more. ') + t.end(false);
    expect(first + rest).not.toMatch(/\[[^\]]*\]\(/);
  });

  it('stops at the length limit, on a full sentence', () => {
    const t = createTidyStream(LINKS);
    let out = '';
    for (let i = 0; i < 50 && !t.full; i++) out += t.push('Twenty chars or so. ');
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.length).toBeGreaterThan(570);
    expect(out.endsWith('or so.')).toBe(true);
    expect(t.full).toBe(true);
    expect(t.emitted).toBe(out.length);
    expect(t.push('More. ')).toBe('');
    expect(t.end(false)).toBe('');
  });

  it('cuts a first sentence that is itself over the limit', () => {
    const t = createTidyStream(LINKS);
    const out = t.push(`${'long '.repeat(200)}end. `) + t.end(false);
    expect(out.length).toBe(600);
    expect(t.full).toBe(true);
  });
});
