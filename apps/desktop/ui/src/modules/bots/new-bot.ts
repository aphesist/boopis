/* the new-bot form (the bots tab's own: stage, name, pickers, suggestions); library controls throughout */
import { emit } from '../../core/bus';
import { $, cap1, el, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { ui } from '../../components';
import { oc } from '../../components/orb';
import { data } from '../../data';
import { DRAFT_COLOR, EYES, paintOrb, SHAPES, SWATCHES } from './paint';
import { gentleFollow, orbButton, orbEl, setReact } from './orbs';
import { S } from './model';
import type { Draft } from './model';
import { markSelected, paintDraftRow } from './list';
import { closeSettings } from './settings';
import { focusConversation, openBot } from './room';

const later = (fn: () => void, ms: number): number => window.setTimeout(fn, reduced() ? Math.min(ms, 300) : ms);

export function openNew(seed?: Partial<Draft>): void {
  S.view = 'new';
  if (state.tab !== 'bots') setState({ tab: 'bots' });
  if (!S.room) { markSelected(); return; }
  closeSettings(true);
  S.room.hidden = true; (S.newPane as HTMLElement).hidden = false;
  buildNew(seed);
  markSelected();
  emit('hx:title', { tab: 'bots', title: 'New bot' });
}
function buildNew(seed?: Partial<Draft>): void {
  const pane = S.newPane as HTMLElement; pane.textContent = '';
  const d: Draft = S.draft = { name: '', role: '', color: DRAFT_COLOR, shape: 'circle', eyes: 'pill', tab: 'colour', ...(seed ?? {}) };
  const pv = orbButton({ ...d, name: 'Preview' }, 128, 'Preview of the new bot', { motion: 'lively' });
  const preview = pv.orb;
  preview.setAttribute('shadow', '');
  const follow = gentleFollow(() => preview, 0.55);

  const nameIn = el('input', { class: 'bt-name', type: 'text', maxlength: '24', placeholder: 'Name your bot', 'aria-label': 'Name', autocomplete: 'off', spellcheck: 'false', value: d.name, 'data-hx-focus': 'messages' });
  const TABS = [['colour', 'Colour'], ['shape', 'Shape'], ['eyes', 'Eyes']] as const;
  const rowId = 'bt-pick-' + Math.random().toString(36).slice(2, 7);
  const tabs = ui.segmented({ mode: 'tabs', label: 'Appearance', value: d.tab, options: TABS.map(([value, label]) => ({ value, label })), controls: { colour: rowId, shape: rowId, eyes: rowId } });
  const row = el('div', { class: 'bt-pick', role: 'tabpanel', id: rowId });
  const roleField = ui.field({ kind: 'textarea', label: 'What it does', placeholder: 'For example: reviews every pull request before I merge', value: d.role, raised: true });
  const roleIn = $<HTMLTextAreaElement>('textarea', roleField);
  const go = ui.button({ label: 'Create bot', variant: 'primary', disabled: true });
  go.classList.add('bt-go');
  const back = S.bots.length ? ui.iconButton({ icon: 'close', label: 'Close new bot', keys: 'esc' }) : null;
  if (back) { back.classList.add('bt-new-close'); back.addEventListener('click', () => { openBot(S.sel); focusConversation(); }); }

  const form = el('div', { class: 'bt-new-form' }, [
    el('div', { class: 'bt-stage' }, pv),
    nameIn,
    el('div', { class: 'bt-appearance' }, [tabs, row]),
    el('div', { class: 'bt-new-field' }, roleField),
    el('div', { class: 'bt-go-row' }, go)
  ]);
  const sugg = data().bots.catalog().suggestions;
  const suggest = sugg.length ? el('section', { class: 'bt-suggest', 'aria-label': 'Suggestions' }, [
    el('h2', { class: 'ui-group__head bt-suggest-h', text: 'Or start from one of these' }),
    el('div', { class: 'bt-suggest-row' }, sugg.map((s) => {
      const btn = el('button', { class: 'bt-sugg', type: 'button' }, [orbEl({ shape: s.shape, color: s.color, eyes: 'pill', name: s.name }, 32), el('span', { class: 'bt-sugg-text' }, [el('span', { class: 'bt-sugg-name', text: cap1(s.name) }), el('span', { class: 'bt-sugg-desc', text: s.desc })])]);
      btn.addEventListener('click', () => {
        Object.assign(d, { name: s.name.replace(/\s+/g, '-'), role: s.desc, shape: s.shape, color: s.color });
        nameIn.value = d.name; roleIn.value = d.role; roleIn.dispatchEvent(new Event('input')); apply('all'); oc(preview, 'poke', 0.9);
      });
      return btn;
    }))
  ]) : null;
  pane.append(el('div', { class: 'bt-new-scroll' }, [el('div', { class: 'bt-new-col' }, [back, form, suggest])]));

  tabs.addEventListener('ui:change', (e) => { d.tab = (e as CustomEvent<{ value: string }>).detail.value; paintRow(); });
  function paintRow(): void {
    row.textContent = ''; row.dataset['kind'] = d.tab;
    row.setAttribute('aria-label', cap1(d.tab));
    const shapes = window.OrbAvatar && window.OrbAvatar.bodyShapes ? window.OrbAvatar.bodyShapes.filter((s) => SHAPES.includes(String(s))).map(String) : SHAPES;
    const opts: ReadonlyArray<readonly [string, string] | string> = d.tab === 'colour' ? SWATCHES : d.tab === 'shape' ? shapes : EYES;
    const group = el('div', { class: 'bt-opts', role: 'radiogroup', 'aria-label': cap1(d.tab) });
    for (const o of opts) {
      const val = typeof o === 'string' ? o : o[0];
      const lab = typeof o === 'string' ? cap1(o) : o[1];
      const on = (d.tab === 'colour' ? d.color : d.tab === 'shape' ? d.shape : d.eyes) === val;
      /* the picker tiles are the one place orbs stay still: 28px, many at once, a choice not a creature */
      const inner = d.tab === 'colour'
        ? el('span', { class: 'bt-swatch', style: '--c:' + val })
        : ui.orb(d.tab === 'shape' ? { ...d, shape: val, eyes: 'pill', name: lab } : { ...d, shape: 'circle', eyes: val, name: lab }, { size: 28, still: true });
      group.append(el('button', {
        class: 'bt-opt', type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': lab, 'data-tip': lab, 'data-val': val, tabindex: on ? '0' : '-1',
        onclick: () => choose(val)
      }, inner));
    }
    group.addEventListener('keydown', (e) => {
      const items = [...group.children] as HTMLElement[], i = items.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = items.length - 1;
      const t = items[j];
      if (j >= 0 && t) { e.preventDefault(); t.focus(); t.click(); }
    });
    row.append(group);
  }
  function choose(val: string): void {
    if (d.tab === 'colour') { d.color = val; apply('color'); oc(preview, 'blink'); }
    if (d.tab === 'shape') { d.shape = val; apply('shape'); oc(preview, 'poke', 0.8, { react: false }); }
    if (d.tab === 'eyes') { d.eyes = val; apply('eyes'); }
    paintRow();
    row.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }
  function apply(what: 'color' | 'shape' | 'eyes' | 'all'): void {
    if (what === 'color' || what === 'all') paintOrb(preview, d);
    if (what === 'shape' || what === 'all') preview.setAttribute('shape', d.shape);
    if (what === 'eyes' || what === 'all') { if (typeof (preview as unknown as { morphEyes?: unknown }).morphEyes === 'function') oc(preview, 'morphEyes', d.eyes); else preview.setAttribute('eye-shape', d.eyes); }
    if (what === 'all') paintRow();
    paintGo(); paintDraftRow();
  }
  function paintGo(): void {
    const n = d.name.trim();
    go.disabled = !n;
    $('span', go).textContent = n ? 'Create ' + n : 'Create bot';
  }
  form.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (pv.contains(t)) { follow.release(); return; }
    const r = t.getBoundingClientRect(); follow.hold(r.left + r.width / 2, r.top + r.height / 2);
    if (t === nameIn || t === roleIn) setReact(preview, 'listening');
  });
  form.addEventListener('focusout', () => { follow.release(); if (preview.dataset['base'] === 'listening') setReact(preview, 'idle'); });
  row.addEventListener('pointerover', (e) => { const b = (e.target as Element).closest('.bt-opt'); if (!b) return; const r = b.getBoundingClientRect(); follow.hold(r.left + r.width / 2, r.top + r.height / 2); });
  row.addEventListener('pointerleave', () => follow.release());
  nameIn.addEventListener('input', () => { d.name = nameIn.value.replace(/\s+/g, '-').toLowerCase(); if (d.name !== nameIn.value) { const p = nameIn.selectionStart ?? 0; nameIn.value = d.name; nameIn.setSelectionRange(p, p); } paintGo(); paintDraftRow(); });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); create(); } });
  roleIn.addEventListener('input', () => { d.role = roleIn.value; });
  go.addEventListener('click', () => create());

  function create(): void {
    const nb = data().bots.create({ name: d.name, role: d.role, shape: d.shape, color: d.color, eyes: d.eyes, instructions: d.role.trim() });
    const id = nb.id;
    setReact(preview, 'done');
    go.disabled = true;
    later(() => {
      openBot(id);
      emit('hx:bot-select', { id, from: 'bots-new' });
      S.composer?.focus();
    }, 900);
  }
  paintRow(); paintGo();
  if (!seed) later(() => nameIn.focus({ preventScroll: true }), 60);
}
