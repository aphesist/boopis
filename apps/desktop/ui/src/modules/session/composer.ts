/* the session's composer: the library's, with the session's chips (governed, smart, model), its reading of the
   request (feedforward) and its keys (KEYMAP section 7: alt+G, alt+S, alt+M; alt+A and alt+V are the library's).
   OWNER DECISION (Smart and model): alt+M, or the model chip, opens the model picker and Smart stays ON. The picker's first
   entry is "Smart" (automatic; the current choice while Smart is on), then the models. Choosing a model pins it and
   turns Smart off; choosing Smart keeps or turns it back on; Esc changes nothing. While Smart is on the model chip stays
   hidden and the picker opens against the Smart chip. */
import { emit } from '../../core/bus';
import { cap1, isMac } from '../../core/dom';
import { ui } from '../../components';
import type { ComposerEl, DecisionDetail, AssumptionDetail, DictateDetail } from '../../components';

import { data } from '../../data';
import type { GovernanceState } from '../../data';
import { costAssume, kindOf, makeReader, optionsFor } from './feedforward';

export const SMART_VALUE = '__smart';
const gov = (): GovernanceState => data().details.governance.get();

/** the one way the session changes governance: the provider owns the state, the UI announces the change */
export function setGovernance(patch: Partial<Pick<GovernanceState, 'governed' | 'smart' | 'model' | 'cap'>>): void {
  const why = data().details.setGovernance(patch);
  if (why) ui.toast(why);
  const g = gov();
  emit('hx:governance', { governed: g.governed, smart: g.smart, model: g.model, cap: g.cap });
}

export interface SessionComposer extends ComposerEl {
  /** the assumptions row as it stood when the message was sent */
  lastAssume(): string[];
}

export function sessionComposer(opts: { draft: string; sessionId: () => string }): SessionComposer {
  const reader = makeReader(gov);
  const g0 = gov();
  const govChip = ui.chip({ label: 'Governed', icon: 'ladder', pressed: g0.governed });
  const smart = ui.chip({ label: 'Smart', icon: 'spark', pressed: g0.smart });
  const model = ui.chip({ model: g0.model, haspopup: 'menu', expanded: false });
  const c = ui.composer({
    placeholder: 'Describe the change', label: 'Message the coding agent', value: opts.draft,
    chips: [govChip, smart, model], spend: { spent: g0.spent, cap: g0.cap },
    hint: (t) => (t ? reader.items(t) : []), feedforward: (t) => reader.marks(t)
  }) as SessionComposer;
  govChip.setAttribute('aria-keyshortcuts', 'Alt+G'); smart.setAttribute('aria-keyshortcuts', 'Alt+S'); model.setAttribute('aria-keyshortcuts', 'Alt+M');
  const span = (n: HTMLElement): HTMLElement => n.querySelector('span') as HTMLElement;

  function sync(): void {
    const G = gov();
    govChip.setAttribute('aria-pressed', String(G.governed)); span(govChip).textContent = G.governed ? 'Governed' : 'Ungoverned';
    govChip.setAttribute('data-tip', G.governed ? 'Climbs the model ladder, stops at ' + G.cap : 'Pinned to ' + G.model + ', no cap'); govChip.setAttribute('data-kbd', 'alt+G');
    govChip.setAttribute('aria-label', G.governed ? 'Governed: starts cheap, climbs the model ladder on failure, stops at the cost cap' : 'Ungoverned: one pinned model, no cost cap');
    smart.setAttribute('aria-pressed', String(G.smart)); smart.setAttribute('data-tip', G.smart ? 'Picks the model for each message' : 'You pick the model'); smart.setAttribute('data-kbd', 'alt+S');
    if (G.smart && model.contains(document.activeElement)) c.focus();   /* never drop focus with the chip */
    model.hidden = G.smart; span(model).textContent = G.model; ui.modelMark.swap(model, G.model); model.setAttribute('aria-label', 'Model: ' + G.model); model.setAttribute('data-tip', 'Model'); model.setAttribute('data-kbd', 'alt+M');
    c.setSpend(G.spent, G.governed ? G.cap : null);
    c.refresh();
  }
  govChip.addEventListener('ui:change', (e) => { e.preventDefault(); setGovernance({ governed: !gov().governed }); c.flashHint(); });
  smart.addEventListener('ui:change', (e) => { e.preventDefault(); setGovernance({ smart: !gov().smart }); c.flashHint(); });

  function openModel(viaKeyboard: boolean): void {
    const G = gov();
    const anchor = G.smart ? smart : model;
    /* the model picker: the same listbox as every model choice (Smart first, then the models by provider) */
    const entries = [{ value: SMART_VALUE, label: 'Smart', desc: 'Picks the model for each message' }, ...ui.modelEntries(data().details.models.get())];
    ui.listbox.open(anchor, entries, {
      place: 'above', label: 'Model', value: G.smart ? SMART_VALUE : G.model,
      onClose: viaKeyboard ? () => { c.focus(); } : undefined,
      onSelect: (v) => { setGovernance(v === SMART_VALUE ? { smart: true } : { smart: false, model: v }); c.flashHint(); }
    });
  }
  model.addEventListener('click', () => openModel(false));
  data().details.governance.subscribe(sync);

  /* a dashed word, or an assumption: what it is read as */
  function openReading(anchor: HTMLElement, kind: string | undefined, text: string): void {
    if (kind === 'preview') return;
    if (kind === 'governance' || !text || !kind) {
      ui.menu.open(anchor, [{ title: 'Governance' }, { label: 'Governed', value: 'on', checked: gov().governed, desc: 'Start cheap, climb on failure' }, { label: 'Ungoverned', value: 'off', checked: !gov().governed, desc: 'One pinned model, no cap' }], { place: 'above', onSelect: (v) => setGovernance({ governed: v === 'on' }) });
      return;
    }
    const r = reader.reading(kind, text), k = kindOf(kind);
    const items = [{ title: k.title + ' "' + text + '"' }, ...optionsFor(k, text).map((o) => ({ label: o.label, value: o.value, desc: o.desc, mono: !!o.mono, checked: o.value === r.value })), { foot: 'Dashed: my guess. Solid: your choice.' }];
    ui.menu.open(anchor, items, { place: 'above', label: 'How to read ' + text, onSelect: (v) => { r.value = v; r.confirmed = true; c.refresh(); c.flashHint(); requestAnimationFrame(() => c.focus()); } });
  }
  c.addEventListener('ui:decision', (e) => { const d = (e as CustomEvent<DecisionDetail>).detail; openReading(d.el, d.kind, d.text); });
  c.addEventListener('ui:assumption', (e) => { const d = (e as CustomEvent<AssumptionDetail>).detail; if (d.item) openReading(d.el, d.item.kind, d.item.text); });
  c.addEventListener('ui:assumption-drop', (e) => {
    const it = (e as CustomEvent<{ item?: { kind: string; text: string; label: string } }>).detail.item; if (!it) return;
    if (it.kind === 'governance') return;
    if (it.text) reader.reading(it.kind, it.text).dropped = true;
    ui.announce('Dropped ' + it.label);
  });

  /* attach */
  if (c.attach) {
    const attach = c.attach;
    attach.addEventListener('click', () => {
      const live = data().info.live;
      /* a live build offers no bots here (they are a preview) and mentions files through the gateway's completion */
      const bots = live ? [] : data().bots.snapshot().bots.slice(0, 3);
      ui.menu.open(attach, [
        { label: 'Attach a file', value: 'file', icon: 'file' }, { label: 'Add a folder to context', value: 'folder', icon: 'folder' }, '-',
        ...(live ? [{ label: 'Mention a file', value: '@file:', icon: 'at' }] : bots.map((b) => ({ label: 'Ask ' + b.name, value: '@' + b.name, desc: cap1(b.role), icon: 'at' }))), '-',
        { label: 'Commands', value: '/', icon: 'slash' }
      ], { place: 'above', label: 'Attach', onSelect: (v) => {
        requestAnimationFrame(() => {
          if (v === '@file:') { openMention(v); return; }
          if (v === 'file' || v === 'folder') { const name = data().files.pick(v); if (name) { c.addFile(name); } else if (data().info.live) ui.toast('Picking a file is not wired in the desktop app yet. Mention one instead.'); c.focus(); }
          else c.insert((c.value && !/\s$/.test(c.value) ? ' ' : '') + v + (v === '/' ? '' : ' '));
        });
      } });
    });
  }
  /* mention a file: the gateway completes the word; a folder opens, a file is inserted as @file:path */
  function openMention(word: string): void {
    void data().files.complete(word, opts.sessionId()).then((r) => {
      const items = r.items.length
        ? [{ title: 'Mention a file' }, ...r.items.map((i) => ({ label: i.display, value: i.text, mono: true, ...(i.meta ? { desc: i.meta } : {}), icon: /[:/]$/.test(i.text) ? 'folder' : 'file' }))]
        : [{ title: 'Mention a file' }, { foot: r.unavailable ?? 'No files match.' }];
      ui.menu.open(c.attach as HTMLElement, items, { place: 'above', label: 'Mention a file', onClose: () => { c.focus(); }, onSelect: (v) => { if (/\/$/.test(v)) requestAnimationFrame(() => { openMention(v); }); else c.insert((c.value && !/\s$/.test(c.value) ? ' ' : '') + v + ' '); } });
    });
  }
  /* dictation: the provider hears; what it heard goes into the text */
  let stopHearing: (() => void) | null = null;
  c.addEventListener('ui:dictate', (e) => {
    stopHearing?.(); stopHearing = null;
    if ((e as CustomEvent<DictateDetail>).detail.value) {
      stopHearing = data().dictation.start({ botId: null }, (text) => {
        if (c.mic.getAttribute('aria-pressed') === 'true') { c.mic.click(); c.insert((c.value && !/\s$/.test(c.value) ? ' ' : '') + text); }
      });
    }
  });
  /* KEYMAP section 7: alt+G, alt+S, alt+M */
  const modKey = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey);
  c.addEventListener('keydown', (e) => {
    if (!e.altKey || modKey(e) || e.shiftKey) return;
    if (e.code === 'KeyG') { e.preventDefault(); govChip.click(); }
    else if (e.code === 'KeyS') { e.preventDefault(); smart.click(); }
    else if (e.code === 'KeyM') { e.preventDefault(); requestAnimationFrame(() => openModel(true)); }
  });
  c.addEventListener('ui:send', () => { reader.clear(); });
  Object.assign(c, { lastAssume: (): string[] => (c.querySelector('.ui-composer__hint') ? [...c.querySelectorAll('.ui-assume')].map((b) => b.textContent ?? '') : []) });
  sync();
  return c;
}
export { costAssume };
