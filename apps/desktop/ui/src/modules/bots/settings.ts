/* A bot's settings sheet (KEYMAP section 9) on the kit (the repass's step 2a): the kit's Pane as a sheet (its title and close, a body of
   sections that scrolls, its actions at the foot), placed flush right in the view, --right-w wide. Each section is a folding SectionHead
   over its parts: the kit's Fields, Card rows with a Switch, a Segmented, a select (the kit's SelectorItem opening the kit's Menu) or a
   button, the Look editor (Segmented tabs over Swatches), and the Approvals section, which was the kit's already. No board draws the
   sheet; its sections, their order, their content and their words are what 7a+ and the copy pass left (rule 6). ↑ ↓ move between the
   section heads, Enter or Space folds or opens one, Home and End jump; Esc goes back to the conversation (the shell; the sheet stays
   open); mod+I or the close button closes it. */
import { emit } from '../../core/bus';
import { cap1, el, frag, reduced } from '../../core/dom';
import { kit, ui } from '@boopis/ui';
import type { RowOpts } from '@boopis/ui';
import { data } from '../../data';
import type { Bot, BotConfig } from '../../data';
import { approvalsSection, tierSaver } from './approvals';
import { cronValid, cronWords, CRON_PRESETS } from './cron';
import { bot, S } from './model';
import { updateRow } from './list';
import { focusConversation, openBot, paintToolbar, refreshPresence } from './room';
import { checkClips } from './clips';
import { CAP_HINT, CAP_PLACEHOLDER, openLiveSheet } from './settings-live';
import { lookEditor } from './look-edit';
import { limitWords, openLimitMenu } from './run-limit';
import { modelFieldHTML, openModelMenu, wireModelField } from './model-pick';

/** kit markup as an element, wired */
export const kitEl = (html: string): HTMLElement => kit.wire(frag(html));

/** a section of the sheet: a folding SectionHead (its words at the end: "rose triangle") over its parts, open */
export function sectionOf(name: string, label: string, meta: string | null, kids: Array<Node | null>): HTMLElement {
  const s = el('div', { class: 'k7-section bt-sec', role: 'group', 'data-name': name, 'aria-label': label });
  const head = kitEl(kit.html.sectionHead({ title: label, disclosure: true, ...(meta ? { value: meta } : {}) }));
  const body = el('div', { class: 'bt-sec__body' }, kids.filter((k): k is Node => !!k));
  const btn = head.querySelector<HTMLButtonElement>('.k7-shead__btn') as HTMLButtonElement;
  btn.setAttribute('aria-controls', body.id = 'bt-sec-' + name + '-' + Math.random().toString(36).slice(2, 7));
  btn.addEventListener('click', () => { const open = btn.getAttribute('aria-expanded') !== 'true'; btn.setAttribute('aria-expanded', String(open)); head.toggleAttribute('data-collapsed', !open); body.hidden = !open; });
  s.append(head, body);
  return s;
}
/** a section's words at the end of its head */
export function setMeta(sec: HTMLElement | null, words: string): void {
  const head = sec?.querySelector('.k7-shead__btn'); if (!head) return;
  let v = head.querySelector('.k7-shead__value');
  if (!v) { v = el('span', { class: 'k7-shead__value' }); head.querySelector('.k7-shead__title')?.after(v); }
  v.textContent = words;
}
/** a quiet line under a part: what a section is for, what a control just did (one short sentence, RULES.md section 7) */
export const hintOf = (text: string): HTMLElement => el('p', { class: 'k7-pane__note bt-sheet__hint', text });
/** a line that says what went wrong, hidden until it has something to say */
export const errorOf = (): HTMLElement => el('p', { class: 'k7-pane__note bt-sheet__error', role: 'alert', hidden: true });
/** say it, or hide it */
export const sayError = (n: HTMLElement, text: string | null): void => { n.textContent = text ?? ''; n.hidden = !text; };
/** a card of rows, wired */
/** a card of rows on the sheet: the kit's pane Card (the sheet is the Pane's ground: a settings Card would paint the same, R-colour-4), wired */
export const cardOf = (rows: readonly RowOpts[], attrs?: Record<string, string>): HTMLElement => kitEl(kit.html.card({ variant: 'pane', rows, ...(attrs ? { attrs } : {}) }));
/** a Field (text or multiline), wired; its input or textarea is `.k7-field__input` */
export const fieldOf = (o: Parameters<typeof kit.html.field>[0]): HTMLElement => kitEl(kit.html.field(o));
export const inputOf = (f: HTMLElement): HTMLInputElement & HTMLTextAreaElement => f.querySelector('.k7-field__input') as HTMLInputElement & HTMLTextAreaElement;
/** a Field whose control is a Segmented (one of a few), wired; its ui:change says the choice */
export function segFieldOf(id: string, label: string, items: ReadonlyArray<{ value: string; label: string }>, value: string, hint?: string): HTMLElement {
  return fieldOf({ id, label, ...(hint ? { hint } : {}), control: kit.html.segmented({ label, items, value, attrs: { 'aria-labelledby': id + '-label', 'data-seg': id } }) });
}
/** set a Segmented to a value without a ui:change (a save the host refused goes back to what is kept) */
export function setSeg(seg: HTMLElement | null, value: string): void {
  if (!seg) return;
  const items = [...seg.querySelectorAll<HTMLElement>('.k7-seg__item')];
  items.forEach((x, i) => { const on = x.dataset['value'] === value; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; if (on) seg.style.setProperty('--i', String(i)); });
}
/** a row's Switch, named by its row */
export const switchHTML = (key: string, label: string, on: boolean, disabled = false): string => kit.html.switch({ label, checked: on, disabled, attrs: { 'data-switch': key } });
/** the schedule's presets as Chips, one of which is chosen (a press chooses it; the cron Field says the rest) */
export function presetChips(label: string, value: string | null, withOff: boolean): HTMLElement {
  const chips = el('div', { class: 'bt-presets', role: 'group', 'aria-label': label }, CRON_PRESETS.filter(([v]) => withOff || v).map(([v, l]) => kitEl(kit.html.chip({ label: l, value: v, chosen: value !== null && v === value }))));
  chips.addEventListener('ui:change', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('[data-kit~="Chip"]'); if (!c) return;
    e.preventDefault();
    paintPresets(chips, c.dataset['value'] ?? '');
    chips.dispatchEvent(new CustomEvent('bt:preset', { detail: c.dataset['value'] ?? '', bubbles: true }));
  });
  return chips;
}
export function paintPresets(chips: HTMLElement, value: string | null): void {
  for (const c of chips.querySelectorAll<HTMLElement>('[data-kit~="Chip"]')) { const on = value !== null && c.dataset['value'] === value.trim(); c.setAttribute('aria-pressed', String(on)); c.toggleAttribute('data-chosen', on); }
}

/** the Look section (the look editor), the same in the mock's sheet and a live bot's */
export function lookSection(b: Bot): HTMLElement {
  let sec: HTMLElement | null = null;
  const ed = lookEditor(b, (words) => { setMeta(sec, words); });
  sec = sectionOf('look', 'Look', ed.meta, ed.kids);
  return sec;
}
/** The Run limit row, the same in the mock's sheet and a live bot's: the most turns `boopis run --bot` lets one task take with this bot.
 *  The engine keeps a goal's budget in the bot's own configuration and the host writes it there, so the command line and this row
 *  read one number. Its menu is the group header's (`run-limit.ts`). */
export function runLimitRow(b: Bot): HTMLElement {
  const name = (words: string): string => 'Turns a run may take with ' + b.name + ': ' + words;   /* the visible words are part of the name */
  const card = cardOf([{ label: 'Run limit', sub: 'Most turns one run may take.', control: kit.html.button({ label: 'Reading…', variant: 'tint', size: 28, attrs: { 'aria-haspopup': 'menu', 'aria-label': name('Reading…'), 'data-run-limit': '' } }) }]);
  const btn = card.querySelector<HTMLButtonElement>('[data-run-limit]') as HTMLButtonElement, word = btn.querySelector('.k7-btn__label') as HTMLElement;
  const sub = card.querySelector<HTMLElement>('.k7-row__sub');
  let cur: { turns: number | null; fallback: number } | null = null;
  const show = (now: { turns: number | null; fallback: number }): void => { cur = now; word.textContent = limitWords(now.turns, now.fallback); btn.setAttribute('aria-label', name(word.textContent)); };
  const said = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  data().bots.runLimit(b.id).then(show).catch((e: unknown) => { btn.disabled = true; word.textContent = 'Unknown'; btn.setAttribute('aria-label', name('Unknown')); if (sub) sub.textContent = 'It could not be read: ' + said(e); });
  btn.addEventListener('click', () => {
    if (!cur) return;
    openLimitMenu(btn, {
      title: 'Most turns a run may take', label: 'Turns a run may take with ' + b.name, kept: cur.turns, fallback: cur.fallback,
      onPick: (v) => { data().bots.setRunLimit(b.id, v).then((now) => { show(now); kit.notify(now.turns === null ? b.name + ' runs for up to ' + now.fallback + ' turns.' : b.name + ' runs for up to ' + now.turns + ' turns.'); }).catch((e: unknown) => { kit.notify('The limit was not saved: ' + said(e)); }); }
    });
  });
  return card;
}
/** the Approvals section, the same in the mock's sheet and a live bot's: what the bot does beyond your rules (approvals.ts) */
export function approvalsOf(b: Bot): HTMLElement {
  const a = approvalsSection(b, { saveTier: tierSaver(b) });
  return sectionOf('approvals', 'Approvals', a.meta, [a.el]);
}
/** who the sheet is for: the bot's orb (it takes a new look with every other), its name and its role */
export const whoOf = (b: Bot): HTMLElement => cardOf([{ label: b.name, sub: b.role || undefined, leadHTML: kit.html.avatar({ bot: b, size: 28, state: b.state }), attrs: { 'data-clip-name': '', 'data-who': '' } }]);

/** the sheet's frame: the kit's Pane (sheet) in the view's host, its body and its foot; the close button closes it */
export function sheetFrame(b: Bot, sh: HTMLElement, foot: string): { body: HTMLElement; foot: HTMLElement } {
  const pane = kitEl(kit.html.pane({ variant: 'sheet', title: 'Bot settings', label: 'Settings for ' + b.name, closeLabel: 'Close bot settings', closeKeys: 'mod+I', foot, attrs: { 'data-sheet': b.id } }));
  pane.querySelector('[data-pane-close]')?.addEventListener('click', () => { closeSettings(); focusConversation(); });
  sh.replaceChildren(pane);
  return { body: pane.querySelector<HTMLElement>('.k7-pane__body') as HTMLElement, foot: pane.querySelector<HTMLElement>('.k7-pane__foot') as HTMLElement };
}
/** the foot's Archive, pressed twice (the first press says what the second does) */
export function armArchive(btn: HTMLButtonElement, name: string, go: () => void): void {
  const word = btn.querySelector('.k7-btn__label') as HTMLElement;
  btn.addEventListener('click', () => {
    if (btn.hasAttribute('data-armed')) { go(); return; }
    btn.setAttribute('data-armed', ''); word.textContent = 'Click again to archive'; checkClips();
    setTimeout(() => { if (btn.isConnected) { btn.removeAttribute('data-armed'); word.textContent = 'Archive ' + name; checkClips(); } }, 4000);
  });
}
/** the heads are the sheet's tab stops: up and down move between them, home and end jump (KEYMAP section 9) */
export function wireSectionKeys(body: HTMLElement): HTMLElement[] {
  const heads = [...body.querySelectorAll<HTMLElement>('.bt-sec > .k7-shead .k7-shead__btn')];
  heads[0]?.setAttribute('data-hx-focus', 'panel');
  body.addEventListener('keydown', (e) => {
    const h = (e.target as Element).closest<HTMLElement>('.k7-shead__btn'); if (!h || e.target !== h || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = heads.indexOf(h); if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = heads[(i + (e.key === 'ArrowDown' ? 1 : heads.length - 1)) % heads.length]; n?.focus(); n?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Home') { e.preventDefault(); heads[0]?.focus(); }
    if (e.key === 'End') { e.preventDefault(); heads[heads.length - 1]?.focus(); }
  });
  return heads;
}
/** once the sheet slides in: the focus goes to the section a caller named (it flashes once), else the first head */
export function focusOpen(sh: HTMLElement, body: HTMLElement, heads: HTMLElement[], focusSection: string | null, keepFocus: boolean): void {
  requestAnimationFrame(() => {
    sh.classList.add('is-open');
    if (keepFocus) return;
    const target = focusSection ? body.querySelector<HTMLElement>('.bt-sec[data-name="' + focusSection + '"]') : null;
    if (target) {
      target.scrollIntoView({ block: 'start' }); target.setAttribute('data-flash', ''); setTimeout(() => target.removeAttribute('data-flash'), 1300);
      (target.querySelector<HTMLElement>('[data-draft-input], [data-rule-switch]:not([disabled]), [data-rule-add]') ?? target.querySelector<HTMLElement>('.bt-sec__body input, .bt-sec__body textarea, .bt-sec__body button:not([disabled])') ?? target.querySelector<HTMLElement>('.k7-shead__btn'))?.focus({ preventScroll: true });   /* Approvals: its first draft, else its first rule */
    } else heads[0]?.focus({ preventScroll: true });
  });
}

export function toggleSettings(): boolean { if (S.sheetOpen) { closeSettings(); focusConversation(); } else openSettings(S.sel); return true; }

/** the sheet pushes the room aside only when it sits beside it; at phone width it is the whole view and covers the room, so the room keeps its column (a column of 0 left the presence header's orb and button outside a header of 8 px, R-corner-4). Said again when the window resizes: the sheet's width follows the window */
let watchingResize = false;
function emitInset(): void {
  const sh = S.sheet; if (!sh) return;
  emit('hx:view-inset', { source: 'bots', tab: 'bots', right: sh.offsetWidth >= (sh.parentElement?.clientWidth ?? 0) ? 0 : sh.offsetWidth });
}

export function openSettings(id: string | null, focusSection?: string | null, opts?: { keepFocus?: boolean }): void {
  const b = bot(id || S.sel); if (!b || !S.sheet) return;
  if (S.view !== 'bot' || S.sel !== b.id) openBot(b.id);
  if (!S.sheetOpen) S.sheetReturn = document.activeElement;
  S.sheetOpen = true; S.sheetFor = b.id;
  const sh = S.sheet; sh.textContent = ''; sh.hidden = false;
  emitInset();
  if (!watchingResize) { watchingResize = true; window.addEventListener('resize', () => { if (S.sheetOpen) emitInset(); }); }
  /* a bot that is a real Hermes profile has its own sheet: it edits the profile, and shows each write before it is made */
  if (b.info && data().bots.admin) { openLiveSheet(b, sh, focusSection ?? null, !!opts?.keepFocus); return; }
  const c = b.cfg;
  const catalog = data().bots.catalog();
  const push = (patch: Partial<BotConfig>): void => { data().bots.update(b.id, { cfg: patch }); };
  const changed = (): void => { updateRow(b.id); refreshPresence(); };
  const { body, foot } = sheetFrame(b, sh, kit.html.button({ label: 'Archive ' + b.name, variant: 'ghost', attrs: { 'data-act': 'archive', 'data-clip-label': '' } }) + kit.html.button({ label: 'Done', variant: 'primary', attrs: { 'data-act': 'done' } }));
  const k = (key: string): string => 'bt-' + key + '-' + b.id;

  /* role and instructions */
  const roleF = fieldOf({ id: k('role'), label: 'Role, shown under its name', value: b.role });
  inputOf(roleF).addEventListener('input', (e) => { b.role = (e.target as HTMLInputElement).value; data().bots.update(b.id, { role: b.role }); changed(); });
  const instrF = fieldOf({ id: k('instructions'), kind: 'multiline', rows: 4, label: 'Instructions', placeholder: 'How it should work, what to avoid, who to tell', value: c.instructions });
  inputOf(instrF).addEventListener('input', (e) => { c.instructions = (e.target as HTMLTextAreaElement).value; push({ instructions: c.instructions }); });

  /* model and governance */
  const modelBox = el('div', { class: 'bt-model' });
  const paintModel = (): void => {
    const rows: RowOpts[] = c.gov === 'governed'
      ? data().details.governance.get().ladder.map(([m, rule]) => ({ label: ui.modelMark.called(m) || m, sub: rule, leadHTML: kit.html.avatar({ variant: 'brand', model: m }) }))
      : [{ label: 'Model', control: modelFieldHTML('model', 'Model', c.model) }];
    /* the cap per run holds governed or not (ADR-0050) */
    rows.push({ label: 'Cap per run', sub: CAP_HINT, control: kit.html.field({ id: k('cap'), ariaLabel: 'Cap per run', value: c.cap, mono: true, placeholder: CAP_PLACEHOLDER }) });
    const card = cardOf(rows, { 'aria-label': c.gov === 'governed' ? 'Escalation ladder' : 'Model' });
    const f = card.querySelector<HTMLElement>('[data-model-pick]');
    if (f) wireModelField(f, () => { openModelMenu(f, { label: 'Model', models: catalog.models, value: f.dataset['value'] ?? '', onPick: (v) => { c.model = v; push({ model: c.model }); setMeta(sec, c.model); changed(); } }); });
    const cap = card.querySelector<HTMLInputElement>('#' + CSS.escape(k('cap')));
    cap?.setAttribute('inputmode', 'decimal'); cap?.setAttribute('spellcheck', 'false'); cap?.classList.add('bt-cap');
    cap?.addEventListener('input', () => { c.cap = cap.value; push({ cap: c.cap }); paintToolbar(b); });
    modelBox.replaceChildren(card);
  };
  const gov = segFieldOf(k('gov'), 'Governance', [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }], c.gov, 'Governed moves up a model only when a step fails.');
  gov.addEventListener('ui:change', (e) => { c.gov = (e as CustomEvent<{ value: string }>).detail.value as BotConfig['gov']; push({ gov: c.gov }); setMeta(sec, c.gov === 'governed' ? 'governed' : c.model); paintModel(); changed(); });
  paintModel();

  /* schedule */
  const presets = presetChips('Schedule', CRON_PRESETS.some(([v]) => v === c.cron.trim()) ? c.cron.trim() : null, true);
  const cronF = fieldOf({ id: k('cron'), label: 'Cron', mono: true, value: c.cron, placeholder: '0 9 * * 1-5', hint: cap1(cronWords(c.cron)) });
  const cronIn = inputOf(cronF), cronHint = cronF.querySelector('.k7-field__hint') as HTMLElement;
  const paintCron = (): void => {
    cronHint.textContent = cap1(cronWords(c.cron));
    cronF.toggleAttribute('data-error', !cronValid(c.cron));
    if (cronValid(c.cron)) cronIn.removeAttribute('aria-invalid'); else cronIn.setAttribute('aria-invalid', 'true');
    setMeta(schedSec, c.cron ? (cronValid(c.cron) ? cronWords(c.cron) : 'incomplete') : '');
  };
  presets.addEventListener('bt:preset', (e) => { c.cron = (e as CustomEvent<string>).detail; push({ cron: c.cron }); cronIn.value = c.cron; paintCron(); changed(); });
  cronIn.addEventListener('input', () => { c.cron = cronIn.value; push({ cron: c.cron }); paintCron(); paintPresets(presets, c.cron); changed(); });

  /* channels: a Switch each; the app itself is always on */
  const chans = cardOf(catalog.channels.map((ch) => ({ label: ch.name, ...(ch.hint ? { sub: ch.hint } : {}), control: switchHTML('ch-' + ch.id, ch.name, !!c.channels[ch.id], ch.id === 'app') })), { 'aria-label': 'Channels' });
  chans.addEventListener('ui:change', (e) => {
    const sw = (e.target as Element).closest<HTMLElement>('[data-switch^="ch-"]'); if (!sw) return;
    const id = (sw.dataset['switch'] ?? '').slice(3), v = !!(e as CustomEvent<{ value: boolean }>).detail.value;
    c.channels = { ...c.channels, [id]: v }; push({ channels: { [id]: v } }); changed();
  });

  /* workspace */
  const wsWords = (w: BotConfig['workspace']): string => (w === 'worktree' ? 'Changes reach you as a branch.' : 'No network, and nothing leaves without your approval.');
  const ws = segFieldOf(k('ws'), 'Workspace', [{ value: 'worktree', label: 'Worktree' }, { value: 'sandbox', label: 'Sandbox' }], c.workspace, wsWords(c.workspace));
  ws.addEventListener('ui:change', (e) => { c.workspace = (e as CustomEvent<{ value: string }>).detail.value as BotConfig['workspace']; push({ workspace: c.workspace }); const h = ws.querySelector('.k7-field__hint'); if (h) h.textContent = wsWords(c.workspace); setMeta(wsSec, c.workspace); });

  const sec = sectionOf('model', 'Model', c.gov === 'governed' ? 'governed' : c.model, [gov, modelBox, runLimitRow(b)]);
  const schedSec = sectionOf('schedule', 'Schedule', c.cron ? (cronValid(c.cron) ? cronWords(c.cron) : 'incomplete') : null, [hintOf('When it runs without being asked.'), presets, cronF]);
  const wsSec = sectionOf('workspace', 'Workspace', c.workspace, [ws]);
  body.append(
    whoOf(b),
    lookSection(b),
    sectionOf('role', 'Role and instructions', null, [roleF, instrF]),
    sec, schedSec,
    sectionOf('channels', 'Channels', null, [hintOf('Where you can reach it, and where it reports.'), chans]),
    approvalsOf(b),
    wsSec
  );
  const heads = wireSectionKeys(body);
  armArchive(foot.querySelector<HTMLButtonElement>('[data-act="archive"]') as HTMLButtonElement, b.name, () => { archiveBot(b.id); });
  foot.querySelector('[data-act="done"]')?.addEventListener('click', () => { closeSettings(); focusConversation(); });
  checkClips();
  focusOpen(sh, body, heads, focusSection ?? null, !!opts?.keepFocus);
}
export function closeSettings(instant?: boolean): void {
  if (!S.sheet || !S.sheetOpen) return;
  S.sheetOpen = false;
  S.sheet.classList.remove('is-open');
  emit('hx:view-inset', { source: 'bots', tab: 'bots', right: 0 });
  const sheet = S.sheet;
  const done = (): void => { if (!S.sheetOpen) sheet.hidden = true; };
  if (instant || reduced()) done(); else setTimeout(done, 300);
}
function archiveBot(id: string): void {
  const i = S.bots.findIndex((b) => b.id === id); if (i < 0 || S.bots.length < 2) return;
  const gone = S.bots[i] as Bot;
  data().bots.archive(id);   /* the provider answers with 'bot-archived': the list and the view drop it */
  closeSettings(true);
  openBot((S.bots[Math.min(i, S.bots.length - 1)] as Bot).id);
  kit.notify('Archived ' + gone.name);
  focusConversation();
}
