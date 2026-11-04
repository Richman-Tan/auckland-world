import { describe, expect, it, vi } from 'vitest';
import { createScriptedBackend } from '../src/chat';
import { createRemoteBackend, textToBlocks } from '../src/chat/remote';
import { content } from '../src/content';

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
