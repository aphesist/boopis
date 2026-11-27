/* The new-bot form (the Bots tab's own: the preview, the name, the look, what it does, suggestions) on the kit (the repass's step 2a): the
   kit's Dialog in its form shape, drawn in the view in place of the room (no scrim: the roster beside it shows the draft as you type),
   with the kit's Field for the name and what it does, the look picker (Segmented tabs over Swatches), the suggestions as the kit's
   ListRows, and Create as its Button. No board draws it; O-B06's team plan is the nearest drawn state for making a team (rule 6). */
import { emit } from '../../core/bus';
import { cap1, el, frag, reduced } from '../../core/dom';
import { setState, state } from '../../core/state';
import { announce, kit, oc } from '@boopis/ui';
import { data } from '../../data';
import { DRAFT_COLOR, paintOrb } from './paint';
import { lookPicker, lookWords, offeredShapes } from './look-picker';
import type { LookTab } from './look-picker';
import { rollLook } from '@boopis/ui';
import { gentleFollow, orbButton, setReact } from './orbs';
import { modelFieldHTML, openModelMenu, wireModelField } from './model-pick';
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
  const sugg = data().bots.catalog().suggestions;
  /* the kit's Dialog, in place: its title, its body (drawn below), Create; its close goes back to the bot you came from (none when there
     is no bot yet: there is nowhere to go back to) */
  const dlg = kit.wire(frag(kit.html.dialog({
    title: 'New bot', scrim: false, body: '', id: 'bt-new-dialog',
    actions: [{ label: 'Create bot', variant: 'primary' }],
    attrs: { 'aria-modal': null, 'data-new-bot': '' }
  })));
  const dbody = dlg.querySelector<HTMLElement>('.k7-dialog__body') as HTMLElement;
  const close = dlg.querySelector<HTMLElement>('[data-dialog-close]');
  if (close) { close.setAttribute('aria-label', 'Close new bot'); if (!S.bots.length) close.hidden = true; close.addEventListener('click', () => { openBot(S.sel); focusConversation(); }); }
  const go = dlg.querySelector<HTMLButtonElement>('.k7-dialog__foot .k7-btn') as HTMLButtonElement;
  go.setAttribute('data-go', ''); go.setAttribute('data-clip-label', '');
  const goLabel = go.querySelector('.k7-btn__label') as HTMLElement;

  /* calm, not lively: orb2's lively idle swings the head up to about 72 degrees (rim peeks, sky gazes); on a narrow,
     pointy or low-faced body (triangle, drop, star, diamond, tall) that tips the whole silhouette and takes the face
     past its edge, so the eyes vanish and pop back: the owner's "flickers and flashes, depending on the shape". Calm
     glances (about 22 degrees), blinks and eye morphs keep the preview alive; under reduced motion it is the glance lead. */
  const pv = orbButton({ ...d, name: 'Preview' }, 128, 'Preview of the new bot', { motion: 'calm' });
  const preview = pv.orb;
  preview.setAttribute('shadow', '');
  S.newFollow?.dispose();
  const follow = S.newFollow = gentleFollow(() => preview, 0.55);

  /* the name: the kit's Field, its note under it (what the name will become), the dice at its end */
  const nameF = kit.wire(frag(kit.html.field({ id: 'bt-new-name', label: 'Name', placeholder: 'Name your bot', value: d.name, hint: ' ', keys: 'alt+R', attrs: { maxlength: '24', autocomplete: 'off', spellcheck: 'false', 'aria-keyshortcuts': 'Alt+R', 'data-hx-focus': 'messages', 'data-new-name': '' } })));
  const nameIn = nameF.querySelector<HTMLInputElement>('input') as HTMLInputElement;
  const note = nameF.querySelector<HTMLElement>('.k7-field__hint') as HTMLElement;
  note.textContent = ''; note.setAttribute('aria-live', 'polite');
  const dice = kit.iconButton({ icon: 'dice', label: 'Surprise me with a name, colour and shape', tip: 'Surprise me', keys: 'alt+R', variant: 'ghost', attrs: { 'data-dice': '', 'aria-keyshortcuts': 'Alt+R' } });
  /* Colour and Shape: the look picker the look editor uses too */
  const picker = lookPicker({
    value: d, tab: d.tab === 'shape' ? 'shape' : 'colour',
    onTab: (t: LookTab) => { d.tab = t; },
    onPick: (what, look) => {
      if (what === 'color') { d.color = look.color; apply('color'); oc(preview, 'blink'); }
      else { follow.faceOn(560); d.shape = look.shape; apply('shape'); oc(preview, 'poke', 0.5, { react: false }); }
    }
  });
  const roleF = kit.wire(frag(kit.html.field({ id: 'bt-new-role', kind: 'multiline', rows: 3, label: 'What it does', placeholder: 'Reviews pull requests before I merge', value: d.role })));
  const roleIn = roleF.querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;

  const form = el('div', { class: 'bt-new-form' }, [
    el('div', { class: 'bt-stage' }, pv),
    el('div', { class: 'bt-name-row' }, [nameF, dice]),
    picker.el,
    roleF
  ]);
  dbody.append(form);
  /* suggestions: a ListRow each (its look's orb, its name, what it does); a press fills the form */
  if (sugg.length) {
    const list = kit.wire(frag('<section class="bt-suggest" aria-label="Suggestions">' + kit.html.sectionHead({ title: 'Or start from one of these' }) +
      kit.html.list({ label: 'Suggestions', rows: sugg.map((s, i) => ({ variant: 'bot' as const, title: cap1(s.name), sub: s.desc, bot: { shape: s.shape, color: s.color, name: s.name }, attrs: { 'data-sugg': String(i) } })) }) + '</section>'));
    list.addEventListener('click', (e) => {
      const r = (e.target as Element).closest<HTMLElement>('[data-sugg]'); if (!r) return;
      const s = sugg[Number(r.dataset['sugg'])]; if (!s) return;
      const reshape = s.shape !== d.shape;
      Object.assign(d, { name: s.name.replace(/\s+/g, '-'), role: s.desc, shape: s.shape, color: s.color });
      if (reshape) follow.faceOn(560);
      nameIn.value = d.name; roleIn.value = d.role; picker.set(d); apply('all'); oc(preview, 'poke', reshape ? 0.5 : 0.9, { react: !reshape });
    });
    dbody.append(list);
  }
  pane.append(el('div', { class: 'bt-new-scroll ui-scroll' }, [el('div', { class: 'bt-new-col' }, dlg)]));

  function apply(what: 'color' | 'shape' | 'all'): void {
    if (what === 'color' || what === 'all') paintOrb(preview, d);
    if (what === 'shape' || what === 'all') preview.setAttribute('shape', d.shape);
    paintGo(); paintDraftRow();
  }
  /* the button names the bot as you type or roll (an empty name gets one from the list on create, so the button is never disabled for
     want of a name) */
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
    announce('Name: ' + name + ', ' + lookWords(look) + (rolledOut ? '. Every name in the list is taken, so it has a number.' : ''));
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

  /* A live bot is a Hermes profile, a folder of its own: say which one, and which model it starts on, before making it (a kit Block in
     the dialog's body, with Back and Make; Create waits while it shows) */
  function confirmLive(admin: NonNullable<ReturnType<typeof data>['bots']['admin']>): void {
    const plan = admin.planCreate(d.name);
    const models = admin.models();
    let model = plan.model ?? models[0] ?? null;
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const box = kit.wire(frag(kit.html.block({ attrs: { 'data-confirm': plan.profile, role: 'group', 'aria-label': 'Make ' + plan.profile }, body: '<div class="bt-confirm">' +
      '<p class="k7-pane__note">' + esc(plan.profile) + ' gets a folder of its own.</p>' + (plan.folder ? '<p class="k7-pane__note k7-mono bt-confirm__path">' + esc(plan.folder) + '</p>' : '') +
      plan.notes.map((n) => '<p class="k7-pane__note">' + esc(n) + '</p>').join('') +
      (models.length ? kit.html.card({ variant: 'settings', rows: [{ label: 'Model', sub: 'You can change it later.', control: modelFieldHTML('model', 'Model', model ?? '') }] }) : '') +
      '<p class="k7-pane__note bt-sheet__error" role="alert" data-confirm-error hidden></p>' +
      '<div class="bt-confirm__acts">' + kit.html.button({ label: 'Back', variant: 'ghost', size: 32, attrs: { 'data-confirm-act': 'back' } }) + kit.html.button({ label: 'Make ' + plan.profile, variant: 'primary', size: 32, attrs: { 'data-confirm-act': 'make' } }) + '</div></div>' })));
    const field = box.querySelector<HTMLElement>('[data-model-pick]');
    if (field) wireModelField(field, () => { openModelMenu(field, { label: 'Model', models, value: field.dataset['value'] ?? '', onPick: (v) => { model = v; } }); });
    const err = box.querySelector<HTMLElement>('[data-confirm-error]') as HTMLElement;
    const back = box.querySelector<HTMLButtonElement>('[data-confirm-act="back"]') as HTMLButtonElement, make = box.querySelector<HTMLButtonElement>('[data-confirm-act="make"]') as HTMLButtonElement;
    go.hidden = true; dbody.append(box);
    const leave = (): void => { box.remove(); go.hidden = false; go.disabled = false; go.focus({ preventScroll: true }); };
    back.addEventListener('click', leave);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leave(); } });
    make.addEventListener('click', () => {
      make.disabled = true; back.disabled = true; err.hidden = true;
      setReact(preview, 'thinking');
      admin.create({ name: d.name, role: d.role, shape: d.shape, color: d.color, instructions: d.role.trim() }, { model })
        .then((nb) => {
          setReact(preview, 'done');
          later(() => { openBot(nb.id); emit('hx:bot-select', { id: nb.id, from: 'bots-new' }); }, 900);
        })
        .catch((e: unknown) => { setReact(preview, 'idle'); make.disabled = false; back.disabled = false; err.textContent = 'It was not made: ' + (e instanceof Error ? e.message : String(e)); err.hidden = false; });
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
