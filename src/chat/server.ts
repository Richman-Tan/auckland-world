/**
 * The /api/chat request handler, written against web-standard Request/Response so it runs on
 * Vercel's Edge runtime and in tests. The Anthropic client is injected; with no client (no API key
 * set) the endpoint reports itself disabled and the site falls back to its scripted answers.
 *
 * Spend is bounded three ways: short answers (max_tokens), per-visitor and per-instance rate limits
 * here, and the monthly spend limit set on the Anthropic account, which is the hard cap. The origin
 * and Sec-Fetch-Site checks only stop other websites' pages; a script can forge them, so they are not
 * an abuse control.
 */
import Anthropic from '@anthropic-ai/sdk';

export const CHAT_MODEL = 'claude-haiku-5-5';
/** Matches MAX_QUESTION in ./index.ts (kept separate so this file has no UI imports). */
const MAX_USER_CHARS = 200;
/** Real answers are under 70 words; a longer forged "Richman said" turn is rejected. */
const MAX_ASSISTANT_CHARS = 600;
const MAX_TURNS = 12;
const MAX_BODY_BYTES = 16_000;

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatHandlerDeps {
  /** Null when no API key is configured. */
  client: Pick<Anthropic, 'messages'> | null;
  system: string;
  isAllowedOrigin(origin: string): boolean;
  /** URLs the site itself links to; any other link in an answer is shown as plain text. */
  allowedLinks: ReadonlySet<string>;
  now?: () => number;
  /** Requests per visitor IP per window, and per instance per hour. */
  limits?: { perIp: number; windowMs: number; perHour: number };
  log?: (entry: Record<string, unknown>) => void;
}

const SITE_ORIGINS = new Set(['https://richmantan.vercel.app', 'https://richmantan.dev', 'https://www.richmantan.dev']);
const PREVIEW_ORIGIN = /^https:\/\/richmantan-[a-z0-9-]+-richman-tans-projects-2141fd6d\.vercel\.app$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isSiteOrigin(origin: string): boolean {
  return SITE_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin) || LOCAL_ORIGIN.test(origin);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Parses and checks the request body; returns the turns or an error string. */
export function parseTurns(body: unknown): ChatTurn[] | string {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_TURNS) return 'messages must be 1 to 12 turns';
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as { role?: unknown; text?: unknown };
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (m?.role !== role) return 'turns must alternate, starting with the visitor';
    if (typeof m.text !== 'string') return 'each turn needs text';
    const text = m.text.trim();
    const max = role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    if (!text || text.length > max) return `turn ${i + 1} is empty or too long`;
    turns.push({ role, text });
  }
  if (turns[turns.length - 1].role !== 'user') return 'the last turn must be the visitor';
  return turns;
}

/**
 * House style, enforced: no em dashes, links only to URLs the site already uses, and an answer cut
 * off by max_tokens ends at a full sentence.
 */
export function tidyAnswer(text: string, truncated: boolean, allowedLinks: ReadonlySet<string> = new Set()): string {
  let t = text
    .replace(/\s*—\s*/g, ', ')
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (all, label: string, href: string) => (allowedLinks.has(href) ? all : label))
    .trim();
  if (truncated) {
    const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
    if (end > 15) t = t.slice(0, end + 1);
  }
  return t.slice(0, MAX_ASSISTANT_CHARS);
}

export function createChatHandler(deps: ChatHandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const limits = deps.limits ?? { perIp: 12, windowMs: 10 * 60_000, perHour: 400 };
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const hits = new Map<string, number[]>();
  let hourStart = now();
  let hourCount = 0;

  function limited(ip: string): boolean {
    const t = now();
    if (t - hourStart > 3_600_000) {
      hourStart = t;
      hourCount = 0;
    }
    if (hourCount >= limits.perHour) return true;
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < limits.windowMs);
    if (recent.length >= limits.perIp) {
      hits.set(ip, recent);
      return true;
    }
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
    hourCount++;
    return false;
  }

  return async (req) => {
    if (req.method === 'GET') return json(200, { enabled: deps.client !== null });
    if (req.method !== 'POST') return json(405, { error: 'method' });

    const origin = req.headers.get('origin') ?? '';
    if (!deps.isAllowedOrigin(origin)) return json(403, { error: 'origin' });
    if (!deps.client) return json(503, { error: 'disabled' });

    // Browsers mark same-site fetches; this keeps other sites' pages out (scripts can still forge it).
    const site = req.headers.get('sec-fetch-site');
    if (site !== null && site !== 'same-origin') return json(403, { error: 'origin' });
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'too_large' });
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'too_large' });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'json' });
    }
    const turns = parseTurns(body);
    if (typeof turns === 'string') return json(400, { error: 'invalid', detail: turns });

    const ip =
      req.headers.get('x-real-ip') ||
      req.headers.get('x-vercel-forwarded-for') ||
      (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
      'unknown';
    if (limited(ip)) return json(429, { error: 'rate_limited' });

    try {
      const res = await deps.client.messages.create(
        {
          model: CHAT_MODEL,
          max_tokens: 1024,
          // Low effort: short, grounded answers; the model can skip thinking on easy questions.
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: deps.system, cache_control: { type: 'ephemeral' } }],
          messages: turns.map((t) => ({ role: t.role, content: t.text })),
        },
        // No retry: the browser gives up at 12 s and shows the scripted answer, so a retry would be spend nobody sees.
        { timeout: 10_000, maxRetries: 0 },
      );
      // Usage only; visitor text is never logged.
      log({
        chat: 'ok',
        stop: res.stop_reason,
        in: res.usage.input_tokens,
        out: res.usage.output_tokens,
        cacheRead: res.usage.cache_read_input_tokens ?? 0,
        cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      });
      if (res.stop_reason === 'refusal') return json(502, { error: 'refused' });
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
      if (!text) return json(502, { error: 'empty' });
      return json(200, { text: tidyAnswer(text, res.stop_reason === 'max_tokens', deps.allowedLinks) });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        log({ chat: 'upstream_rate_limited' });
        return json(503, { error: 'busy' });
      }
      if (err instanceof Anthropic.APIError) {
        log({ chat: 'upstream_error', status: err.status ?? null });
        return json(502, { error: 'upstream' });
      }
      log({ chat: 'error', message: err instanceof Error ? err.message : String(err) });
      return json(502, { error: 'upstream' });
    }
  };
}
