import type { LoadProgress } from '../../app/contracts';
import { h, setText } from '../dom';
import { loadingFraction, loadingText } from '../format';

export function createLoadingView() {
  const fill = h('div', { class: 'aw-loading__fill' });
  const bar = h(
    'div',
    { class: 'aw-loading__bar', role: 'progressbar', 'aria-label': 'Loading Auckland', 'aria-valuemin': 0, 'aria-valuemax': 100, 'data-indeterminate': 'true' },
    fill,
  );
  const mb = h('p', { class: 'aw-loading__mb', text: '0.0 MB' });
  const label = h('p', { class: 'aw-loading__mb' });
  const el = h(
    'div',
    { class: 'aw-loading', hidden: true, role: 'status' },
    h('h2', { class: 'aw-loading__title', text: 'Loading Auckland…' }),
    bar,
    mb,
    label,
    h('p', { class: 'aw-loading__hint', text: 'About 30,000 real buildings from OpenStreetMap' }),
  );
  return {
    el,
    set(p: LoadProgress) {
      const f = loadingFraction(p.loadedBytes, p.totalBytes);
      bar.dataset.indeterminate = String(f === null);
      if (f === null) bar.removeAttribute('aria-valuenow');
      else {
        bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
        const w = `${Math.round(f * 100)}%`;
        if (fill.style.width !== w) fill.style.width = w;
      }
      setText(mb, loadingText(p.loadedBytes, p.totalBytes));
      setText(label, p.label);
    },
  };
}
