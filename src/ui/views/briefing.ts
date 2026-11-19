/** The briefing dialog: docked right on desktop, a bottom sheet on mobile (CSS). */
import type { AppEvent } from '../../app/contracts';
import type { SiteContent } from '../../content/types';
import { blocksHtml } from '../../content/renderHtml';
import { ACCENTS } from '../../shared/palette';
import { h, setText } from '../dom';
import { stopHash } from '../format';

export function createBriefingView(content: SiteContent, dispatch: (e: AppEvent) => void) {
  const kicker = h('p', { class: 'aw-briefing__kicker' });
  const x = h('button', { class: 'aw-btn aw-briefing__x', type: 'button', 'aria-label': 'Close briefing', text: '×' });
  x.addEventListener('click', () => dispatch({ type: 'CLOSE_BRIEFING' }));
  // The address bar already points at this page (app.ts keeps it in step), so sharing is one copy away.
  const copy = h('button', { class: 'aw-btn aw-briefing__copy', type: 'button', text: 'Copy link' });
  let copyTimer = 0;
  const copied = (text: string) => {
    copy.textContent = text;
    setText(status, text);
    clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => (copy.textContent = 'Copy link'), 2200);
  };
  copy.addEventListener('click', () => {
    const done = navigator.clipboard?.writeText(location.href);
    if (!done) return copied('Copy it from the address bar');
    done.then(
      () => copied('Link copied'),
      () => copied('Copy it from the address bar'),
    );
  });
  const title = h('h2', { class: 'aw-briefing__title', id: 'aw-briefing-h', tabindex: -1 });
  const sub = h('p', { class: 'aw-briefing__sub' });
  const period = h('p', { class: 'aw-briefing__period' });
  const body = h('div', { class: 'aw-briefing__body', tabindex: 0, role: 'region', 'aria-label': 'Briefing text' });

  const back = h('button', { class: 'aw-btn', type: 'button', text: '← Back' });
  const next = h('button', { class: 'aw-btn', type: 'button', text: 'Next →' });
  // Disabled-looking buttons stay focusable so focus is not lost when paging reaches an end.
  back.addEventListener('click', () => back.getAttribute('aria-disabled') !== 'true' && dispatch({ type: 'PAGE', delta: -1 }));
  next.addEventListener('click', () => next.getAttribute('aria-disabled') !== 'true' && dispatch({ type: 'PAGE', delta: 1 }));
  const dots = h('div', { class: 'aw-dots' });
  const status = h('p', { class: 'aw-sr', 'aria-live': 'polite' });
  const all = h('a', { class: 'aw-link aw-briefing__all', text: 'Read everything as a page' });
  const hintEl = h('span', { class: 'aw-briefing__hint', text: '← → to page · Esc to close' });
  // Optional action under the pages, e.g. "Visit the Sky Deck" at a stop with a room.
  const action = h('button', { class: 'aw-btn aw-btn--primary aw-briefing__action', type: 'button', hidden: true });
  let onAction: (() => void) | null = null;
  action.addEventListener('click', () => onAction?.());
  // Where to go after this stop: the next one not yet seen (the tour), or the chat once all are.
  const onward = h('button', { class: 'aw-btn aw-briefing__onward', type: 'button', hidden: true });
  let onOnward: (() => void) | null = null;
  onward.addEventListener('click', () => onOnward?.());

  const foot = h(
    'div',
    { class: 'aw-briefing__foot' },
    action,
    h('div', { class: 'aw-briefing__nav' }, back, dots, next),
    onward,
    h('div', { class: 'aw-briefing__meta' }, all, hintEl),
    status,
  );
  const el = h(
    'section',
    { class: 'aw-briefing aw-panel', hidden: true, role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'aw-briefing-h', tabindex: -1 },
    h('div', { class: 'aw-briefing__top' }, kicker, h('div', { class: 'aw-briefing__tools' }, copy, x)),
    h('div', { class: 'aw-briefing__head' }, title, sub, period),
    body,
    foot,
  );

  let shown = '';

  return {
    el,
    /** The element that takes focus when the dialog opens. */
    focusTarget: title,
    render(stopId: string, pageIndex: number): void {
      const stop = content.stops.find((s) => s.id === stopId);
      if (!stop) return;
      const key = `${stopId}:${pageIndex}`;
      if (key === shown) return;
      shown = key;
      const n = stop.briefing.length;
      const idx = Math.min(Math.max(pageIndex, 0), n - 1);
      const page = stop.briefing[idx];
      el.style.setProperty('--accent', ACCENTS[stop.beacon.color]);
      setText(kicker, `${stop.label} · ${stop.place}`);
      setText(title, page.title);
      setText(sub, page.subtitle ?? '');
      sub.hidden = !page.subtitle;
      setText(period, page.period ?? '');
      period.hidden = !page.period;
      body.innerHTML = blocksHtml(page.blocks, { newTab: true });
      body.scrollTop = 0;
      dots.replaceChildren(
        ...stop.briefing.map((p, i) => {
          const d = h('button', { class: 'aw-dot', type: 'button', 'aria-label': `Page ${i + 1} of ${n}: ${p.title}` });
          if (i === idx) d.setAttribute('aria-current', 'step');
          d.addEventListener('click', () => dispatch({ type: 'PAGE_SET', page: i }));
          return d;
        }),
      );
      dots.hidden = n < 2;
      back.setAttribute('aria-disabled', String(idx <= 0));
      next.setAttribute('aria-disabled', String(idx >= n - 1));
      all.setAttribute('href', stopHash(stopId, idx > 0 ? page.id : undefined));
      setText(status, `Page ${idx + 1} of ${n}: ${page.title}`);
    },
    reset(): void {
      shown = '';
    },
    /** Show an action button (label and handler), or hide it with null. */
    setAction(a: { label: string; key?: string; run: () => void } | null): void {
      onAction = a?.run ?? null;
      action.hidden = !a;
      if (a) action.replaceChildren(document.createTextNode(a.label), ...(a.key ? [h('span', { class: 'aw-kbd', text: a.key })] : []));
    },
    /** Show the "next stop" button (label and handler), or hide it with null. */
    setNext(a: { label: string; key?: string; run: () => void } | null): void {
      onOnward = a?.run ?? null;
      onward.hidden = !a;
      if (a) onward.replaceChildren(document.createTextNode(a.label), ...(a.key ? [h('span', { class: 'aw-kbd', text: a.key })] : []));
    },
    setCloseLabel(text: string): void {
      x.setAttribute('aria-label', text);
    },
  };
}
