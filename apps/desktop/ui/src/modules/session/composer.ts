/* The session's composer: the kit's one-row Composer with the session's line under it, as boards S20 and S05 B draw it
   (docs/design/v7/boards: sessiontab.js `comp`, `underSess`).

   The line says how the session runs, each item its own control: how careful (the S0 scale's menu, alt+G), the branch, the model
   that answers next with its effort (the "who answers next" menu, alt+M, which holds the effort's levels too; alt+S turns Smart on or
   off; a change of either while the session runs leaves its line in the thread, S33), and at the end how full the
   context is and what the session has spent. The quick menu (a press on the line, or "+") turns items off (S05 B); where the line has
   no room (under 900 wide) the branch and the context fold into it first, and it says what they hold. "+" opens the add
   menu: attach a file or a folder (each a chip in the text, sent with the message), mention a file, start a command. "@" names the
   model that answers this message only (ADR-0036). The words the text is read by carry the kit's Mark (feedforward): a press on one,
   or alt ArrowDown in it, opens what it is read as. While a change waits for your answer, what you type declines it with those
   words (S09). Stop is the composer's own button while a turn runs. */
import { emit } from '../../core/bus';
import { LINE_ITEMS, loadLineHidden, saveLineHidden } from '../../core/settings';
import type { LineItemId } from '../../core/settings';
import { kit, ui } from '@boopis/ui';
import type { ComposerChip, LineItem } from '@boopis/ui';
import { data } from '../../data';
import type { Attached, GovernanceState, SendMeta } from '../../data';
import { CAREFUL } from '../../data';
import { bestMention, findMentions, mentionName, routeMentions } from '../../data/mentions';
import { composerFiles, dictate, later, micUnavailable, micTool, voiceNeedsSetup, voiceTool } from '../chat/compose';
import { kindOf, makeReader, optionsFor } from './feedforward';
import { COUNCIL_VALUE, openCouncilForm } from './council';
import { FOOT_GOVERNED, FOOT_MENTION, FOOT_MENTION_GOVERNED, FOOT_UNGOVERNED, SETTINGS_VALUE, SMART_VALUE, currentChoice, governedUnavailableEntries, modelEntries, smartPreview } from './model-menu';
import { launchView, openCarefulFor } from './launch';
import { kTokens } from './shared';
import { say, v7Attrs } from './s0';

export { SMART_VALUE };
/** an entry of the kit's Menu */
type MenuEntry = Parameters<typeof kit.html.menu>[0]['entries'][number];
const gov = (): GovernanceState => data().details.governance.get();
const called = (m: string): string => ui.modelMark.called(m);

/** the one way the session changes governance: the provider owns the state, the UI announces the change */
export function setGovernance(patch: Partial<Pick<GovernanceState, 'governed' | 'smart' | 'model' | 'cap'>>): void {
  const why = data().details.setGovernance(patch);
  if (why) say(why);
  const g = gov();
  emit('hx:governance', { governed: g.governed, smart: g.smart, model: g.model, cap: g.cap });
}

export interface SessionComposer {
  el: HTMLElement; readonly input: HTMLElement | null; readonly value: string;
  setValue(t: string): void; focus(): void; setRunning(on: boolean): void;
  /** the line, the placeholder and whether a typed message has somewhere to go, read again */ sync(): void;
}
export interface SessionComposerOpts {
  draft: string; sessionId(): string;
  /** a change waits for your answer: typing declines it with feedback */ waits(): boolean;
  /** the last turn ended: the next message is a follow-up */ after(): boolean;
  send(text: string, meta: Pick<SendMeta, 'assume' | 'attachments'>): void; stop(): void;
  /** your last message, for ArrowUp in an empty composer */ lastMessage(): string | null;
}
const NAMES: Readonly<Record<LineItemId, string>> = { careful: 'How careful', branch: 'Branch', model: 'Model and effort', context: 'Context', cost: 'Cost' };
/** how full the context is, as the line's five ticks */
export const contextTicks = (used: number, total: number): number => (total > 0 ? Math.max(0, Math.min(5, Math.ceil((used / total) * 5))) : 0);

/** the line's items for the state the providers hold now (pure but for the reads): what S20 draws, less what the quick menu turned off */
export function lineItems(o: { text: string; attachments: number; sessionId: string; hidden: readonly LineItemId[] }): LineItem[] {
  const G = gov(), controls = data().sessionControls, d = data().details;
  const items: Array<readonly [LineItemId, LineItem]> = [];
  if (controls) {
    const step = controls.launch.get().careful;
    items.push(['careful', { label: 'How careful', value: CAREFUL[step].name, icon: 'shield', plain: true, attrs: { 'data-line': 'careful', 'data-step': step, 'data-tip': 'How careful: ' + CAREFUL[step].meaning, 'data-kbd': 'alt+G', 'aria-haspopup': 'menu' } }]);
  }
  const branch = d.environment.get().branch;
  if (branch) items.push(['branch', { label: 'Branch', value: branch, icon: 'fork', mono: true, plain: true, still: true, fold: true, attrs: { 'data-line': 'branch' } }]);
  /* who answers next: a model's mark and name, Smart (with what it would pick for the text being typed), or a council */
  const choices = d.choices.get();
  const prev = G.smart ? smartPreview(choices, { text: o.text, attachments: o.attachments }) : null;
  const armed = data().council.armed(o.sessionId), asking = armed?.members.length ?? G.council ?? 0;
  const name = asking ? 'Council of ' + asking : G.smart ? (prev ? 'Smart: ' + (called(prev.choice.model) || prev.choice.model) : 'Smart') : ui.modelMark.short(G.model) || G.model || 'Choose a model';
  const tip = G.smart ? 'Smart picks the model for each message' + (prev ? ': ' + prev.reason : '') : 'Who answers next';
  const effort = controls && controls.capabilities.get().launch.efforts.length ? launchView().effortTicks : null;
  items.push(['model', {
    label: 'Who answers next', value: name, plain: true, ...(asking ? { icon: 'bots' } : G.smart || !G.model ? { icon: 'spark' } : { model: G.model }), ...(effort !== null && !asking ? { ticks: effort } : {}),
    attrs: { 'data-line': 'model', 'data-tip': tip, 'data-kbd': 'alt+M', 'aria-haspopup': 'menu' }
  }]);
  const ctx = d.context.get();
  if (ctx.total > 0) items.push(['context', { label: 'Context', value: kTokens(ctx.used) + ' / ' + kTokens(ctx.total), mono: true, end: true, fold: true, ticks: contextTicks(ctx.used, ctx.total), attrs: { 'data-line': 'context' } }]);
  if (G.spent) items.push(['cost', { label: 'Cost', value: G.governed && G.cap ? G.spent + ' of ' + G.cap : G.spent, mono: true, end: true, attrs: { 'data-line': 'cost' } }]);
  return items.filter(([id]) => !o.hidden.includes(id)).map(([, item]) => item);
}
/** the "who answers next" list (model-menu.ts) as the kit's Menu: Automatic first, a council where one can sit, then every model by provider */
export function modelMenu(o: { current: string; governed: boolean; smart: boolean; sessionId: string }): MenuEntry[] {
  const choices = data().details.choices.get();
  const now = o.smart ? SMART_VALUE : currentChoice(choices, o.current)?.value ?? o.current;
  const out: MenuEntry[] = [];
  for (const e of modelEntries(choices, { current: o.current, governed: o.governed, council: data().council.can(o.sessionId) })) {
    if ('options' in e) {
      out.push({ heading: e.label ?? '' });
      for (const x of e.options) out.push({ label: x.label ?? '', value: x.value, ...(x.desc ? { desc: x.desc } : {}), leadHTML: ui.html.modelMark(x.value, { size: 16, label: false }), checked: x.value === now, role: 'menuitemradio', ...(x.disabled ? { disabled: true } : {}) });
    } else out.push({ label: e.label ?? '', value: e.value, ...(e.desc ? { desc: e.desc } : {}), ...(e.icon ? { icon: e.icon } : {}), ...(e.keys ? { keys: e.keys } : {}), ...(e.value === SMART_VALUE ? { checked: now === SMART_VALUE, role: 'menuitemradio' } : {}), ...(e.disabled ? { disabled: true } : {}) });
  }
  return [...out, ...effortEntries(), '-', { heading: o.governed ? FOOT_GOVERNED : FOOT_UNGOVERNED }];
}
/** an effort row's value in the "who answers next" menu */
export const EFFORT_VALUE = '__effort:';
/** the effort, under the models (the line's item is "model and effort", S05 B): the engine's levels, the session's own checked. A level
    that cannot be chosen now says why (the capability map) */
function effortEntries(): MenuEntry[] {
  const c = data().sessionControls; if (!c) return [];
  const caps = c.capabilities.get(), levels = caps.launch.efforts;
  if (!levels.length) return [];
  const can = caps.session.changeModel.ok ? caps.session.changeEffort : caps.launch.effort, now = c.launch.get().effort;
  return ['-', { heading: 'Effort' }, ...levels.map((e): MenuEntry => ({ label: e.charAt(0).toUpperCase() + e.slice(1), value: EFFORT_VALUE + e, checked: now === e, role: 'menuitemradio', ...(can.ok ? {} : { disabled: true, desc: can.why }) }))];
}

export function sessionComposer(slot: HTMLElement, o: SessionComposerOpts): SessionComposer {
  const reader = makeReader(gov);
  const controls = data().sessionControls;
  let running = false, hidden = loadLineHidden(), lineSig = '', ph = '';
  const text = (): HTMLElement | null => slot.querySelector<HTMLElement>('.k7-composer__text');
  const root = (): HTMLElement | null => slot.querySelector<HTMLElement>('.k7-composer');
  const value = (): string => text()?.textContent ?? '';
  /* what is attached: each a chip in the text; the send carries those whose chip is still there */
  const attached = new Map<string, Attached>();
  let chipN = 0;
  const present = (): Attached[] => [...(text()?.querySelectorAll<HTMLElement>('[data-att]') ?? [])].map((n) => attached.get(n.dataset['att'] ?? '')).filter((a): a is Attached => !!a);

  /* as the boards write it: S20 while a change waits, S23 after a turn, "Message" otherwise (S33 and the later boards) */
  const placeholder = (): string => (o.waits() ? 'Send feedback to decline this request' : o.after() ? 'What next?' : 'Message');
  const line = (): LineItem[] => lineItems({ text: value(), attachments: present().length, sessionId: o.sessionId(), hidden });
  /* "@": a mention names the model that answers this message only; the menu's foot says what that means */
  const choicesNow = () => data().details.choices.get();
  const mentions = {
    label: 'Answer this message with', foot: () => (gov().governed ? FOOT_MENTION_GOVERNED : FOOT_MENTION),
    entries: () => choicesNow().map((c) => ({ value: mentionName(c, called), label: called(c.model) || c.model, desc: c.providerName, leadHTML: ui.html.modelMark(c.value, { size: 16, label: false }) })),
    chips: (t: string): ComposerChip[] => findMentions(t, choicesNow(), called).map((m) => ({ at: m.start, text: m.text, html: kit.html.inlineChip({ kind: 'model', model: m.choice.value, text: m.text.slice(1), words: m.text }) }))
  };
  /** to whom the message goes when it names one model: said on the line */
  const routeHint = (t: string): string => { const r = routeMentions(t, choicesNow(), called); return r.kind === 'one' ? 'to ' + mentionName(r.choice, called) + ' only' + (gov().governed ? ', ungoverned' : '') : ''; };
  let hintNow = '';
  function draw(): void {
    const keep = text()?.innerHTML ?? ui.esc(o.draft);
    ph = placeholder(); hintNow = routeHint(value() || o.draft);
    const items = line();
    lineSig = JSON.stringify([items, hintNow]);
    slot.replaceChildren(kit.composer({ kind: 'session', placeholder: ph, label: 'Message the coding agent', running, line: items, ...(hintNow ? { hint: hintNow } : {}), voiceSetup: voiceNeedsSetup(), micOff: micUnavailable(), queueOff: !later('queue') && !o.waits(), stopKeys: 'mod+period', ...(keep ? { textHTML: keep } : {}) }));
    const c = root() as HTMLElement;
    kit.mentions(c, mentions);
    c.setAttribute('data-hx-composer', '');
    text()?.setAttribute('data-hx-focus', 'composer');
    marks();
  }
  /** the line alone, again (typing changes what Smart would pick and to whom the message goes): the text and its caret are not touched */
  function drawLine(): void {
    const items = line(), hint = routeHint(value()), sig = JSON.stringify([items, hint]);
    if (sig === lineSig) return;
    lineSig = sig; hintNow = hint;
    const fresh = kit.composer({ kind: 'session', line: items, ...(hint ? { hint } : {}) }).querySelector('.k7-composer__line');
    const old = slot.querySelector('.k7-composer__line');
    if (fresh && old) old.replaceWith(fresh); else if (fresh) root()?.append(fresh); else old?.remove();
  }
  /* the words the text is read by, each where it stands (the reader names them in order) */
  const marks = (): void => { const t = text(); if (t) kit.composerMarks(t, (s) => { let from = 0; return reader.marks(s).map((m) => { const at = s.indexOf(m.text, from); from = at < 0 ? from : at + m.text.length; return { at, text: m.text, kind: m.kind, chosen: m.confirmed }; }).filter((m) => m.at >= 0); }); };
  function sync(): void {
    const c = root(); if (!c) { draw(); return; }
    kit.composerRunning(c, running);
    c.toggleAttribute('data-queue-off', !later('queue') && !o.waits());
    const want = placeholder();
    if (want !== ph) { ph = want; const t = text(); t?.setAttribute('data-placeholder', ph); }
    drawLine();
  }

  /** a menu of the composer opens over the whole composer, placed against its box, never over the text (a second line of text would lie
      under a menu placed against a button in the row); the control that opened it is what says it is open */
  function openOver(trigger: HTMLElement, o: Parameters<typeof kit.openMenu>[1]): HTMLElement | null {
    const box = slot.querySelector<HTMLElement>('.k7-composer__box');
    if (!box) return kit.openMenu(trigger, o);
    /* one menu at a time: another of the composer's may be open against the same box (a second opening there would only close it) */
    if (document.querySelector('.k7-menu[data-floating]')) kit.closeMenu();
    const menu = kit.openMenu(box, o);
    const says = trigger.tagName === 'BUTTON';
    /* the layer writes aria-expanded on what the menu is placed against: here that is the box, so it is said on the control instead */
    box.removeAttribute('aria-expanded');
    if (says) trigger.setAttribute('aria-expanded', 'true');
    const host = menu?.parentNode;
    if (menu && host) {
      const gone = new MutationObserver(() => {
        if (menu.isConnected) return;
        gone.disconnect();
        box.removeAttribute('aria-expanded');
        if (says) trigger.setAttribute('aria-expanded', 'false');
        /* the menu gave the focus back to the box, which takes none: it goes to the text */
        requestAnimationFrame(() => { const a = document.activeElement; if (!a || a === document.body || a === box) text()?.focus(); });
      });
      gone.observe(host, { childList: true });
    }
    return menu;
  }

  /* ───────── the line's controls ───────── */
  function toggleGoverned(anchor: HTMLElement): void {
    const G = gov(), f = G.frontier;
    if (!G.governed && f) {
      /* governed mode cannot run (ADR-0037): it says so and offers the way to a model that can */
      const entries = governedUnavailableEntries(f).map((e): MenuEntry => (e === '-' ? '-' : 'title' in e ? { heading: e.title ?? '' } : 'foot' in e ? { heading: e.foot ?? '' } : { label: e.label ?? '', ...(e.value != null ? { value: String(e.value) } : {}), ...(e.icon ? { icon: e.icon } : {}) }));
      openOver(anchor, { label: 'Governed mode is unavailable', entries, place: 'above', align: 'start', attrs: v7Attrs(), onSelect: (v) => { if (v === SETTINGS_VALUE) emit('hx:open-settings', { section: 'models', from: 'composer' }); } });
      return;
    }
    setGovernance({ governed: !G.governed });
    ui.announce(gov().governed ? 'Governed' : 'Ungoverned');
  }
  const lineItem = (id: LineItemId): HTMLElement => slot.querySelector<HTMLElement>('[data-line="' + id + '"]') ?? slot.querySelector<HTMLElement>('.k7-composer__box') ?? slot;
  function openModel(viaKeyboard: boolean, anchor: HTMLElement = lineItem('model')): void {
    const G = gov();
    openOver(anchor, {
      label: 'Who answers next', variant: 'list', entries: modelMenu({ current: G.model, governed: G.governed, smart: G.smart, sessionId: o.sessionId() }), place: 'above', align: 'start', attrs: v7Attrs(),
      onSelect: (v) => {
        /* the effort changes in place (a started session's thread gets its line, S33); a refusal is said */
        if (v.startsWith(EFFORT_VALUE)) { void controls?.setEffort(v.slice(EFFORT_VALUE.length)).then((why) => { if (why) say(why); sync(); }); return; }
        if (v === COUNCIL_VALUE) { requestAnimationFrame(() => { void openCouncilForm(lineItem('model'), o.sessionId(), () => { sync(); }); }); return; }
        setGovernance(v === SMART_VALUE ? { smart: true } : { smart: false, model: v });
        if (viaKeyboard) api.focus();
      }
    });
  }
  /** what an item holds when the line has folded it away (a narrow composer, a window under 900 wide: the branch and the context go
      first, S05): the quick menu says it beside the item's name, so nothing is lost with the room. Null for an item that shows */
  function folded(id: LineItemId): string | null {
    const el = slot.querySelector<HTMLElement>('.k7-composer__line > [data-line="' + id + '"][data-fold]');
    if (!el || getComputedStyle(el).display !== 'none') return null;
    return lineItems({ text: value(), attachments: present().length, sessionId: o.sessionId(), hidden: [] }).find((x) => x.attrs?.['data-line'] === id)?.value ?? null;
  }
  /** the quick menu (S05 B): which items show under the composer; a check toggles in place */
  function openQuick(anchor: HTMLElement): void {
    const menu = openOver(anchor, {
      label: 'Quick menu: show under the composer', variant: 'quick', place: 'above', align: 'end', attrs: v7Attrs(),
      entries: [{ heading: 'Quick menu: show under the composer' }, ...LINE_ITEMS.filter((i) => i !== 'careful' || !!controls).map((i) => ({ label: NAMES[i], value: i, checked: !hidden.includes(i), ...(folded(i) ? { desc: folded(i) as string } : {}) }))]
    });
    menu?.addEventListener('ui:select', (e) => {
      const v = (e as CustomEvent<{ value: string }>).detail.value as LineItemId;
      hidden = hidden.includes(v) ? hidden.filter((x) => x !== v) : [...hidden, v];
      saveLineHidden(hidden);
      drawLine();
    });
  }
  /* a word the text is read by: what it is read as, and the way to leave it as words */
  function openReading(anchor: HTMLElement, kind: string, word: string): void {
    if (!kind || !word) return;
    const r = reader.reading(kind, word), k = kindOf(kind);
    openOver(anchor, {
      label: 'How to read ' + word, place: 'above', align: 'start', attrs: v7Attrs(),
      entries: [{ heading: k.title + ' "' + word + '"' }, ...optionsFor(k, word).map((x) => ({ label: x.label, value: x.value, desc: x.desc, checked: x.value === r.value, role: 'menuitemradio' })), '-', { label: 'Leave it as words', value: '__drop', icon: 'close' }, { heading: 'Dashed: my guess. Solid: your choice.' }],
      onSelect: (v) => {
        if (v === '__drop') { r.dropped = true; ui.announce('Dropped ' + word); } else { r.value = v; r.confirmed = true; }
        marks(); drawLine(); requestAnimationFrame(() => api.focus());
      }
    });
  }

  /* ───────── "+": attach, mention a file, a command, the quick menu ───────── */
  function addAttached(list: readonly Attached[]): void {
    const t = text(); if (!t) return;
    t.focus();
    for (const a of list) {
      if (present().some((x) => (a.path ? x.path === a.path : x.name === a.name))) continue;
      const id = 'a' + (++chipN);
      attached.set(id, a);
      /* a chip in the text (owner, 25 November): its name shows; the file rides with the message, so the chip adds no words */
      kit.composerInsertChip(t, kit.html.inlineChip({ kind: 'reference', text: a.name, words: '', attrs: { 'data-att': id, 'data-tip': a.path ?? a.name, 'data-att-kind': a.kind } }));
    }
    drawLine();
  }
  function pick(kind: 'file' | 'folder'): void {
    data().files.pick(kind).then(addAttached).catch((e: unknown) => { say(e instanceof Error ? e.message : 'Attaching did not work'); }).finally(() => { api.focus(); });
  }
  const insert = (s: string): void => { const t = text(); if (!t) return; t.focus(); kit.composerInsert(t, (value() && !/\s$/.test(value()) ? ' ' : '') + s); };
  /** mention a file: the gateway completes the word; a folder opens, a file is written as its reference */
  function openMention(word: string): void {
    void data().files.complete(word, o.sessionId()).then((r) => {
      const anchor = slot.querySelector<HTMLElement>('[data-plus]') ?? slot;
      const entries: MenuEntry[] = r.items.length
        ? [{ heading: 'Mention a file' }, ...r.items.map((i) => ({ label: i.display, value: i.text, ...(i.meta ? { desc: i.meta } : {}), icon: /[:/]$/.test(i.text) ? 'folder' : 'file' }))]
        : [{ heading: 'Mention a file' }, { heading: r.unavailable ?? 'No files match.' }];
      openOver(anchor, { label: 'Mention a file', entries, place: 'above', align: 'start', attrs: v7Attrs(), onSelect: (v) => { if (/\/$/.test(v)) requestAnimationFrame(() => { openMention(v); }); else insert(v + ' '); } });
    });
  }
  function openAdd(anchor: HTMLElement): void {
    openOver(anchor, {
      label: 'Add', place: 'above', align: 'start', attrs: v7Attrs(),
      entries: [
        { label: 'Attach a file', value: 'file', icon: 'file' }, { label: 'Add a folder to context', value: 'folder', icon: 'folder' },
        ...(data().info.live ? [{ label: 'Mention a file', value: '@file:', icon: 'at' }] : []), { label: 'Commands', value: '/', icon: 'slash' },
        '-', { label: 'Show under the composer', value: 'quick', icon: 'sliders' }
      ],
      onSelect: (v) => {
        requestAnimationFrame(() => {
          if (v === 'file' || v === 'folder') pick(v);
          else if (v === '@file:') openMention(v);
          else if (v === 'quick') openQuick(anchor);
          else insert(v);
        });
      }
    });
  }

  /* ───────── events: the slot's, so they hold across a redraw ───────── */
  slot.addEventListener('ui:add', (e) => { e.preventDefault(); openAdd(slot.querySelector<HTMLElement>('[data-plus]') ?? slot); });
  slot.addEventListener('ui:send', (e) => {
    const t = (e as CustomEvent<{ text: string }>).detail.text;
    const assume = reader.items(t).map((i) => i.label), attachments = present();
    reader.clear(); attached.clear();
    o.send(t, { assume, attachments });
    requestAnimationFrame(sync);
  });
  slot.addEventListener('ui:steer', (e) => { e.preventDefault(); const c = root(); if (c) (c.querySelector('[data-send]') as HTMLElement | null)?.click(); });   /* ctrl Enter sends as Enter does until the keys get their own pass (owner, 25 November) */
  slot.addEventListener('ui:refused', () => { say('The agent is still working. Stop it, or wait for it, then send.'); });
  slot.addEventListener('ui:stop', () => { o.stop(); });
  voiceTool(slot, () => null);   /* the voice circle: it talks once a voice model is set up, and says what it needs until then */
  micTool(slot);                 /* a build with no dictation says so at the mic */
  slot.addEventListener('ui:mark', (e) => { const d = (e as CustomEvent<{ text: string; kind: string; el: HTMLElement }>).detail; openReading(d.el, d.kind, d.text); });
  let stopHearing: (() => void) | null = null;
  slot.addEventListener('ui:dictate', (e) => {
    stopHearing?.(); stopHearing = null;
    if ((e as CustomEvent<{ on: boolean }>).detail.on) stopHearing = dictate(slot, null);   /* the words arrive in the text where the caret stands (the kit's Composer) */
  });
  slot.addEventListener('input', () => { marks(); drawLine(); });
  slot.addEventListener('click', (e) => {
    const t = e.target as Element;
    const item = t.closest<HTMLElement>('[data-line]');
    if (item?.dataset['line'] === 'careful') { if (controls) openCarefulFor(item, 'above'); return; }
    if (item?.dataset['line'] === 'model') { openModel(false, item); return; }
    /* a press on the line itself (not on one of its controls) opens the quick menu (S05 B) */
    const l = t.closest<HTMLElement>('.k7-composer__line');
    if (l && !t.closest('button')) openQuick(lineItem('model'));
  });
  /* KEYMAP section 7: alt+G (how careful, or governed where there is no scale), alt+S (Smart), alt+M (who answers next), alt+C (a
     council), alt+A (attach); alt+V (talk) and Esc while dictating are the kit Composer's own; ArrowUp in an empty composer brings your
     last message back */
  slot.addEventListener('keydown', (e) => {
    if (!(e.target as Element).closest('.k7-composer__text')) return;
    if (e.key === 'ArrowUp' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !value().trim()) { const last = o.lastMessage(); if (last) { e.preventDefault(); api.setValue(last); } return; }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.code === 'KeyG') { e.preventDefault(); const item = lineItem('careful'); if (controls) openCarefulFor(item, 'above'); else toggleGoverned(item); }
    else if (e.code === 'KeyS') { e.preventDefault(); setGovernance({ smart: !gov().smart }); }
    else if (e.code === 'KeyC') { e.preventDefault(); requestAnimationFrame(() => { void openCouncilForm(lineItem('model'), o.sessionId(), () => { sync(); }); }); }
    else if (e.code === 'KeyM') { e.preventDefault(); requestAnimationFrame(() => openModel(true)); }
    else if (e.code === 'KeyA') { e.preventDefault(); openAdd(slot.querySelector<HTMLElement>('[data-plus]') ?? slot); }
  });
  /* files dropped on the composer or pasted into it: each a chip, as "+" attaches one (the desktop app's host reports its drags with
     the files' paths; the page's own drop and paste know names only) */
  composerFiles(slot, addAttached);
  const d = data().details;
  d.governance.subscribe(sync); d.choices.subscribe(sync); d.context.subscribe(sync); d.environment.subscribe(sync);
  data().council.subscribe(sync);
  controls?.launch.subscribe(sync); controls?.capabilities.subscribe(sync);

  const api: SessionComposer = {
    el: slot,
    get input() { return text(); },
    get value() { return value(); },
    setValue(t) { const n = text(); if (!n) return; n.focus(); kit.composerSet(n, t); },
    focus() { text()?.focus(); },
    setRunning(on) { running = on; sync(); },
    sync
  };
  draw();
  return api;
}
export { bestMention };
