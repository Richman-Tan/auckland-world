/**
 * The AI chat backend. Typed questions go to /api/chat (Claude, grounded in the site's content);
 * suggested-question chips and job-hunting questions stay scripted, which is free and instant.
 * Any failure (endpoint off, rate limited, slow, offline) falls back to the scripted answer, so
 * the chat never breaks.
 *
 * The answer is asked for as an event stream and passed on a sentence at a time as it arrives (the
 * contract is at the top of ./server.ts). A server that answers with plain JSON instead is fine.
 */
import type { Block } from '../content/types';
import { type ChatBackend, type ChatReply, type LiveReply, MAX_QUESTION, type ScriptedBackend } from './index';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

/** Earlier turns sent with each question, so follow-ups like "tell me more" make sense. */
const HISTORY_TURNS = 10;
/** Matches the server's limit on earlier answers. */
const MAX_ASSISTANT_CHARS = 600;

function blocksText(blocks: Block[]): string {
  return blocks
    .flatMap((b) => (b.type === 'text' ? [b.text] : b.type === 'list' ? b.items : []))
    .join(' ')
    .slice(0, MAX_ASSISTANT_CHARS);
}

/** Paragraphs become text blocks; blocksHtml escapes them and allows only https/mailto links. */
export function textToBlocks(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((p) => ({ type: 'text' as const, text: p }));
}

/**
 * Reads the answer out of an event stream, calling `onText` with the whole answer so far each time
 * more arrives. Resolves with the complete answer, or null if it must not be used: an "error"
 * event (a refusal or failure after text had been sent) or a stream that stopped without "done".
 */
export async function readAnswerStream(body: ReadableStream<Uint8Array>, onText: (soFar: string) => void): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let answer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      pending += decoder.decode(value, { stream: true });
      // Events are separated by a blank line; the last chunk may hold only part of one.
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() ?? '';
      for (const raw of events) {
        const name = /^event: ?(.*)$/m.exec(raw)?.[1].trim();
        const data = raw
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (name === 'done') return answer || null;
        if (name === 'error') return null;
        if (name !== 'text') continue;
        let piece: unknown;
        try {
          piece = (JSON.parse(data) as { text?: unknown }).text;
        } catch {
          return null;
        }
        if (typeof piece !== 'string') return null;
        answer += piece;
        onText(answer);
      }
    }
  } finally {
    // Stop the download (and with it the server's work) if we are leaving early.
    void reader.cancel().catch(() => {});
  }
}

export interface RemoteOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createRemoteBackend(scripted: ScriptedBackend, opts: RemoteOptions = {}): ChatBackend {
  const endpoint = opts.endpoint ?? '/api/chat';
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const history: Turn[] = [];
  let enabled: Promise<boolean> | null = null;
  /** Set when the endpoint says it is switched off, so later questions skip it. */
  let off = false;

  function remember(question: string, reply: ChatReply): void {
    const q = question.trim().slice(0, MAX_QUESTION);
    const a = blocksText(reply.blocks).trim();
    if (!q || !a) return;
    history.push({ role: 'user', text: q }, { role: 'assistant', text: a });
    while (history.length > HISTORY_TURNS) history.splice(0, 2);
  }

  function check(): Promise<boolean> {
    enabled ??= doFetch(endpoint, { method: 'GET', headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { enabled?: unknown } | null) => j?.enabled === true)
      .catch(() => {
        // A network blip: ask again next time rather than turning the AI off for the visit.
        enabled = null;
        return false;
      });
    return enabled;
  }

  async function askAi(text: string, live?: LiveReply): Promise<ChatReply | null> {
    if (off || !(await check())) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', text }] }),
        signal: ctrl.signal,
      });
      let answer: string | null;
      if (res.ok && res.body && (res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        answer = await readAnswerStream(res.body, (soFar) => {
          const partial = textToBlocks(soFar);
          if (partial.length) live?.(partial);
        });
      } else {
        // Errors always arrive as JSON, and so does the whole answer from a server that does not stream.
        const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
        if (res.status === 503 && body?.error === 'disabled') off = true;
        answer = res.ok && typeof body?.text === 'string' ? body.text : null;
      }
      const blocks = answer === null ? [] : textToBlocks(answer);
      return blocks.length ? { kind: 'ai', blocks, suggestions: scripted.suggestions(), topicId: null } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    greet: () => scripted.greet(),
    promptFor: (id) => scripted.promptFor(id),
    mode: () => check().then((ok) => (ok && !off ? 'ai' : 'scripted')),
    async ask(q, live) {
      if ('topicId' in q) {
        const r = await scripted.ask(q);
        remember(scripted.promptFor(q.topicId) ?? '', r);
        return r;
      }
      const text = q.text.trim().slice(0, MAX_QUESTION);
      const reply = scripted.deflect(text) ?? (await askAi(text, live)) ?? (await scripted.ask({ text }));
      remember(text, reply);
      return reply;
    },
  };
}
