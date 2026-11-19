/**
 * The bridge chat: Richman's pixel portrait, a conversation log, suggested questions and a
 * free-text box. Docked right on desktop, a bottom sheet on mobile (CSS), like the briefing.
 *
 * Replies type out a character at a time while the portrait talks. Screen readers get each reply
 * in full through a polite live region instead, and the log itself stays quiet.
 */
import type { AppEvent } from '../../app/contracts';
import { type ChatBackend, type ChatQuestion, type ChatReply, MAX_QUESTION } from '../../chat';
import { blocksHtml } from '../../content/renderHtml';
import type { SiteContent, StopId } from '../../content/types';
import { ACCENTS } from '../../shared/palette';
import { h, setText } from '../dom';
import { stopHash } from '../format';
import { portraitSvg } from '../portrait';

/** Typewriter speed, characters per second. */
const CPS = 85;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

interface Typing {
  finish(): void;
  done: Promise<void>;
}

/** Reveals every text node under el in order, keeping links and bold intact. */
function typewrite(el: HTMLElement, onTick: () => void): Typing {
  const nodes: { node: Text; full: string }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.data.length) nodes.push({ node: t, full: t.data });
  }
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  let ni = 0;
  let ci = 0;
  let budget = 0;
  let raf = 0;
  let last = performance.now();
  const finish = () => {
    cancelAnimationFrame(raf);
    for (const x of nodes) x.node.data = x.full;
    ni = nodes.length;
    onTick();
    resolve();
  };
  if (!nodes.length || reducedMotion()) {
    finish();
    return { finish, done };
  }
  for (const x of nodes) x.node.data = '';
  const step = (now: number) => {
    budget += ((now - last) / 1000) * CPS;
    last = now;
    while (budget >= 1 && ni < nodes.length) {
      const x = nodes[ni];
      const take = Math.min(Math.floor(budget), x.full.length - ci);
      ci += take;
      budget -= take;
      x.node.data = x.full.slice(0, ci);
      if (ci >= x.full.length) {
        ni++;
        ci = 0;
      }
    }
    onTick();
    if (ni >= nodes.length) resolve();
    else raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { finish, done };
}

export function createChatView(content: SiteContent, dispatch: (e: AppEvent) => void, backend: ChatBackend) {
  const p = content.profile;

  const kicker = h('p', { class: 'aw-briefing__kicker' });
  const x = h('button', { class: 'aw-btn aw-briefing__x', type: 'button', 'aria-label': 'Close chat', text: '×' });
  x.addEventListener('click', () => dispatch({ type: 'CLOSE_CHAT' }));

  const portrait = h('div', { class: 'aw-portrait' });
  portrait.innerHTML = portraitSvg();
  const name = h('h2', { class: 'aw-chat__name', id: 'aw-chat-h', tabindex: -1, text: p.name });
  const links = h('ul', { class: 'aw-chat__links', 'aria-label': 'Contact' });
  for (const l of p.links) {
    const a = h('a', { href: l.href, text: l.label });
    if (l.href.startsWith('https:')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    links.append(h('li', {}, a));
  }
  const head = h(
    'div',
    { class: 'aw-chat__head' },
    portrait,
    h('div', { class: 'aw-chat__who' }, name, h('p', { class: 'aw-chat__role', text: p.title }), links),
  );

  const log = h('div', { class: 'aw-chat__log', role: 'log', 'aria-live': 'off', 'aria-label': 'Conversation', tabindex: 0 });
  const suggest = h('div', { class: 'aw-chat__suggest', role: 'group', 'aria-label': 'Suggested questions' });

  const field = h('input', {
    class: 'aw-chat__input',
    type: 'text',
    id: 'aw-chat-q',
    maxlength: MAX_QUESTION,
    autocomplete: 'off',
    enterkeyhint: 'send',
    placeholder: 'Type a question…',
  });
  const send = h('button', { class: 'aw-btn aw-chat__send', type: 'submit', text: 'Send' });
  const form = h(
    'form',
    { class: 'aw-chat__form' },
    h('label', { class: 'aw-sr', for: 'aw-chat-q', text: 'Ask Richman a question' }),
    field,
    send,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = field.value.trim();
    // Holding Enter should not stack up dozens of the same question.
    if (!text || waiting > 3) return;
    field.value = '';
    enqueue({ text }, text);
  });

  // After the chat: the next stop not yet seen. Hidden once everything has been.
  const onward = h('button', { class: 'aw-btn aw-chat__onward', type: 'button', hidden: true });
  let onOnward: (() => void) | null = null;
  onward.addEventListener('click', () => onOnward?.());

  const all = h('a', { class: 'aw-link aw-briefing__all', text: 'Read everything as a page' });
  const disclosure = h('span', { class: 'aw-chat__disclosure', text: 'Pre-written answers for now' });
  const meta = h(
    'div',
    { class: 'aw-chat__meta' },
    disclosure,
    all,
    h('span', { class: 'aw-briefing__hint', text: 'Esc to close' }),
  );
  const status = h('p', { class: 'aw-sr', 'aria-live': 'polite' });

  const el = h(
    'section',
    { class: 'aw-chat aw-panel', hidden: true, role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'aw-chat-h', tabindex: -1 },
    h('div', { class: 'aw-briefing__top' }, kicker, x),
    head,
    log,
    suggest,
    form,
    onward,
    meta,
    status,
  );

  let started = false;
  /** Whether the chat is on screen; a reply that lands while hidden appears in full. */
  let shown = false;
  let queue: Promise<void> = Promise.resolve();
  let typing: Typing | null = null;
  let skipWait: (() => void) | null = null;
  /** Questions queued behind the current reply; while any wait, replies appear without typing. */
  let waiting = 0;

  const scrollDown = () => {
    log.scrollTop = log.scrollHeight;
  };

  function bubble(who: 'me' | 'you', body: HTMLElement): HTMLElement {
    const m = h(
      'div',
      { class: `aw-msg aw-msg--${who}` },
      h('span', { class: 'aw-sr', text: who === 'me' ? `${p.name}: ` : 'You: ' }),
      body,
    );
    log.append(m);
    scrollDown();
    return m;
  }

  function renderSuggestions(ids: string[]): void {
    suggest.replaceChildren(
      ...ids.flatMap((id) => {
        const label = backend.promptFor(id);
        if (!label) return [];
        const b = h('button', { class: 'aw-chip', type: 'button', text: label });
        b.addEventListener('click', () => enqueue({ topicId: id }, label));
        return [b];
      }),
    );
    // The chips take height from the log: keep the newest reply in view.
    scrollDown();
  }

  /** Short pause that reads as thinking. Skipped when another question arrives. */
  function think(ms: number): Promise<void> {
    if (reducedMotion() || ms <= 0 || waiting > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        skipWait = null;
        resolve();
      }
      skipWait = done;
    });
  }

  /** Re-announce even when the text repeats (the same fallback twice, say). */
  function announce(text: string): void {
    status.textContent = '';
    setTimeout(() => setText(status, text), 30);
  }

  async function say(reply: () => Promise<ChatReply> | ChatReply, thinkMs: number): Promise<void> {
    // Removing a focused chip would drop focus to the page: keep it in the chat.
    if (suggest.contains(document.activeElement)) (finePointer() ? field : name).focus({ preventScroll: true });
    suggest.replaceChildren();
    const dots = h('div', { class: 'aw-msg aw-msg--me aw-msg--typing', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'));
    log.append(dots);
    scrollDown();
    let r: ChatReply;
    try {
      [r] = await Promise.all([reply(), think(thinkMs)]);
    } catch {
      r = { kind: 'fallback', blocks: content.chat.fallback, suggestions: content.chat.starters, topicId: null };
    }
    dots.remove();
    const body = h('div', { class: 'aw-msg__body' });
    body.innerHTML = blocksHtml(r.blocks, { newTab: true });
    announce(`${p.name}: ${body.textContent ?? ''}`);
    const msg = bubble('me', body);
    msg.addEventListener('click', () => typing?.finish());
    portrait.dataset.talking = '';
    typing = typewrite(body, scrollDown);
    if (waiting > 0 || !shown) typing.finish();
    await typing.done;
    typing = null;
    delete portrait.dataset.talking;
    renderSuggestions(r.suggestions);
  }

  function enqueue(q: ChatQuestion, label: string): void {
    // A new question hurries the current reply along rather than waiting for it.
    skipWait?.();
    typing?.finish();
    const you = h('p', { text: label });
    waiting++;
    chain(() => {
      waiting--;
      bubble('you', you);
      return say(() => backend.ask(q), 380 + Math.min(420, label.length * 6));
    });
  }

  /** Runs replies one at a time. A failure resets the view instead of wedging every later question. */
  function chain(step: () => Promise<void>): void {
    queue = queue.then(step).catch(() => {
      log.querySelector('.aw-msg--typing')?.remove();
      typing = null;
      delete portrait.dataset.talking;
      renderSuggestions(content.chat.starters);
    });
  }

  return {
    el,
    focusTarget: (): HTMLElement => (finePointer() ? field : name),
    open(stopId: StopId): void {
      const stop = content.stops.find((s) => s.id === stopId);
      if (stop) {
        el.style.setProperty('--accent', ACCENTS[stop.beacon.color]);
        setText(kicker, `${stop.label} · ${stop.place}`);
        all.setAttribute('href', stopHash(stopId));
      }
      shown = true;
      if (!started) {
        started = true;
        // Say plainly who writes typed replies. Some still come from the script (job questions, or
        // whenever the AI is unavailable), hence "may be".
        void backend.mode?.().then((m) => setText(disclosure, m === 'ai' ? 'Typed replies may be AI-written' : 'Pre-written answers for now'));
        chain(() => say(() => backend.greet(), 450));
      }
    },
    /** Show the "next stop" button (label and handler), or hide it with null. */
    setNext(a: { label: string; run: () => void } | null): void {
      onOnward = a?.run ?? null;
      onward.hidden = !a;
      if (a) setText(onward, a.label);
    },
    /** Called on every UI sync while the chat is not showing: settle any reply in progress. */
    hide(): void {
      shown = false;
      skipWait?.();
      typing?.finish();
    },
  };
}
