/* The theme customizer (Settings > Appearance): presets, brand, type, shape, colours, contrast, share. Changes show at
   once on the whole app. Ported from v6 theme.js; the runtime it edits is theme.ts. */
import { esc } from '../core/dom';
import { ui } from '../components';
import type { SegElement, SelectElement } from '../components';
import {
  CASES, CORNERS, DENSITIES, DERIVED, DOCK_BLAME, EDITABLE, FONTS, GROUPS, PAIRS, PRESETS, compositeOf, hexOf, ratio, setThemeRefresh, themeApi, themeInternals
} from './theme';
import type { PresetId } from './theme';

const HEX = /^#[0-9a-f]{6}$/i;
const idOf = (token: string): string => 'hxt-' + token.slice(2);
let panel: HTMLElement | null = null;   // the customizer's container once Settings mounts it

/* a choice: a settings row whose control is a small radio segmented control, named for the change handler and labelled by its row */
function choice(name: string, label: string, options: readonly string[], labels: readonly string[]): string {
  return ui.html.setRow({ label, labelId: name + '-l', control: ui.html.segmented({ mode: 'radio', size: 's', labelledby: name + '-l', attrs: { 'data-name': name },
    options: options.map((o, i) => ({ value: o, label: labels[i] ?? o })) }) });
}

/** a font choice: the library's select in a settings row (the list is drawn by boopis, never by the platform) */
function fontRow(id: string, label: string, hint: string, fonts: ReadonlyArray<readonly [string, ...unknown[]]>): string {
  return ui.html.setRow({ label, hint, labelId: id + '-l', control: ui.html.select({ id, labelId: id + '-l', entries: fonts.map((f) => ({ value: f[0] })), class: 'hxt-select' }) });
}

export function mountThemePanel(container: HTMLElement | null): void {
  if (!container) return;
  container.innerHTML =
    '<section class="ui-set" aria-labelledby="hxt-h-preset">' + ui.html.setHead({ id: 'hxt-h-preset', label: 'Theme' }) +
      '<div class="hxt-presets" role="radiogroup" aria-labelledby="hxt-h-preset">' + Object.entries(PRESETS).map(([id, p]) =>
        '<label class="hxt-preset" data-hx-preset="' + id + '" data-hx-case="' + p.case + '"><input type="radio" name="hxt-preset" id="hxt-preset-' + id + '" value="' + id + '">' +
        '<span class="hxt-preset__chips" aria-hidden="true"><i style="background:var(--bg-1)"></i><i style="background:var(--bg-2)"></i><i style="background:var(--bg-3)"></i><i style="background:var(--text)"></i><i style="background:var(--brass)"></i><i style="background:var(--red)"></i></span>' +
        '<span class="hxt-preset__name">' + esc(p.name) + '</span><span class="hxt-preset__note">' + esc(p.note) + '</span></label>').join('') + '</div>' +
    '</section>' +
    '<section class="ui-set" aria-labelledby="hxt-h-type">' + ui.html.setHead({ id: 'hxt-h-type', label: 'Type' }) +
      fontRow('hxt-sans', 'Interface font', 'Labels, buttons and the conversation', FONTS.sans) +
      fontRow('hxt-mono', 'Code font', 'Code, paths, times and costs', FONTS.mono) +
      choice('hxt-case', 'Interface text', CASES, ['Sentence case', 'lowercase']) +
    '</section>' +
    '<section class="ui-set" aria-labelledby="hxt-h-shape">' + ui.html.setHead({ id: 'hxt-h-shape', label: 'Shape' }) +
      choice('hxt-corners', 'Corners', CORNERS, ['Sharp', 'Default', 'Round']) +
      choice('hxt-density', 'Density', DENSITIES, ['Compact', 'Regular', 'Comfortable']) +
    '</section>' +
    '<section class="ui-set" aria-labelledby="hxt-h-colours">' + ui.html.setHead({ id: 'hxt-h-colours', label: 'Colours' }) +
      '<p class="hxt-hint">Changes show at once. Lines and hover fills follow the text colour. The dock stays black in every theme.</p>' +
      GROUPS.map(([g, rows]) => '<h4 class="hxt-group">' + g + '</h4>' + rows.map(([t, label, note]) =>
        '<div class="hxt-row" data-token="' + t + '">' +
          '<button type="button" class="hxt-swatch" id="' + idOf(t) + '-c" aria-label="' + esc(label) + ' colour: edit its hex value"></button>' +
          '<label class="hxt-row__label" for="' + idOf(t) + '-x"><span>' + esc(label) + '<i class="hxt-flag" role="img" aria-label="Fails a contrast check" data-tip="Fails a contrast check" hidden></i></span>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</label>' +
          ui.html.input({ id: idOf(t) + '-x', mono: true, class: 'hxt-hex', label: label + ' hex value', attrs: { maxlength: 7 } }) +
          ui.html.button({ label: 'Reset', variant: 'ghost', size: 's', class: 'hxt-undo', attrs: { 'data-undo': t, 'aria-label': 'Reset ' + label + ' to the theme colour' } }) +
        '</div>').join('')).join('') +
    '</section>' +
    '<section class="ui-set" aria-labelledby="hxt-h-contrast">' + ui.html.setHead({ id: 'hxt-h-contrast', label: 'Contrast' }) + '<ul class="hxt-contrast" id="hxt-contrast" aria-live="polite"></ul></section>' +
    '<section class="ui-set" aria-labelledby="hxt-h-share">' + ui.html.setHead({ id: 'hxt-h-share', label: 'Share' }) +
      '<label class="hxt-json-label" for="hxt-json">Theme as JSON. Copy it to share, or paste one and apply it.</label>' +
      ui.html.input({ id: 'hxt-json', mono: true, rows: 7, class: 'hxt-json', attrs: { autocomplete: null } }) +
      '<div class="hxt-actions">' +
        ui.html.button({ label: 'Copy JSON', size: 's', attrs: { id: 'hxt-copy' } }) +
        ui.html.button({ label: 'Apply JSON', size: 's', attrs: { id: 'hxt-apply' } }) +
        '<label class="ui-btn ui-btn--s hxt-file" for="hxt-file"><span>Import file</span><input type="file" id="hxt-file" accept="application/json,.json"></label>' +
        ui.html.button({ label: 'Reset to theme', variant: 'ghost', size: 's', class: 'hxt-end', attrs: { id: 'hxt-reset' } }) +
      '</div>' +
      '<p class="hxt-msg" id="hxt-msg" role="status"></p>' +
    '</section>';
  ui.hydrate(container);
  panel = container;
  wireUI(container);
  setThemeRefresh(refreshUI);
  refreshUI();
}

let rafPending = 0, msgTimer = 0;
function setColor(token: string, value: string): void {
  if (!HEX.test(value)) return;
  themeApi.endPreview(false);   /* editing a colour is choosing another theme: a mod's preview gives way at once */
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
  const SEG: Record<string, 'case' | 'corners' | 'density'> = { 'hxt-case': 'case', 'hxt-corners': 'corners', 'hxt-density': 'density' };
  ui0.addEventListener('ui:change', (e) => {
    const id = (e.target as HTMLElement).id, value = (e as CustomEvent<{ value: string }>).detail.value;
    if (id === 'hxt-sans') { themeApi.set({ sans: value }); return; }
    if (id === 'hxt-mono') { themeApi.set({ mono: value }); return; }
    const key = SEG[(e.target as HTMLElement).dataset?.['name'] ?? ''];
    if (key) themeApi.set({ [key]: value });
  });
  ui0.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const row = t.closest<HTMLElement>('.hxt-row');
    if (!row) return;
    if (t.classList.contains('hxt-hex')) { const v = t.value.trim(); if (HEX.test(v)) setColor(row.dataset['token'] ?? '', v); }
  });
  ui0.addEventListener('click', (e) => {
    const target = e.target as Element;
    const swatch = target.closest<HTMLElement>('.hxt-swatch');
    if (swatch) { const hx = swatch.closest('.hxt-row')?.querySelector<HTMLInputElement>('.hxt-hex'); hx?.focus(); hx?.select(); return; }
    const u = target.closest<HTMLElement>('[data-undo]');
    if (u) { themeApi.endPreview(false); delete themeInternals.theme.colors[u.dataset['undo'] ?? '']; themeInternals.apply(); return; }
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
  const sans = ui1.querySelector<SelectElement>('#hxt-sans'), mono = ui1.querySelector<SelectElement>('#hxt-mono');
  if (sans) sans.value = String(eff('sans'));
  if (mono) mono.value = String(eff('mono'));
  for (const [name, val] of [['hxt-case', eff('case')], ['hxt-corners', eff('corners')], ['hxt-density', eff('density')]] as const) {
    const sg = ui1.querySelector<SegElement>('[data-name="' + name + '"]'); if (sg && sg.select) sg.select(String(val));
  }
  const values: Record<string, string> = {};
  for (const t of EDITABLE) values[t] = hexOf(t);
  for (const row of ui1.querySelectorAll<HTMLElement>('.hxt-row')) {
    const t = row.dataset['token'] ?? '', v = values[t] ?? '';
    const sw = row.querySelector<HTMLElement>('.hxt-swatch'), hx = row.querySelector<HTMLInputElement>('.hxt-hex');
    if (sw) sw.style.setProperty('--sw', v);
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
