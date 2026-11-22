/* the new-bot form (the bots tab's own: stage, name, pickers, suggestions); library controls throughout */
import { emit } from '../../core/bus';
import { $, cap1, el, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { ui } from '@boopis/ui';
import { oc } from '@boopis/ui';
import { data } from '../../data';
import { DRAFT_COLOR, paintOrb } from './paint';
import { lookPicker, lookWords, offeredShapes } from './look-picker';
import type { LookTab } from './look-picker';
import { rollLook } from '@boopis/ui';
import { gentleFollow, orbButton, orbEl, setReact } from './orbs';
import { S } from './model';
import type { Draft } from './model';
import { markSelected, paintDraftRow } from './list';
import { closeSettings } from './settings';
import { focusConversation, openBot } from './room';
import { botNames, isRollKey, nameNote } from './names';
import { checkClips } from './clips';

const later = (fn: () => void, ms: number): number => window.setTimeout(fn, reduced() ? Math.min(ms, 300) : ms);

export function openNew(seed?: Partial<Draft>): void {
  S.view = 'new';
  if (state.tab !== 'bots') setState({ tab: 'bots' });
  if (!S.room) { markSelected(); return; }
  closeSettings(true);
  S.room.hidden = true; (S.newPane as HTMLElement).hidden = false;
  if (S.groupPane) S.groupPane.hidden = true;
  if (S.newGroupPane) S.newGroupPane.hidden = true;
  buildNew(seed);
  markSelected();
  emit('hx:title', { tab: 'bots', title: 'New bot' });
}
function buildNew(seed?: Partial<Draft>): void {
  const pane = S.newPane as HTMLElement; pane.textContent = '';
  const d: Draft = S.draft = { name: '', role: '', color: DRAFT_COLOR, shape: 'circle', tab: 'colour', ...(seed ?? {}) };
  /* calm, not lively: orb2's lively idle swings the head up to about 72 degrees (rim peeks, sky gazes); on a narrow,
     pointy or low-faced body (triangle, drop, star, diamond, tall) that tips the whole silhouette and takes the face
     past its edge, so the eyes vanish and pop back: the owner's "flickers and flashes, depending on the shape". Calm
     glances (about 22 degrees), blinks and eye morphs keep the preview alive; under reduced motion it is the glance lead. */
  const pv = orbButton({ ...d, name: 'Preview' }, 128, 'Preview of the new bot', { motion: 'calm' });
  const preview = pv.orb;
  preview.setAttribute('shadow', '');
  S.newFollow?.dispose();
  const follow = S.newFollow = gentleFollow(() => preview, 0.55);

  const noteId = 'bt-name-note-' + Math.random().toString(36).slice(2, 7);
  const nameIn = el('input', { class: 'bt-name', type: 'text', maxlength: '24', placeholder: 'Name your bot', 'aria-label': 'Name', 'aria-describedby': noteId, 'aria-keyshortcuts': 'Alt+R', autocomplete: 'off', spellcheck: 'false', value: d.name, 'data-hx-focus': 'messages' });
  /* Surprise me: the library's icon button with its dice glyph */
  const dice = ui.iconButton({ icon: 'dice', label: 'Surprise me with a name, colour and shape', tip: 'Surprise me', keys: 'alt+R', size: 's' });
  dice.classList.add('bt-dice');
  const note = el('p', { class: 'bt-name-note', id: noteId });
  /* Colour and Shape: the look picker the look editor uses too */
  const picker = lookPicker({
    value: d, tab: d.tab === 'shape' ? 'shape' : 'colour',
    onTab: (t: LookTab) => { d.tab = t; },
    onPick: (what, look) => {
      if (what === 'color') { d.color = look.color; apply('color'); oc(preview, 'blink'); }
      else { follow.faceOn(560); d.shape = look.shape; apply('shape'); oc(preview, 'poke', 0.5, { react: false }); }
    }
  });
  const roleField = ui.field({ kind: 'textarea', label: 'What it does', placeholder: 'For example: reviews every pull request before I merge', value: d.role, raised: true });
  const roleIn = $<HTMLTextAreaElement>('textarea', roleField);
  const go = ui.button({ label: 'Create bot', variant: 'primary', disabled: true });
  go.classList.add('bt-go');
  const back = S.bots.length ? ui.iconButton({ icon: 'close', label: 'Close new bot', keys: 'esc' }) : null;
  if (back) { back.classList.add('bt-new-close'); back.addEventListener('click', () => { openBot(S.sel); focusConversation(); }); }

  const goRow = el('div', { class: 'bt-go-row' }, go);
  const form = el('div', { class: 'bt-new-form' }, [
    el('div', { class: 'bt-stage' }, pv),
    el('div', { class: 'bt-name-row' }, [nameIn, dice]),
    note,
    picker.el,
    el('div', { class: 'bt-new-field' }, roleField),
    goRow
  ]);
  const sugg = data().bots.catalog().suggestions;
  const suggest = sugg.length ? el('section', { class: 'bt-suggest', 'aria-label': 'Suggestions' }, [
    el('h2', { class: 'ui-group__head bt-suggest-h', text: 'Or start from one of these' }),
    el('div', { class: 'bt-suggest-row' }, sugg.map((s) => {
      const btn = el('button', { class: 'bt-sugg', type: 'button' }, [orbEl({ shape: s.shape, color: s.color, name: s.name }, 32), el('span', { class: 'bt-sugg-text' }, [el('span', { class: 'bt-sugg-name', text: cap1(s.name) }), el('span', { class: 'bt-sugg-desc', text: s.desc })])]);
      btn.addEventListener('click', () => {
        const reshape = s.shape !== d.shape;
        Object.assign(d, { name: s.name.replace(/\s+/g, '-'), role: s.desc, shape: s.shape, color: s.color });
        if (reshape) follow.faceOn(560);
        nameIn.value = d.name; roleIn.value = d.role; roleIn.dispatchEvent(new Event('input')); picker.set(d); apply('all'); oc(preview, 'poke', reshape ? 0.5 : 0.9, { react: !reshape });
      });
      return btn;
    }))
  ]) : null;
  pane.append(el('div', { class: 'bt-new-scroll ui-scroll' }, [el('div', { class: 'bt-new-col' }, [back, form, suggest])]));

  function apply(what: 'color' | 'shape' | 'all'): void {
    if (what === 'color' || what === 'all') paintOrb(preview, d);
    if (what === 'shape' || what === 'all') preview.setAttribute('shape', d.shape);
    paintGo(); paintDraftRow();
  }
  /* the caption under the preview is the button: it names the bot as you type or roll (an empty name gets one from
     the list on create, so the button is never disabled for want of a name) */
  const goLabel = el('span', { class: 'bt-go-label' });
  $('span', go).replaceChildren(goLabel);
  function paintGo(): void {
    const n = d.name.trim();
    go.disabled = false;
    goLabel.textContent = n ? 'Create ' + n : 'Create bot';
    if (n) go.setAttribute('data-tip', 'Create ' + n); else go.removeAttribute('data-tip');
    pv.setAttribute('aria-label', n ? 'Preview of ' + n : 'Preview of the new bot');
    paintNote();
    checkClips();
  }
  /* what the name will turn into: a name in use gets a number on create; a rolled name past the end of the list has
     one already (say why) */
  let rolledOut = false;
  function paintNote(): void {
    const n = d.name.trim();
    const t = nameNote(n, botNames.taken(n), botNames.next(n), rolledOut);
    if (note.textContent !== t) note.textContent = t;
  }
  function roll(): void {
    const name = botNames.pick({ avoid: d.name });
    rolledOut = botNames.exhausted();
    d.name = name; nameIn.value = name;
    /* the look too: only the attributes that change are written, so orb2 morphs (shape, colour, eyes) as for a pick */
    const look = rollLook({ shapes: offeredShapes(), taken: S.bots.length ? S.bots : data().bots.snapshot().bots, avoid: d });
    const reshape = look.shape !== d.shape;
    if (reshape) follow.faceOn(560);
    d.shape = look.shape; d.color = look.color;
    picker.set(d); apply('color'); apply('shape');
    oc(preview, 'blink');
    ui.announce('Name: ' + name + ', ' + lookWords(look) + (rolledOut ? '. Every name in the list is taken, so it has a number.' : ''));
  }
  dice.addEventListener('click', () => roll());
  form.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (pv.contains(t)) { follow.release(); return; }
    const r = t.getBoundingClientRect(); follow.hold(r.left + r.width / 2, r.top + r.height / 2);
    if (t === nameIn || t === roleIn) setReact(preview, 'listening');
  });
  form.addEventListener('focusout', () => { follow.release(); if (preview.dataset['base'] === 'listening') setReact(preview, 'idle'); });
  nameIn.addEventListener('input', () => { rolledOut = false; d.name = nameIn.value.replace(/\s+/g, '-').toLowerCase(); if (d.name !== nameIn.value) { const p = nameIn.selectionStart ?? 0; nameIn.value = d.name; nameIn.setSelectionRange(p, p); } paintGo(); paintDraftRow(); });
  nameIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); create(); return; }
    if (isRollKey(e)) { e.preventDefault(); e.stopPropagation(); roll(); }
  });
  roleIn.addEventListener('input', () => { d.role = roleIn.value; });
  go.addEventListener('click', () => create());

  /* A live bot is a Hermes profile, a folder of its own: say which one, and which model it starts on, before making it */
  function confirmLive(admin: NonNullable<ReturnType<typeof data>['bots']['admin']>): void {
    const plan = admin.planCreate(d.name);
    const models = admin.models();
    let model = plan.model;
    const box = el('section', { class: 'bt-confirm', role: 'group', 'aria-label': 'Make ' + plan.profile }, [
      el('p', { class: 'bt-confirm-line', text: 'This makes ' + plan.profile + ' a folder of its own. Its instructions, memory, skills and schedule live there.' }),
      plan.folder ? el('p', { class: 'bt-confirm-path ui-mono', text: plan.folder }) : null,
      ...plan.notes.map((n) => el('p', { class: 'bt-confirm-line bt-confirm-note', text: n }))
    ]);
    if (models.length) {
      const f = ui.field({ kind: 'model', label: 'Model', options: models, value: model ?? models[0] ?? '', hint: 'From the providers boopis has keys for. You can change it later in its settings.' });
      f.addEventListener('ui:change', (e) => { model = (e as CustomEvent<{ value: string }>).detail.value; });
      model = model ?? models[0] ?? null;
      box.append(f);
    }
    const err = el('p', { class: 'bt-confirm-err', role: 'alert' });
    const back = ui.button({ label: 'Back' });
    const make = ui.button({ label: 'Make ' + plan.profile, variant: 'primary' });
    const acts = el('div', { class: 'bt-confirm-acts' }, [back, make]);
    box.append(err, acts);
    go.hidden = true; goRow.append(box);
    const leave = (): void => { box.remove(); go.hidden = false; go.disabled = false; go.focus({ preventScroll: true }); };
    back.addEventListener('click', leave);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leave(); } });
    make.addEventListener('click', () => {
      make.disabled = true; back.disabled = true; err.textContent = '';
      setReact(preview, 'thinking');
      admin.create({ name: d.name, role: d.role, shape: d.shape, color: d.color, instructions: d.role.trim() }, { model })
        .then((nb) => {
          setReact(preview, 'done');
          later(() => { openBot(nb.id); emit('hx:bot-select', { id: nb.id, from: 'bots-new' }); }, 900);
        })
        .catch((e: unknown) => { setReact(preview, 'idle'); make.disabled = false; back.disabled = false; err.textContent = 'It was not made: ' + (e instanceof Error ? e.message : String(e)); });
    });
    requestAnimationFrame(() => make.focus({ preventScroll: true }));
  }
  function create(): void {
    if (!d.name.trim()) { d.name = botNames.pick(); rolledOut = botNames.exhausted(); nameIn.value = d.name; paintDraftRow(); }
    const admin = data().bots.admin;
    if (admin) { confirmLive(admin); return; }
    const nb = data().bots.create({ name: d.name, role: d.role, shape: d.shape, color: d.color, instructions: d.role.trim() });
    const id = nb.id;
    setReact(preview, 'done');
    go.disabled = true;
    later(() => {
      openBot(id);
      emit('hx:bot-select', { id, from: 'bots-new' });
      S.composer?.focus();
    }, 900);
  }
  paintGo();
  if (!seed) later(() => nameIn.focus({ preventScroll: true }), 60);
}
