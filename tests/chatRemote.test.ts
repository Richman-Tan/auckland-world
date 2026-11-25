import { describe, expect, it, vi } from 'vitest';
import { createScriptedBackend } from '../src/chat';
import { createRemoteBackend, readAnswerStream, textToBlocks } from '../src/chat/remote';
import { content } from '../src/content';
import type { Block } from '../src/content/types';

type Call = { method: string; body?: { messages: { role: string; text: string }[] } };

function fakeFetch(handler: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const scripted = () => createScriptedBackend(content.chatTopics, content.chat);

describe('remote chat backend', () => {
  it('sends typed questions to the endpoint with the conversation so far', async () => {
    const { f, calls } = fakeFetch((c) => (c.method === 'GET' ? { status: 200, body: { enabled: true } } : { status: 200, body: { text: 'Kia ora! Ask away.' } }));
    const b = createRemoteBackend(scripted(), { fetch: f });
    expect(await b.mode!()).toBe('ai');
    await b.ask({ topicId: 'fun' });
    const r = await b.ask({ text: 'Which mountain do you snowboard at?' });
    expect(r.kind).toBe('ai');
    expect(r.blocks).toEqual([{ type: 'text', text: 'Kia ora! Ask away.' }]);
    expect(r.suggestions).toHaveLength(3);
    const post = calls.filter((c) => c.method === 'POST');
    expect(post).toHaveLength(1);
    const sent = post[0].body!.messages;
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[0].text).toBe('What do you do for fun?');
    expect(sent[2].text).toBe('Which mountain do you snowboard at?');
  });

  it('keeps chips and job questions scripted, with no request', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { enabled: true, text: 'nope' } }));
    const b = createRemoteBackend(scripted(), { fetch: f });
    expect((await b.ask({ topicId: 'who' })).topicId).toBe('who');
    expect((await b.ask({ text: 'are you looking for a new job?' })).kind).toBe('smalltalk');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('falls back to the scripted answer when the endpoint fails or is off', async () => {
    const failing = fakeFetch((c) => (c.method === 'GET' ? { status: 200, body: { enabled: true } } : { status: 502, body: { error: 'upstream' } }));
    const b1 = createRemoteBackend(scripted(), { fetch: failing.f });
    expect((await b1.ask({ text: 'where do you work?' })).topicId).toBe('work');

    const off = fakeFetch(() => ({ status: 200, body: { enabled: false } }));
    const b2 = createRemoteBackend(scripted(), { fetch: off.f });
    expect(await b2.mode!()).toBe('scripted');
    expect((await b2.ask({ text: 'what is your gpa' })).topicId).toBe('study');
    expect(off.calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    const offline = vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    const b3 = createRemoteBackend(scripted(), { fetch: offline });
    expect((await b3.ask({ text: 'qwerty asdf' })).kind).toBe('fallback');
  });

  it('stops calling once the endpoint says it is disabled', async () => {
    const { f, calls } = fakeFetch((c) => (c.method === 'GET' ? { status: 200, body: { enabled: true } } : { status: 503, body: { error: 'disabled' } }));
    const b = createRemoteBackend(scripted(), { fetch: f });
    await b.ask({ text: 'tell me something' });
    await b.ask({ text: 'tell me more' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(await b.mode!()).toBe('scripted');
  });

  it('turns paragraphs into text blocks', () => {
    expect(textToBlocks('One.\nStill one.\n\nTwo.')).toEqual([{ type: 'text', text: 'One. Still one.' }, { type: 'text', text: 'Two.' }]);
    expect(textToBlocks('  ')).toEqual([]);
  });
});

describe('remote chat backend, network blips', () => {
  it('asks again after a failed check instead of staying off', async () => {
    let n = 0;
    const f = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET' && n++ === 0) throw new TypeError('blip');
      return new Response(JSON.stringify((init?.method ?? 'GET') === 'GET' ? { enabled: true } : { text: 'Hello again.' }), { status: 200 });
    }) as unknown as typeof fetch;
    const b = createRemoteBackend(createScriptedBackend(content.chatTopics, content.chat), { fetch: f });
    expect(await b.mode!()).toBe('scripted');
    expect(await b.mode!()).toBe('ai');
    expect((await b.ask({ text: 'hello there friend' })).kind).toBe('ai');
  });
});

/* ------------------------------------------------------------------ answers that arrive in pieces */

const enc = new TextEncoder();
const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A response body delivering these chunks one read at a time; `fail` breaks the connection after them. */
function bodyOf(chunks: string[], opts: { fail?: boolean } = {}): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let i = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
      else if (opts.fail) c.error(new TypeError('network error'));
      else c.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, cancelled: () => cancelled };
}

/** A fetch whose POST answers with an event stream made of these chunks. */
function streamingFetch(chunks: string[], opts: { fail?: boolean } = {}) {
  const posts: { headers: Headers; body: { messages: { role: string; text: string }[] } }[] = [];
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    posts.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(bodyOf(chunks, opts).body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  });
  return { f: f as unknown as typeof fetch, posts };
}
const plain = (blocks: Block[]) => blocks.map((b) => (b.type === 'text' ? b.text : '?'));

describe('reading an answer stream', () => {
  const collect = async (chunks: string[], opts: { fail?: boolean } = {}) => {
    const seen: string[] = [];
    const src = bodyOf(chunks, opts);
    const answer = await readAnswerStream(src.body, (soFar) => seen.push(soFar));
    return { answer, seen, cancelled: src.cancelled };
  };

  it('passes on the answer so far each time more arrives, and resolves with all of it at "done"', async () => {
    const r = await collect([ev('text', { text: 'One.' }), ev('text', { text: ' Two.' }), ev('done', {})]);
    expect(r.seen).toEqual(['One.', 'One. Two.']);
    expect(r.answer).toBe('One. Two.');
  });

  it('copes with events split across reads, several in one read, and a multi-byte character cut in half', async () => {
    const whole = ev('text', { text: 'Kia ora — tēnā koe.' }) + ev('text', { text: ' Second.' }) + ev('done', {});
    const bytes = enc.encode(whole);
    for (const size of [1, 2, 3, 5, 11, 64, 999]) {
      const seen: string[] = [];
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (i >= bytes.length) return c.close();
          c.enqueue(bytes.slice(i, i + size));
          i += size;
        },
      });
      expect(await readAnswerStream(body, (s) => seen.push(s)), `reads of ${size}`).toBe('Kia ora — tēnā koe. Second.');
      expect(seen).toEqual(['Kia ora — tēnā koe.', 'Kia ora — tēnā koe. Second.']);
    }
    // Windows line endings, comments and unknown events are fine too.
    const crlf = ': keep-alive\r\n\r\nevent: text\r\ndata: {"text":"Hi."}\r\n\r\nevent: ping\r\ndata: {}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n';
    expect((await collect([crlf])).answer).toBe('Hi.');
  });

  it('gives nothing back when the answer must be discarded', async () => {
    // A refusal or failure after text had been sent.
    expect((await collect([ev('text', { text: 'Sure.' }), ev('error', { error: 'refused' })])).answer).toBeNull();
    // The connection closed, or broke, before "done".
    expect((await collect([ev('text', { text: 'Half an ans' })])).answer).toBeNull();
    await expect(collect([ev('text', { text: 'Half.' })], { fail: true })).rejects.toThrow();
    // Nonsense.
    expect((await collect(['event: text\ndata: not json\n\n', ev('done', {})])).answer).toBeNull();
    expect((await collect([ev('text', { text: 7 }), ev('done', {})])).answer).toBeNull();
    expect((await collect([ev('done', {})])).answer).toBeNull();
  });

  it('stops the download when it gives up early', async () => {
    const r = await collect([ev('text', { text: 'Sure.' }), ev('error', { error: 'refused' }), ev('text', { text: 'never read' })]);
    expect(r.answer).toBeNull();
    expect(r.cancelled()).toBe(true);
  });
});

describe('remote chat backend, streamed answers', () => {
  it('asks for a stream, shows the answer as it grows, and remembers the whole of it', async () => {
    const { f, posts } = streamingFetch([ev('text', { text: 'I build software.' }), ev('text', { text: ' Mostly TypeScript.\n\nAnd some Swift.' }), ev('done', {})]);
    const b = createRemoteBackend(scripted(), { fetch: f });
    const live: string[][] = [];
    const r = await b.ask({ text: 'What do you build?' }, (partial) => live.push(plain(partial)));
    expect(posts[0].headers.get('accept')).toContain('text/event-stream');
    expect(live).toEqual([['I build software.'], ['I build software. Mostly TypeScript.', 'And some Swift.']]);
    expect(r.kind).toBe('ai');
    expect(plain(r.blocks)).toEqual(['I build software. Mostly TypeScript.', 'And some Swift.']);
    // The next question carries the finished answer as history.
    await b.ask({ text: 'Tell me more' });
    expect(posts[1].body.messages.map((m) => m.text)).toEqual(['What do you build?', 'I build software. Mostly TypeScript. And some Swift.', 'Tell me more']);
  });

  it('falls back to the scripted answer when the stream is refused, broken or cut short, after showing part of it', async () => {
    for (const chunks of [[ev('text', { text: 'Sure.' }), ev('error', { error: 'refused' })], [ev('text', { text: 'Sure.' })]]) {
      const { f } = streamingFetch(chunks);
      const b = createRemoteBackend(scripted(), { fetch: f });
      const live: string[][] = [];
      const r = await b.ask({ text: 'where do you work?' }, (partial) => live.push(plain(partial)));
      expect(live).toEqual([['Sure.']]);
      expect(r.kind).not.toBe('ai');
      expect(r.topicId).toBe('work');
    }
    const broken = streamingFetch([ev('text', { text: 'Sure.' })], { fail: true });
    const b = createRemoteBackend(scripted(), { fetch: broken.f });
    expect((await b.ask({ text: 'where do you work?' })).topicId).toBe('work');
  });

  it('never calls back for chips, deflected questions or a plain JSON answer', async () => {
    const live = vi.fn();
    const json = fakeFetch((c) => (c.method === 'GET' ? { status: 200, body: { enabled: true } } : { status: 200, body: { text: 'All at once.' } }));
    const b = createRemoteBackend(scripted(), { fetch: json.f });
    await b.ask({ topicId: 'who' }, live);
    await b.ask({ text: 'are you looking for a new job?' }, live);
    expect((await b.ask({ text: 'say something' }, live)).kind).toBe('ai');
    expect(live).not.toHaveBeenCalled();
  });

  it('gives up on a stream that stalls', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ enabled: true }), { status: 200 });
        const signal = init!.signal!;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(ev('text', { text: 'Thinking about it.' })));
            signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }) as unknown as typeof fetch;
      const b = createRemoteBackend(scripted(), { fetch: f, timeoutMs: 5000 });
      const asked = b.ask({ text: 'where do you work?' });
      await vi.advanceTimersByTimeAsync(5100);
      expect((await asked).topicId).toBe('work');
    } finally {
      vi.useRealTimers();
    }
  });
});
