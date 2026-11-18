/* The blank's option group (the popover and the compact card): radio options, a free-text answer, number keys. */
import { animate } from './motion';
import type { HxCard } from './card';

export function blankValue(card: HxCard): string | null {
  const input = card.querySelector<HTMLInputElement>('.cd-free input');
  if (input && input.value.trim()) return input.value.trim();
  const o = card.querySelector<HTMLElement>('.cd-opt[aria-checked="true"]');
  return o ? (card.data.options?.[+(o.dataset['opt'] ?? -1)] ?? null) : null;
}

export function wireBlankOptions(card: HxCard): void {
  const group = card.querySelector<HTMLElement & { _wired?: boolean }>('.cd-opts');
  if (!group || group._wired) return;
  group._wired = true;
  const opts = Array.from(group.querySelectorAll<HTMLElement>('.cd-opt'));
  const free = card.querySelector<HTMLElement>('.cd-free'), input = free ? free.querySelector<HTMLInputElement>('input') : null;
  const answer = card.querySelector<HTMLButtonElement>('[data-action="answer"]');
  const checked = (): number => opts.findIndex((o) => o.getAttribute('aria-checked') === 'true');
  function select(i: number, focus: boolean): void {
    opts.forEach((o, j) => { o.setAttribute('aria-checked', String(i === j)); o.tabIndex = (i === j || (i < 0 && j === 0)) ? 0 : -1; });
    if (free) free.toggleAttribute('data-on', i < 0 && !!(input && input.value.trim()));
    const sel = opts[i];
    if (i >= 0 && sel) {
      animate(sel.querySelector('.cd-opt__ring'), [{ transform: 'scale(.5)' }, { transform: 'scale(1)' }], { preset: 'quick' });
      if (focus) sel.focus();
    }
    if (answer) answer.disabled = !(i >= 0 || (input && input.value.trim()));
  }
  select(checked(), false);
  opts.forEach((o, i) => {
    o.addEventListener('click', () => { if (input) input.value = ''; select(i, false); });
    o.addEventListener('dblclick', () => { select(i, false); card.act('answer', { value: blankValue(card) }); });
  });
  group.addEventListener('keydown', (e) => {
    const i = Math.max(0, opts.indexOf(document.activeElement as HTMLElement));
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (i === opts.length - 1 && input) { select(-1, false); input.focus(); } else select((i + 1) % opts.length, true); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); select((i - 1 + opts.length) % opts.length, true); }
    else if (e.key === 'Enter' && checked() >= 0) { e.preventDefault(); card.act('answer', { value: blankValue(card) }); }
  });
  card.addEventListener('keydown', (e) => {
    if (e.target === input) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= opts.length && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (input) input.value = ''; select(n - 1, true); }
  });
  if (input) {
    input.addEventListener('input', () => { if (input.value.trim()) select(-1, false); else select(checked(), false); if (free) free.toggleAttribute('data-on', !!input.value.trim()); if (answer) answer.disabled = !input.value.trim() && checked() < 0; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); card.act('answer', { value: input.value.trim() }); }
      if (e.key === 'ArrowUp') { e.preventDefault(); select(opts.length - 1, true); }
    });
  }
}
