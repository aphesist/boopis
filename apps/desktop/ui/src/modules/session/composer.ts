/* the session's composer: the library's, with the session's chips (governed, and the model), its reading of the request
   (feedforward) and its keys (KEYMAP section 7: alt+G, alt+S, alt+M; alt+A and alt+V are the library's).
   The model chip always says who answers next: a model's logo and readable name, or Smart (with what it would pick for the text
   being typed). The chip, or alt+M, opens the "who answers next" menu (`model-menu.ts`): Automatic (Smart) first, then every model
   the user can use now, by provider. alt+S turns Smart on or off. Esc changes nothing. */
import { emit } from '../../core/bus';
import { cap1, isMac } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { ComposerEl, DecisionDetail, AssumptionDetail, DictateDetail } from '@boopis/ui';

import { data } from '../../data';
import type { Attached, GovernanceState } from '../../data';
import { costAssume, kindOf, makeReader, optionsFor } from './feedforward';
import { COUNCIL_VALUE, openCouncilForm } from './council';
import { FOOT_GOVERNED, FOOT_UNGOVERNED, SMART_VALUE, currentChoice, modelEntries, smartPreview } from './model-menu';

export { SMART_VALUE };
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
  /** what is attached, handed over for the send: the chips are cleared with it */
  takeAttachments(): Attached[];
}

export function sessionComposer(opts: { draft: string; sessionId: () => string }): SessionComposer {
  const reader = makeReader(gov);
  const g0 = gov();
  const govChip = ui.chip({ label: 'Governed', icon: 'ladder', pressed: g0.governed });
  const model = ui.chip({ model: g0.model, haspopup: 'menu', expanded: false, class: 'ui-chip--who' });
  const c = ui.composer({
    placeholder: 'Describe the change', label: 'Message the coding agent', value: opts.draft,
    chips: [govChip, model], spend: { spent: g0.spent, cap: g0.cap },
    hint: (t) => (t ? reader.items(t) : []), feedforward: (t) => reader.marks(t)
  }) as SessionComposer;
  govChip.setAttribute('aria-keyshortcuts', 'Alt+G'); model.setAttribute('aria-keyshortcuts', 'Alt+M Alt+S');
  const span = (n: HTMLElement): HTMLElement => n.querySelector('span') as HTMLElement;

  function sync(): void {
    const G = gov();
    govChip.setAttribute('aria-pressed', String(G.governed)); span(govChip).textContent = G.governed ? 'Governed' : 'Ungoverned';
    govChip.setAttribute('data-tip', G.governed ? 'Climbs the model ladder, stops at ' + G.cap : 'Pinned to ' + G.model + ', no cap'); govChip.setAttribute('data-kbd', 'alt+G');
    govChip.setAttribute('aria-label', G.governed ? 'Governed: starts cheap, climbs the model ladder on failure, stops at the cost cap' : 'Ungoverned: one pinned model, no cost cap');
    drawModel(G);
    c.setSpend(G.spent, G.governed ? G.cap : null);
    c.refresh();
  }
  /* the chip says who answers next */
  const attachments = (): number => c.querySelector('.ui-composer__files')?.children.length ?? 0;
  function drawModel(G: GovernanceState): void {
    const choices = data().details.choices.get();
    const prev = G.smart ? smartPreview(choices, { text: c.value, attachments: attachments() }) : null;
    const name = ui.modelMark.called(G.model) || G.model;
    const armed = data().council.armed(opts.sessionId());
    const label = armed ? 'Council of ' + armed.members.length : G.smart ? (prev ? 'Smart: ' + (ui.modelMark.called(prev.choice.model) || prev.choice.model) : 'Smart') : name || 'Choose a model';
    const t = document.createElement('template');
    t.innerHTML = ui.html.chip(armed || G.smart || !G.model ? { label, icon: armed ? 'bots' : 'spark', haspopup: 'menu' } : { model: G.model, label, haspopup: 'menu' });
    const fresh = t.content.firstElementChild as HTMLElement;
    model.replaceChildren(...fresh.childNodes);
    model.classList.toggle('ui-chip--mono', !armed && !G.smart && !!G.model);
    /* the accessible name starts with the words on the chip (WCAG 2.5.3), then says what it is */
    model.setAttribute('aria-label', label + ', who answers next' + (armed ? ' (the next message goes to a council)' : G.smart ? (prev ? ' (Smart would pick it for this message: ' + prev.reason + ')' : ' (Smart picks for each message)') : ''));
    model.setAttribute('data-tip', G.smart ? 'Smart picks the model for each message' + (prev ? ': ' + prev.reason : '') : 'Who answers next'); model.setAttribute('data-kbd', 'alt+M');
  }
  c.input.addEventListener('input', () => { if (gov().smart) drawModel(gov()); });
  govChip.addEventListener('ui:change', (e) => { e.preventDefault(); setGovernance({ governed: !gov().governed }); c.flashHint(); });

  function openModel(viaKeyboard: boolean): void {
    const G = gov();
    const choices = data().details.choices.get();
    const entries = modelEntries(choices, { current: G.model, governed: G.governed, council: data().council.can(opts.sessionId()) });
    ui.listbox.open(model, entries, {
      place: 'above', label: 'Who answers next', value: G.smart ? SMART_VALUE : currentChoice(choices, G.model)?.value ?? G.model,
      foot: G.governed ? FOOT_GOVERNED : FOOT_UNGOVERNED,
      onClose: viaKeyboard ? () => { c.focus(); } : undefined,
      onSelect: (v) => { if (v === COUNCIL_VALUE) { requestAnimationFrame(() => { void openCouncilForm(model, opts.sessionId(), () => { drawModel(gov()); c.flashHint(); }); }); return; } setGovernance(v === SMART_VALUE ? { smart: true } : { smart: false, model: v }); c.flashHint(); }
    });
  }
  model.addEventListener('click', () => openModel(false));
  data().details.governance.subscribe(sync);
  data().details.choices.subscribe(() => { drawModel(gov()); });
  data().council.subscribe(() => { drawModel(gov()); });

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

  /* attach: the host's own dialog picks (desktop app), or a drop on the composer; each becomes a chip, and the send carries them */
  const attached: Attached[] = [];
  function addAttached(list: readonly Attached[]): void {
    for (const a of list) {
      if (attached.some((x) => (a.path ? x.path === a.path : x.name === a.name))) continue;
      attached.push(a);
      c.addFile(a.name, { kind: a.kind, ...(a.path ? { title: a.path } : {}), onRemove: () => { const i = attached.indexOf(a); if (i >= 0) attached.splice(i, 1); } });
    }
  }
  function pickAttachments(kind: 'file' | 'folder'): void {
    data().files.pick(kind).then(addAttached).catch((e: unknown) => { ui.toast(e instanceof Error ? e.message : 'Attaching did not work'); }).finally(() => { c.focus(); });
  }
  c.takeAttachments = (): Attached[] => {
    const out = attached.splice(0);
    c.querySelector('.ui-composer__files')?.replaceChildren();
    return out;
  };
  const dropArea = (): HTMLElement => c.parentElement ?? c;
  const over = (x: number, y: number): boolean => { const r = dropArea().getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const drops = data().files.drops;
  if (drops) {
    /* the desktop app: the host reports where files are dragged and what was dropped, with their paths */
    const off = drops.subscribe((e) => {
      if (!c.isConnected) { off(); return; }
      if (e.phase === 'drop') { c.removeAttribute('data-drop'); if (over(e.x, e.y)) { addAttached(e.attachments); c.focus(); } return; }
      c.toggleAttribute('data-drop', e.phase !== 'leave' && over(e.x, e.y));
    });
  } else {
    /* the page build: the browser's drop knows names only */
    const area = dropArea();
    area.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); c.setAttribute('data-drop', ''); } });
    area.addEventListener('dragleave', () => { c.removeAttribute('data-drop'); });
    area.addEventListener('drop', (e) => {
      c.removeAttribute('data-drop');
      const files = [...(e.dataTransfer?.files ?? [])]; if (!files.length) return;
      e.preventDefault();
      addAttached(files.map((f) => ({ name: f.name, kind: /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) ? 'image' as const : 'file' as const, bytes: f.size })));
      c.focus();
    });
  }
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
          if (v === 'file' || v === 'folder') { pickAttachments(v); return; }
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
    else if (e.code === 'KeyS') { e.preventDefault(); setGovernance({ smart: !gov().smart }); c.flashHint(); }
    else if (e.code === 'KeyC') { e.preventDefault(); requestAnimationFrame(() => { void openCouncilForm(model, opts.sessionId(), () => { drawModel(gov()); c.flashHint(); }); }); }
    else if (e.code === 'KeyM') { e.preventDefault(); requestAnimationFrame(() => openModel(true)); }
  });
  c.addEventListener('ui:send', () => { reader.clear(); });
  Object.assign(c, { lastAssume: (): string[] => (c.querySelector('.ui-composer__hint') ? [...c.querySelectorAll('.ui-assume')].map((b) => b.textContent ?? '') : []) });
  sync();
  return c;
}
export { costAssume };
