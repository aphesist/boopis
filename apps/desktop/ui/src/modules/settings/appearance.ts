/* Settings › Appearance (board 14's Appearance card; its page is derived from those rows): Theme (Follow system, Dark, Light), Accent
   (Iris and the other candidates board P1 drew, each a colour beside its name), Corners (Standard, Rounder), then today's Size and
   "Grow bots on hover". The same three look rows head General's Appearance card (board 14) and write the same choices.
   v6's theme customizer (its presets, fonts, case, density, colour editing, contrast list and JSON) is gone: the app is a v7 root since
   the repass, and those changed only v6's tokens, which no converted screen reads. */
import { kit } from '@boopis/ui';
import { on } from '../../core/bus';
import { setState, state } from '../../core/state';
import { ACCENTS, UI_SIZES, loadLook } from '../../core/settings';
import type { AccentId, UiSize } from '../../core/settings';
import { setLook } from '../../styles/v7-look';
import { themeApi } from '../../styles/theme';
import { canZoom, onUiSizeChange, setUiSize, uiSize, uiZoomPercent } from '../shell/ui-size';
import { pageEl, fill } from './page';
import type { Page } from './page';
import { openSelect, section, segHTML, selectHTML, switchHTML } from './rows';
import type { RowOpts } from './rows';

const THEMES = [{ value: 'system', label: 'Follow system' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] as const;
const themeNow = (): string => (loadLook().followSystem ? 'system' : themeApi.scheme());
const dot = (hex: string): string => kit.html.swatchDot(hex);
const accentNow = (): (typeof ACCENTS)[number] => ACCENTS.find((a) => a.id === loadLook().accent) ?? { id: 'iris', label: 'Iris', hex: '' };

/** the three look rows (board 14): Theme, Accent, Corners */
export function lookRows(): RowOpts[] {
  const a = accentNow();
  return [
    { label: 'Theme', control: selectHTML('theme', 'Theme', THEMES.find((t) => t.value === themeNow())?.label ?? 'Dark') },
    { label: 'Accent', control: kit.html.selectorItem({ variant: 'field', label: 'Accent', value: a.label, swatch: a.hex, attrs: { 'data-select': 'accent' } }) },
    { label: 'Corners', control: segHTML('corners', 'Corners', [{ value: 'standard', label: 'Standard' }, { value: 'rounder', label: 'Rounder' }], loadLook().corners) }
  ];
}

/** wire the look rows under `host`; `redraw` draws them again after a choice (a select's value changes) */
export function wireLook(host: HTMLElement, redraw: () => void): void {
  host.addEventListener('click', (e) => {
    const sel = (e.target as Element).closest<HTMLElement>('[data-select="theme"], [data-select="accent"]');
    if (!sel || !host.contains(sel)) return;
    if (sel.dataset['select'] === 'theme') {
      openSelect(sel, { label: 'Theme', value: themeNow(), choices: THEMES, onPick: (v) => {
        if (v === 'system') setLook({ followSystem: true });
        else { setLook({ followSystem: false }); setState({ theme: v }); }
        redraw();
      } });
    } else {
      openSelect(sel, { label: 'Accent', value: loadLook().accent, choices: ACCENTS.map((x) => ({ value: x.id, label: x.label, leadHTML: dot(x.hex) })), onPick: (v) => { setLook({ accent: v as AccentId }); redraw(); } });
    }
  });
  host.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset['set'] === 'corners') setLook({ corners: (e as CustomEvent<{ value: string }>).detail.value === 'rounder' ? 'rounder' : 'standard' });
  });
}

const SIZE_LABELS: Readonly<Record<UiSize, string>> = { default: 'Default', larger: 'Larger', largest: 'Largest' };
const sizeHint = (): string => 'Text, bots and layout grow together. ' + (canZoom() ? 'Now ' + uiZoomPercent() + '%.' : 'The desktop app applies it.');

export function appearancePage(): Page {
  const { el, body } = pageEl('appearance', 'Appearance');
  const draw = (): void => {
    fill(body,
      section('Theme', lookRows(), { 'data-part': 'look' }) +
      section('Size', [{ label: 'Interface size', sub: sizeHint(), control: segHTML('size', 'Interface size', UI_SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s] })), uiSize()) }]) +
      section('Bots', [{ label: 'Grow bots on hover', sub: 'Bots in the dock grow under the pointer.', control: switchHTML('orb-grow', 'Grow bots on hover', state.orbGrow) }]));
  };
  draw();
  wireLook(body, draw);
  body.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement, v = (e as CustomEvent<{ value: unknown }>).detail.value;
    if (t.dataset['set'] === 'size') setUiSize(v as UiSize);
    else if (t.dataset['set'] === 'orb-grow') setState({ orbGrow: !!v });
  });
  onUiSizeChange(() => { const s = body.querySelector('[data-set="size"]')?.closest('.k7-row')?.querySelector('.k7-row__sub'); if (s) s.textContent = sizeHint(); });
  /* the theme moves from elsewhere too (mod+shift+L, the system): the rows follow */
  on('hx:state', (d) => { if (d?.changed.some((k) => k === 'theme' || k === 'orbGrow') && !body.contains(document.activeElement)) draw(); });
  return { el, refresh: async () => { draw(); } };
}

