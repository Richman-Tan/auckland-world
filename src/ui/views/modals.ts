/** Pause menu and error screen. */
import type { AppEvent } from '../../app/contracts';
import type { Settings, SettingsStore } from '../../app/settings';
import { CONTROLS } from '../controls';
import { h, setText } from '../dom';

/** One row of the settings panel: a label and a set of buttons, exactly one of them pressed. */
interface SettingRow<K extends keyof Settings = keyof Settings> {
  key: K;
  label: string;
  options: readonly (readonly [value: Settings[K], text: string])[];
  note?: string;
}
const row = <K extends keyof Settings>(r: SettingRow<K>) => r as unknown as SettingRow;

const SETTING_ROWS: SettingRow[] = [
  row({
    key: 'graphics',
    label: 'Graphics',
    options: [['auto', 'Auto'], ['high', 'Sharp'], ['low', 'Fast']],
    note: 'Auto lowers the detail while frames are slow and gives it back when they recover.',
  }),
  row({
    key: 'invertPitch',
    label: 'W, or stick up',
    options: [[false, 'Dives'], [true, 'Climbs']],
  }),
  row({
    key: 'motion',
    label: 'Motion',
    options: [['auto', 'Auto'], ['reduced', 'Reduced']],
    note: 'Reduced keeps the camera level and still, and cuts to a stop instead of racing there. Auto follows your device.',
  }),
];

/** The settings panel: every change applies at once and is remembered. */
function createSettingsPanel(settings: SettingsStore): HTMLElement {
  const el = h('div', { class: 'aw-settings', id: 'aw-settings', hidden: true });
  const refresh: (() => void)[] = [];
  for (const r of SETTING_ROWS) {
    const group = h('div', { class: 'aw-settings__opts', role: 'group', 'aria-label': r.label });
    for (const [value, text] of r.options) {
      const b = h('button', { class: 'aw-btn aw-settings__opt', type: 'button', text, 'aria-pressed': 'false' });
      b.addEventListener('click', () => settings.set({ [r.key]: value }));
      refresh.push(() => b.setAttribute('aria-pressed', String(settings.get()[r.key] === value)));
      group.append(b);
    }
    el.append(h('div', { class: 'aw-settings__row' }, h('span', { class: 'aw-settings__label', text: r.label }), group, r.note ? h('p', { class: 'aw-settings__note', text: r.note }) : null));
  }
  const sync = () => refresh.forEach((f) => f());
  settings.subscribe(sync);
  sync();
  return el;
}

export function createPauseView(dispatch: (e: AppEvent) => void, settings?: SettingsStore) {
  const resume = h('button', { class: 'aw-btn aw-btn--primary', type: 'button', text: 'Resume' });
  resume.addEventListener('click', () => dispatch({ type: 'RESUME' }));
  const help = h('button', { class: 'aw-btn', type: 'button', text: 'Controls help', 'aria-expanded': 'false', 'aria-controls': 'aw-controls' });
  const controls = h('dl', { class: 'aw-controls', id: 'aw-controls', hidden: true });
  for (const c of CONTROLS) controls.append(h('div', {}, h('dt', { text: c.keys }), h('dd', { text: c.does })));
  const panel = settings ? createSettingsPanel(settings) : null;
  const gear = panel ? h('button', { class: 'aw-btn', type: 'button', text: 'Settings', 'aria-expanded': 'false', 'aria-controls': 'aw-settings' }) : null;
  // Settings and the controls list share the space under the buttons: opening one closes the other.
  const show = (which: 'help' | 'settings' | null) => {
    controls.hidden = which !== 'help';
    help.setAttribute('aria-expanded', String(which === 'help'));
    if (panel) panel.hidden = which !== 'settings';
    gear?.setAttribute('aria-expanded', String(which === 'settings'));
  };
  help.addEventListener('click', () => show(controls.hidden ? 'help' : null));
  gear?.addEventListener('click', () => show(panel?.hidden ? 'settings' : null));
  const el = h(
    'div',
    { class: 'aw-modal', hidden: true },
    h(
      'div',
      { class: 'aw-modal__box aw-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'aw-pause-h' },
      h('h2', { class: 'aw-h', id: 'aw-pause-h', text: 'Paused' }),
      h('div', { class: 'aw-modal__row' }, resume, gear, help, h('a', { class: 'aw-btn', href: '/page/', text: 'Read as a page' })),
      panel,
      controls,
    ),
  );
  return {
    el,
    focusTarget: resume,
    reset() {
      show(null);
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
