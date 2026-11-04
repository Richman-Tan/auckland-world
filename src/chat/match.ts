/**
 * Scripted question matching. Pure functions, no DOM: a typed question is normalised, then each
 * topic is scored by its keywords (a phrase match counts 2, a single word 1). Ties go to the
 * earlier topic, so content order is the priority order.
 */

/** Lowercase, drop apostrophes, keep c# and .net, collapse everything else to single spaces. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\.net\b/g, ' dotnet')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}

function wordMatches(token: string, kw: string): boolean {
  if (token === kw) return true;
  // Plurals only for real words: 'hi' must not match 'his'.
  if (kw.length > 3 && (token === `${kw}s` || token === `${kw}es`)) return true;
  // Long stems match their longer forms: snowboard -> snowboarding, dementia -> dementiaguide.
  return kw.length >= 5 && token.startsWith(kw);
}

export interface Keyworded {
  id: string;
  keywords: string[];
  prompt?: string;
}

export function score(text: string, item: Keyworded): number {
  const norm = normalise(text);
  if (!norm) return 0;
  const tokens = norm.split(' ');
  const padded = ` ${norm} `;
  let total = 0;
  // Typing a chip's exact question always wins.
  if (item.prompt && normalise(item.prompt) === norm) total += 10;
  for (const raw of item.keywords) {
    const kw = normalise(raw);
    if (!kw) continue;
    if (kw.includes(' ')) {
      if (padded.includes(` ${kw} `)) total += 2;
    } else if (tokens.some((t) => wordMatches(t, kw))) {
      total += 1;
    }
  }
  return total;
}

/** The best-scoring item, or null when nothing scores. */
export function bestMatch<T extends Keyworded>(text: string, items: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const s = score(text, item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Up to n topic ids to offer next: the current topic's follow-ups that have not been asked, then
 * any other unasked topics in content order. Once everything has been asked, anything but the
 * current topic.
 */
export function nextSuggestions(
  topics: readonly { id: string; followUps?: string[] }[],
  current: string | null,
  asked: ReadonlySet<string>,
  first: readonly string[] = [],
  n = 3,
): string[] {
  const out: string[] = [];
  const known = new Set(topics.map((t) => t.id));
  const push = (id: string) => {
    if (out.length < n && known.has(id) && id !== current && !asked.has(id) && !out.includes(id)) out.push(id);
  };
  const cur = topics.find((t) => t.id === current);
  for (const id of cur?.followUps ?? []) push(id);
  for (const id of first) push(id);
  for (const t of topics) push(t.id);
  if (out.length < n) for (const t of topics) if (out.length < n && t.id !== current && !out.includes(t.id)) out.push(t.id);
  return out;
}
