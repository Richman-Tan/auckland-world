/** Pause menu and error screen. */
import type { AppEvent } from '../../app/contracts';
import { CONTROLS } from '../controls';
import { h, setText } from '../dom';

export function createPauseView(dispatch: (e: AppEvent) => void) {
  const resume = h('button', { class: 'aw-btn aw-btn--primary', type: 'button', text: 'Resume' });
  resume.addEventListener('click', () => dispatch({ type: 'RESUME' }));
  const help = h('button', { class: 'aw-btn', type: 'button', text: 'Controls help', 'aria-expanded': 'false', 'aria-controls': 'aw-controls' });
  const controls = h('dl', { class: 'aw-controls', id: 'aw-controls', hidden: true });
  for (const c of CONTROLS) controls.append(h('div', {}, h('dt', { text: c.keys }), h('dd', { text: c.does })));
  help.addEventListener('click', () => {
    const open = controls.hidden;
    controls.hidden = !open;
    help.setAttribute('aria-expanded', String(open));
  });
  const el = h(
    'div',
    { class: 'aw-modal', hidden: true },
    h(
      'div',
      { class: 'aw-modal__box aw-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'aw-pause-h' },
      h('h2', { class: 'aw-h', id: 'aw-pause-h', text: 'Paused' }),
      h('div', { class: 'aw-modal__row' }, resume, help, h('a', { class: 'aw-btn', href: '/page/', text: 'Read as a page' })),
      controls,
    ),
  );
  return {
    el,
    focusTarget: resume,
    reset() {
      controls.hidden = true;
      help.setAttribute('aria-expanded', 'false');
    },
  };
}

export function createErrorView() {
  const heading = h('h2', { class: 'aw-h', id: 'aw-error-h' });
  const msg = h('p', { id: 'aw-error-p' });
  const detail = h('p', { class: 'aw-stopbtn__place' });
  const reload = h('button', { class: 'aw-btn', type: 'button', text: 'Try again' });
  reload.addEventListener('click', () => window.location.reload());
  const page = h('a', { class: 'aw-btn aw-btn--primary', href: '/page/', text: 'Read it as a page' });
  const el = h(
    'div',
    { class: 'aw-modal aw-error', hidden: true },
    h(
      'div',
      { class: 'aw-modal__box aw-panel', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'aw-error-h', 'aria-describedby': 'aw-error-p' },
      heading,
      msg,
      detail,
      h('div', { class: 'aw-modal__row' }, page, reload),
    ),
  );
  return {
    el,
    focusTarget: page,
    /** Point "Read it as a page" at the stop or page the visitor's link was for. */
    setPageHref(href: string) {
      page.setAttribute('href', href);
    },
    set(reason: 'webgl' | 'load' | 'context', message?: string) {
      if (reason === 'webgl') {
        setText(heading, "Your browser can't show the 3D view");
        setText(msg, 'The flight needs WebGL, which this browser or device has turned off. Everything is on the plain page instead.');
        reload.hidden = true;
      } else if (reason === 'context') {
        setText(heading, 'The 3D view stopped');
        setText(msg, 'Your browser shut the 3D view down, which can happen when the device runs short of graphics memory. You can try again, or read everything as a plain page.');
        reload.hidden = false;
      } else {
        setText(heading, "Couldn't load Auckland");
        setText(msg, 'The map did not finish loading. You can try again, or read everything as a plain page.');
        reload.hidden = false;
      }
      setText(detail, message ?? '');
      detail.hidden = !message;
    },
  };
}
