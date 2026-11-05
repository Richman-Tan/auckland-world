/**
 * The overlay while walking a room: where you are, a Leave button, the "use" prompt for whatever
 * you are facing (also a tap target on phones), and a short fade on the way in and out.
 */
import type { AppEvent } from '../../app/contracts';
import { h, setText } from '../dom';

export interface RoomSpotInfo {
  id: string;
  action: string;
}

export function createRoomView(dispatch: (e: AppEvent) => void) {
  const label = h('p', { class: 'aw-room__label' });
  const leave = h('button', { class: 'aw-btn aw-room__leave', type: 'button', text: 'Leave' });
  leave.addEventListener('click', () => dispatch({ type: 'LEAVE_ROOM' }));
  const use = h('button', { class: 'aw-room__use', type: 'button', hidden: true });
  use.addEventListener('click', () => dispatch({ type: 'ROOM_USE' }));
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const hint = h('p', {
    class: 'aw-room__hint',
    text: coarse ? 'Drag or use the stick to walk · tap a screen prompt to read' : 'WASD or arrows to walk · E to use · Esc to leave',
  });
  const status = h('p', { class: 'aw-sr', 'aria-live': 'polite' });
  const el = h('div', { class: 'aw-room', hidden: true }, h('div', { class: 'aw-room__top' }, label, leave), use, hint, status);
  const fade = h('div', { class: 'aw-fade', 'aria-hidden': 'true' });
  let spot = '';

  return {
    el,
    fade,
    setPlace(text: string): void {
      setText(label, text);
    },
    setSpot(s: RoomSpotInfo | null): void {
      const key = s ? s.id : '';
      if (key === spot) return;
      spot = key;
      use.hidden = !s;
      if (!s) return;
      use.replaceChildren(h('b', { text: coarse ? 'Tap' : '[E]' }), document.createTextNode(` ${s.action}`));
      setText(status, s.action);
    },
    /** Cut through black: used when entering or leaving a room. */
    flash(): void {
      fade.classList.remove('is-on');
      void fade.offsetWidth;
      fade.classList.add('is-on');
    },
  };
}
