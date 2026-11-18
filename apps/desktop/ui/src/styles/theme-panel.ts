/* The theme customizer (Settings > Appearance): presets, brand, type, shape, colours, contrast, share. Changes show at
   once on the whole app. Ported from v6 theme.js; the runtime it edits is theme.ts. */
import { esc } from '../core/dom';
import { ui } from '../components';
import type { SegElement } from '../components';
import {
  CASES, CORNERS, DENSITIES, DERIVED, DOCK_BLAME, EDITABLE, FONTS, GROUPS, PAIRS, PRESETS, compositeOf, hexOf, ratio, setThemeRefresh, themeApi, themeInternals
} from './theme';
import type { PresetId } from './theme';

const HEX = /^#[0-9a-f]{6}$/i;
const idOf = (token: string): string => 'hxt-' + token.slice(2);
let panel: HTMLElement | null = null;   // the customizer's container once Settings mounts it

/* a radio segmented control named for the change handler and labelled by its row */
function segHTML(name: string, options: Array<{ value: string; label?: string; ariaLabel?: string }>, cls?: string): string {
  return ui.html.segmented({ mode: 'radio', size: 's', options, class: cls }).replace(' data-ui="seg"', ' data-ui="seg" data-name="' + name + '" aria-labelledby="' + name + '-l"');
}
function choice(name: string, label: string, options: readonly string[], labels: readonly string[]): string {
  return '<div class="ui-set__row"><span class="ui-set__label" id="' + name + '-l"><span>' + esc(label) + '</span></span>' +
    segHTML(name, options.map((o, i) => ({ value: o, label: labels[i] ?? o }))) + '</div>';
}

export function mountThemePanel(container: HTMLElement | null): void {
  if (!container) return;
  container.innerHTML =
    '<section class="hx-set" aria-labelledby="hxt-h-preset"><h3 class="ui-set__head" id="hxt-h-preset">Theme</h3>' +
      '<div class="hxt-presets" role="radiogroup" aria-labelledby="hxt-h-preset">' + Object.entries(PRESETS).map(([id, p]) =>
        '<label class="hxt-preset" data-hx-preset="' + id + '" data-hx-case="' + p.case + '"><input type="radio" name="hxt-preset" id="hxt-preset-' + id + '" value="' + id + '">' +
        '<span class="hxt-preset__chips" aria-hidden="true"><i style="background:var(--bg-1)"></i><i style="background:var(--bg-2)"></i><i style="background:var(--bg-3)"></i><i style="background:var(--text)"></i><i style="background:var(--brass)"></i><i style="background:var(--red)"></i></span>' +
        '<span class="hxt-preset__name">' + esc(p.name) + '</span><span class="hxt-preset__note">' + esc(p.note) + '</span></label>').join('') + '</div>' +
    '</section>' +
    '<section class="hx-set" aria-labelledby="hxt-h-brand"><h3 class="ui-set__head" id="hxt-h-brand">Brand</h3>' +
      '<div class="ui-set__row"><span class="ui-set__label" id="hxt-logo-l"><span>Logo</span><small>The mark in the title bar</small></span>' +
        segHTML('hxt-logo', [{ value: 'closed', ariaLabel: 'Closed, Φ' }, { value: 'open', ariaLabel: 'Open, φ' }], 'hxt-logos') + '</div>' +
    '</section>' +
    '<section class="hx-set" aria-labelledby="hxt-h-type"><h3 class="ui-set__head" id="hxt-h-type">Type</h3>' +
      '<div class="ui-set__row"><label class="ui-set__label" for="hxt-sans"><span>Interface font</span><small>Labels, buttons and the conversation</small></label><select id="hxt-sans" class="ui-input hxt-select">' + FONTS.sans.map((f) => '<option>' + esc(f[0]) + '</option>').join('') + '</select></div>' +
      '<div class="ui-set__row"><label class="ui-set__label" for="hxt-mono"><span>Code font</span><small>Code, paths, times and costs</small></label><select id="hxt-mono" class="ui-input hxt-select">' + FONTS.mono.map((f) => '<option>' + esc(f[0]) + '</option>').join('') + '</select></div>' +
      choice('hxt-case', 'Interface text', CASES, ['Sentence case', 'lowercase']) +
    '</section>' +
    '<section class="hx-set" aria-labelledby="hxt-h-shape"><h3 class="ui-set__head" id="hxt-h-shape">Shape</h3>' +
      choice('hxt-corners', 'Corners', CORNERS, ['Sharp', 'Default', 'Round']) +
      choice('hxt-density', 'Density', DENSITIES, ['Compact', 'Regular', 'Comfortable']) +
    '</section>' +
    '<section class="hx-set" aria-labelledby="hxt-h-colours"><h3 class="ui-set__head" id="hxt-h-colours">Colours</h3>' +
      '<p class="hxt-hint">Changes show at once. Lines and hover fills follow the text colour. The dock stays black in every theme.</p>' +
      GROUPS.map(([g, rows]) => '<h4 class="hxt-group">' + g + '</h4>' + rows.map(([t, label, note]) =>
        '<div class="hxt-row" data-token="' + t + '">' +
          '<input type="color" class="hxt-swatch" id="' + idOf(t) + '-c" aria-label="' + esc(label) + ' colour">' +
          '<label class="hxt-row__label" for="' + idOf(t) + '-x"><span>' + esc(label) + '<i class="hxt-flag" title="Fails a contrast check" hidden></i></span>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</label>' +
          '<input type="text" class="ui-input ui-input--mono hxt-hex" id="' + idOf(t) + '-x" spellcheck="false" autocomplete="off" maxlength="7" aria-label="' + esc(label) + ' hex value">' +
          '<button type="button" class="ui-btn ui-btn--ghost ui-btn--s hxt-undo" data-undo="' + t + '" aria-label="Reset ' + esc(label) + ' to the theme colour"><span>Reset</span></button>' +
        '</div>').join('')).join('') +
    '</section>' +
    '<section class="hx-set" aria-labelledby="hxt-h-contrast"><h3 class="ui-set__head" id="hxt-h-contrast">Contrast</h3><ul class="hxt-contrast" id="hxt-contrast" aria-live="polite"></ul></section>' +
    '<section class="hx-set" aria-labelledby="hxt-h-share"><h3 class="ui-set__head" id="hxt-h-share">Share</h3>' +
      '<label class="hxt-json-label" for="hxt-json">Theme as JSON. Copy it to share, or paste one and apply it.</label>' +
      '<textarea id="hxt-json" class="ui-input ui-input--mono hxt-json" rows="7" spellcheck="false"></textarea>' +
      '<div class="hxt-actions">' +
        '<button type="button" class="ui-btn ui-btn--s" id="hxt-copy"><span>Copy JSON</span></button>' +
        '<button type="button" class="ui-btn ui-btn--s" id="hxt-apply"><span>Apply JSON</span></button>' +
        '<label class="ui-btn ui-btn--s hxt-file" for="hxt-file"><span>Import file</span><input type="file" id="hxt-file" accept="application/json,.json"></label>' +
        '<button type="button" class="ui-btn ui-btn--ghost ui-btn--s hxt-end" id="hxt-reset"><span>Reset to theme</span></button>' +
      '</div>' +
      '<p class="hxt-msg" id="hxt-msg" role="status"></p>' +
    '</section>';
  // the logo choice shows the two marks themselves (the sprite keeps both)
  const marks: Record<string, string> = { closed: '<svg aria-hidden="true" focusable="false"><use href="#i-phi-closed"/></svg>', open: '<svg aria-hidden="true" focusable="false" class="is-open"><use href="#i-phi"/></svg>' };
  for (const b of container.querySelectorAll<HTMLElement>('.hxt-logos [data-value]')) b.insertAdjacentHTML('afterbegin', marks[b.dataset['value'] ?? 'closed'] ?? '');
  ui.hydrate(container);
  panel = container;
  wireUI(container);
  setThemeRefresh(refreshUI);
  refreshUI();
}

let rafPending = 0, msgTimer = 0;
function setColor(token: string, value: string): void {
  if (!HEX.test(value)) return;
  themeInternals.theme.colors[token] = value.toLowerCase();
  if (rafPending) return;
  rafPending = requestAnimationFrame(() => { rafPending = 0; themeInternals.apply(); });
}
function say(text: string, isError?: boolean): void {
  if (!panel) return;
  const m = panel.querySelector<HTMLElement>('#hxt-msg'); if (!m) return;
  m.textContent = text;
  m.classList.toggle('is-error', !!isError);
  clearTimeout(msgTimer);
  if (!isError) msgTimer = window.setTimeout(() => { m.textContent = ''; }, 3000);
}
function applyJSON(): void {
  const text = (panel?.querySelector<HTMLTextAreaElement>('#hxt-json'))?.value ?? '';
  try { themeApi.importJSON(text); say('Theme applied.'); }
  catch (err) { say((err as Error).message, true); }
}
function wireUI(ui0: HTMLElement): void {
  ui0.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'hxt-preset') themeApi.preset(t.value);
    else if (t.id === 'hxt-sans') themeApi.set({ sans: t.value });
    else if (t.id === 'hxt-mono') themeApi.set({ mono: t.value });
    else if (t.id === 'hxt-file' && t.files && t.files[0]) {
      const r = new FileReader();
      r.onload = () => { const ta = ui0.querySelector<HTMLTextAreaElement>('#hxt-json'); if (ta) ta.value = String(r.result || ''); applyJSON(); };
      r.onerror = () => say('The file could not be read. Try pasting its text instead.', true);
      r.readAsText(t.files[0]);
      t.value = '';
    } else if (t.classList.contains('hxt-hex')) {
      const row = t.closest<HTMLElement>('.hxt-row'); if (!row) return;
      const v = t.value.trim().startsWith('#') ? t.value.trim() : '#' + t.value.trim();
      if (HEX.test(v)) setColor(row.dataset['token'] ?? '', v);
      else { t.value = hexOf(row.dataset['token'] ?? ''); say('Use a six-digit hex colour, such as #c8a66a.', true); }
    }
  });
  const SEG: Record<string, 'case' | 'corners' | 'density' | 'logo'> = { 'hxt-case': 'case', 'hxt-corners': 'corners', 'hxt-density': 'density', 'hxt-logo': 'logo' };
  ui0.addEventListener('ui:change', (e) => {
    const key = SEG[(e.target as HTMLElement).dataset?.['name'] ?? ''];
    if (key) themeApi.set({ [key]: (e as CustomEvent<{ value: string }>).detail.value });
  });
  ui0.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const row = t.closest<HTMLElement>('.hxt-row');
    if (!row) return;
    if (t.classList.contains('hxt-swatch')) { const hx = row.querySelector<HTMLInputElement>('.hxt-hex'); if (hx) hx.value = t.value; setColor(row.dataset['token'] ?? '', t.value); }
    else if (t.classList.contains('hxt-hex')) { const v = t.value.trim(); if (HEX.test(v)) setColor(row.dataset['token'] ?? '', v); }
  });
  ui0.addEventListener('click', (e) => {
    const target = e.target as Element;
    const u = target.closest<HTMLElement>('[data-undo]');
    if (u) { delete themeInternals.theme.colors[u.dataset['undo'] ?? '']; themeInternals.apply(); return; }
    const hit = (id: string): boolean => !!target.closest('#' + id);   // the buttons carry their label in a span
    if (hit('hxt-reset')) { themeApi.reset(); say('Back to the ' + PRESETS[themeInternals.theme.preset].name + ' colours.'); return; }
    if (hit('hxt-apply')) { applyJSON(); return; }
    if (hit('hxt-copy')) {
      const ta = ui0.querySelector<HTMLTextAreaElement>('#hxt-json'); if (!ta) return;
      ta.value = themeApi.exportJSON();
      const fallback = (): void => { ta.focus(); ta.select(); say('Copying is blocked here. The JSON is selected: copy it with your keyboard.'); };
      try { void navigator.clipboard.writeText(ta.value).then(() => say('Copied.'), fallback); } catch { fallback(); }
    }
  });
}

/** which rows fail which pair, for the flag dots and the contrast list (exported for the unit tests) */
export function failingPairs(values: Record<string, string>): Array<{ fg: string; bg: string; min: number; label: string; scope: 'dock' | undefined; r: number }> {
  const val = (k: string, scope?: 'dock'): string => (!scope && !k.includes('@') && values[k]) || compositeOf(k, scope);
  return PAIRS.map(([fg, bg, min, label, scope]) => ({ fg, bg, min, label, scope, r: ratio(val(fg, scope), val(bg, scope)) })).filter((p) => p.r < p.min - 0.005);
}
export function blame(f: { fg: string; bg: string; scope: 'dock' | undefined }): string[] {
  const parts = (k: string): string[] => k.split('@').flatMap((t) => (EDITABLE.includes(t) ? [t] : [...(DERIVED[t] ?? [])]));
  return f.scope === 'dock' ? [...(DOCK_BLAME[f.fg] ?? []), ...(DOCK_BLAME[f.bg] ?? [])] : [...parts(f.fg), ...parts(f.bg)];
}

function refreshUI(): void {
  const ui1 = panel;
  if (!ui1 || !ui1.isConnected) return;
  const th = themeInternals.theme, eff = themeInternals.effective;
  const presetIn = ui1.querySelector<HTMLInputElement>('#hxt-preset-' + th.preset); if (presetIn) presetIn.checked = true;
  const sans = ui1.querySelector<HTMLSelectElement>('#hxt-sans'), mono = ui1.querySelector<HTMLSelectElement>('#hxt-mono');
  if (sans) sans.value = String(eff('sans'));
  if (mono) mono.value = String(eff('mono'));
  for (const [name, val] of [['hxt-case', eff('case')], ['hxt-corners', eff('corners')], ['hxt-density', eff('density')], ['hxt-logo', eff('logo')]] as const) {
    const sg = ui1.querySelector<SegElement>('[data-name="' + name + '"]'); if (sg && sg.select) sg.select(String(val));
  }
  const values: Record<string, string> = {};
  for (const t of EDITABLE) values[t] = hexOf(t);
  for (const row of ui1.querySelectorAll<HTMLElement>('.hxt-row')) {
    const t = row.dataset['token'] ?? '', v = values[t] ?? '';
    const sw = row.querySelector<HTMLInputElement>('.hxt-swatch'), hx = row.querySelector<HTMLInputElement>('.hxt-hex');
    if (sw && document.activeElement !== sw) sw.value = v;
    if (hx && document.activeElement !== hx) hx.value = v;
    row.classList.toggle('is-changed', t in th.colors);
  }
  const fails = failingPairs(values);
  const flagged = new Set(fails.flatMap(blame));
  for (const row of ui1.querySelectorAll<HTMLElement>('.hxt-row')) { const f = row.querySelector<HTMLElement>('.hxt-flag'); if (f) f.hidden = !flagged.has(row.dataset['token'] ?? ''); }
  const list = ui1.querySelector('#hxt-contrast');
  if (list) list.innerHTML = fails.length
    ? fails.map((f) => '<li class="is-fail"><span>' + esc(f.label) + '</span><span class="hxt-ratio">' + f.r.toFixed(1) + ':1, needs ' + f.min + ':1</span></li>').join('')
    : '<li><span>Every checked pair passes WCAG AA.</span><span class="hxt-ratio">' + PAIRS.length + ' pairs</span></li>';
  const ta = ui1.querySelector<HTMLTextAreaElement>('#hxt-json');
  if (ta && document.activeElement !== ta) ta.value = themeApi.exportJSON();
}
export type { PresetId };
