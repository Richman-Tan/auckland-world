/**
 * The AI chat backend. Typed questions go to /api/chat (Claude, grounded in the site's content);
 * suggested-question chips and job-hunting questions stay scripted, which is free and instant.
 * Any failure (endpoint off, rate limited, slow, offline) falls back to the scripted answer, so
 * the chat never breaks.
 */
import type { Block } from '../content/types';
import { type ChatBackend, type ChatReply, MAX_QUESTION, type ScriptedBackend } from './index';

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

  async function askAi(text: string): Promise<ChatReply | null> {
    if (off || !(await check())) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', text }] }),
        signal: ctrl.signal,
      });
      const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
      if (res.status === 503 && body?.error === 'disabled') off = true;
      if (!res.ok || typeof body?.text !== 'string') return null;
      const blocks = textToBlocks(body.text);
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
    async ask(q) {
      if ('topicId' in q) {
        const r = await scripted.ask(q);
        remember(scripted.promptFor(q.topicId) ?? '', r);
        return r;
      }
      const text = q.text.trim().slice(0, MAX_QUESTION);
      const reply = scripted.deflect(text) ?? (await askAi(text)) ?? (await scripted.ask({ text }));
      remember(text, reply);
      return reply;
    },
  };
}
