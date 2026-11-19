/* the settings sheet (KEYMAP section 9). A .ui-panel inside the view, flush right, --right-w wide, with the library's
   concave corner and sections. ↑ ↓ move between section headers, Enter or Space opens or closes one, Esc goes back
   to the conversation (the shell; the sheet stays open), mod+I or the close button closes it. */
import { emit } from '../../core/bus';
import { $, cap1, el, esc, frag, reduced } from '../../core/dom';
import { ui } from '../../components';
import { data } from '../../data';
import type { Bot, BotConfig } from '../../data';
import { cronValid, cronWords, CRON_PRESETS } from './cron';
import { bot, S } from './model';
import { orbButton } from './orbs';
import { updateRow } from './list';
import { focusConversation, openBot, paintToolbar, refreshPresence } from './room';
import { checkClips } from './clips';
import { openLiveSheet } from './settings-live';

/** a section of the sheet: the library's, open, with its kids in its body */
export function sectionOf(name: string, label: string, meta: string | null, kids: Array<Node | null>): HTMLElement {
  const s = ui.section({ label, meta: meta ? esc(meta) : '', open: true, name });
  s.querySelector('.ui-sec__body')?.append(...kids.filter((k): k is Node => !!k));
  return s;
}
export const hintOf = (text: string): HTMLElement => el('p', { class: 'ui-field__hint', text });
/** the headers are the sheet's tab stops: up and down move between them, home and end jump (KEYMAP section 9) */
export function wireSectionKeys(body: HTMLElement): HTMLElement[] {
  const heads = [...body.querySelectorAll<HTMLElement>('.ui-sec__head')];
  heads[0]?.setAttribute('data-hx-focus', 'panel');
  body.addEventListener('keydown', (e) => {
    const h = (e.target as Element).closest<HTMLElement>('.ui-sec__head'); if (!h || e.target !== h || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = heads.indexOf(h);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = heads[(i + (e.key === 'ArrowDown' ? 1 : heads.length - 1)) % heads.length]; n?.focus(); n?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Home') { e.preventDefault(); heads[0]?.focus(); }
    if (e.key === 'End') { e.preventDefault(); heads[heads.length - 1]?.focus(); }
  });
  return heads;
}

export function toggleSettings(): boolean { if (S.sheetOpen) { closeSettings(); focusConversation(); } else openSettings(S.sel); return true; }

export function openSettings(id: string | null, focusSection?: string | null, opts?: { keepFocus?: boolean }): void {
  const b = bot(id || S.sel); if (!b || !S.sheet) return;
  if (S.view !== 'bot' || S.sel !== b.id) openBot(b.id);
  if (!S.sheetOpen) S.sheetReturn = document.activeElement;
  S.sheetOpen = true; S.sheetFor = b.id;
  const sh = S.sheet; sh.textContent = ''; sh.hidden = false;
  sh.setAttribute('aria-label', 'Settings for ' + b.name);
  emit('hx:view-inset', { source: 'bots', tab: 'bots', right: sh.offsetWidth });
  /* a bot that is a real Hermes profile has its own sheet: it edits the profile, and shows each write before it is made */
  if (b.info && data().bots.admin) { openLiveSheet(b, sh, focusSection ?? null, !!opts?.keepFocus); return; }
  const c = b.cfg;
  const catalog = data().bots.catalog();
  const push = (patch: Partial<BotConfig>): void => { data().bots.update(b.id, { cfg: patch }); };
  const changed = (): void => { updateRow(b.id); refreshPresence(); };

  const close = ui.iconButton({ icon: 'close', label: 'Close bot settings', keys: 'mod+I' });
  close.addEventListener('click', () => { closeSettings(); focusConversation(); });
  const head = el('header', { class: 'ui-panel__head' }, [el('h2', { class: 'ui-panel__title', text: 'Bot settings' }), close]);
  const body = el('div', { class: 'ui-panel__body ui-scroll ui-scroll--stable' });
  const sec = sectionOf, hint = hintOf;

  /* role and instructions */
  const roleF = ui.field({ label: 'Role, shown under its name', value: b.role });
  $<HTMLInputElement>('input', roleF).addEventListener('input', (e) => { b.role = (e.target as HTMLInputElement).value; data().bots.update(b.id, { role: b.role }); changed(); });
  const instrF = ui.field({ kind: 'textarea', label: 'Instructions', placeholder: 'How it should work, what to avoid, who to tell', value: c.instructions });
  $<HTMLTextAreaElement>('textarea', instrF).addEventListener('input', (e) => { c.instructions = (e.target as HTMLTextAreaElement).value; push({ instructions: c.instructions }); });

  /* model and governance */
  const modelBox = el('div', { class: 'bt-model' });
  const paintModel = (): void => {
    modelBox.textContent = '';
    if (c.gov === 'governed') {
      const g = data().details.governance.get();
      modelBox.append(ui.ladder({ stations: g.ladder, current: 0, variant: 'list', label: 'Escalation ladder' }));
      const capId = 'bt-cap-' + b.id;
      const row = frag(ui.html.setRow({ label: 'Cap per run', hint: 'Dollars per run', for: capId, control: ui.html.input({ id: capId, value: c.cap, mono: true, class: 'bt-cap', attrs: { inputmode: 'decimal', spellcheck: null } }) }));
      $<HTMLInputElement>('input', row).addEventListener('input', (e) => { c.cap = (e.target as HTMLInputElement).value; push({ cap: c.cap }); paintToolbar(b); });
      modelBox.append(row);
    } else {
      const f = ui.field({ kind: 'model', label: 'Model', options: catalog.models, value: c.model, hint: 'Runs every step on this model, with no escalation and no cap.' });
      f.addEventListener('ui:change', (e) => { c.model = (e as CustomEvent<{ value: string }>).detail.value; push({ model: c.model }); changed(); });
      modelBox.append(f);
    }
  };
  const gov = ui.segmented({ mode: 'radio', label: 'Governance', value: c.gov, options: [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }], fill: true });
  gov.addEventListener('ui:change', (e) => { c.gov = (e as CustomEvent<{ value: string }>).detail.value as BotConfig['gov']; push({ gov: c.gov }); paintModel(); changed(); });
  paintModel();

  /* schedule */
  const presets = ui.chipGroup({ label: 'Schedule', value: CRON_PRESETS.some(([v]) => v === c.cron.trim()) ? c.cron.trim() : null, options: CRON_PRESETS.map(([value, label]) => ({ value, label })) });
  if (!presets.querySelector('[tabindex="0"]')) { const f = presets.querySelector<HTMLElement>('[role="radio"]'); if (f) f.tabIndex = 0; }
  const cronF = ui.field({ label: 'Cron', mono: true, value: c.cron, placeholder: '0 9 * * 1-5', hint: cap1(cronWords(c.cron)) });
  const cronIn = $<HTMLInputElement>('input', cronF), cronHint = $('.ui-field__hint', cronF);
  const paintCron = (): void => {
    cronHint.textContent = cap1(cronWords(c.cron));
    if (cronValid(c.cron)) { cronHint.removeAttribute('data-tone'); cronIn.removeAttribute('aria-invalid'); } else { cronHint.setAttribute('data-tone', 'attention'); cronIn.setAttribute('aria-invalid', 'true'); }
  };
  presets.addEventListener('ui:change', (e) => { c.cron = (e as CustomEvent<{ value: string }>).detail.value || ''; push({ cron: c.cron }); cronIn.value = c.cron; paintCron(); changed(); });
  cronIn.addEventListener('input', () => {
    c.cron = cronIn.value; push({ cron: c.cron }); paintCron(); changed();
    const radios = [...presets.querySelectorAll<HTMLElement>('[role="radio"]')];
    radios.forEach((x) => { const on = x.dataset['value'] === c.cron.trim(); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    if (!radios.some((x) => x.tabIndex === 0) && radios[0]) radios[0].tabIndex = 0;
  });

  /* switches in setting rows */
  const switchRow = (key: string, label: string, hintText: string | null, on: boolean, locked: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const sid = 'bt-sw-' + b.id + '-' + key;
    const row = frag(ui.html.setRow({ label, hint: hintText, for: sid, control: ui.html.switch({ id: sid, checked: on, disabled: locked }) }));
    ui.hydrate(row);
    $<HTMLInputElement>('input', row).addEventListener('change', (e) => onChange((e.target as HTMLInputElement).checked));
    return row;
  };
  const chans = el('div', { class: 'ui-set' }, catalog.channels.map((ch) => switchRow('ch-' + ch.id, ch.name, ch.hint ?? null, !!c.channels[ch.id], ch.id === 'app', (v) => { c.channels = { ...c.channels, [ch.id]: v }; push({ channels: { [ch.id]: v } }); changed(); })));
  const appr = el('div', { class: 'ui-set' }, catalog.approvals.map((ap) => switchRow('ap-' + ap.id, ap.name, null, !!c.approvals[ap.id], false, (v) => { c.approvals = { ...c.approvals, [ap.id]: v }; push({ approvals: { [ap.id]: v } }); })));

  /* workspace */
  const wsHint = hint('');
  const paintWs = (): void => { wsHint.textContent = c.workspace === 'worktree' ? 'Its own git worktree; changes reach you as a branch.' : 'An isolated bubblewrap sandbox with the network off; nothing leaves it without approval.'; };
  const ws = ui.segmented({ mode: 'radio', label: 'Workspace', value: c.workspace, options: [{ value: 'worktree', label: 'Worktree' }, { value: 'sandbox', label: 'Sandbox' }], fill: true });
  ws.addEventListener('ui:change', (e) => { c.workspace = (e as CustomEvent<{ value: string }>).detail.value as BotConfig['workspace']; push({ workspace: c.workspace }); paintWs(); });
  paintWs();

  const who = el('div', { class: 'bt-sh-who' }, [orbButton(b, 28, b.name, { state: b.state }), el('span', { class: 'bt-sh-name', text: b.name }), el('span', { class: 'bt-sh-role', text: b.role })]);
  checkClips();
  body.append(
    who,
    sec('role', 'Role and instructions', null, [roleF, instrF]),
    sec('model', 'Model', c.gov === 'governed' ? 'governed' : c.model, [hint('Governed starts cheap and climbs the ladder only when a step fails.'), gov, modelBox]),
    sec('schedule', 'Schedule', c.cron ? (cronValid(c.cron) ? cronWords(c.cron) : 'incomplete') : null, [hint('When it runs without being asked.'), presets, cronF]),
    sec('channels', 'Channels', null, [hint('Where you can reach it, and where it reports.'), chans]),
    sec('approvals', 'Ask me before', null, [hint('It pauses and sends you an approval card.'), appr]),
    sec('workspace', 'Workspace', c.workspace, [ws, wsHint])
  );
  const heads = wireSectionKeys(body);

  const archive = ui.button({ label: 'Archive ' + b.name });
  const archLabel = el('span', { class: 'bt-arch-label', text: 'Archive ' + b.name });
  $('span', archive).replaceChildren(archLabel);
  archive.addEventListener('click', () => {
    if (archive.hasAttribute('data-armed')) { archiveBot(b.id); return; }
    archive.setAttribute('data-armed', ''); archLabel.textContent = 'Click again to archive'; checkClips();
    setTimeout(() => { if (archive.isConnected) { archive.removeAttribute('data-armed'); archLabel.textContent = 'Archive ' + b.name; checkClips(); } }, 4000);
  });
  const done = ui.button({ label: 'Done', variant: 'primary' });
  done.addEventListener('click', () => { closeSettings(); focusConversation(); });
  const foot = el('footer', { class: 'ui-panel__foot' }, [archive, done]);
  sh.append(el('span', { class: 'ui-concave bt-sheet-corner', 'data-at': 'tr', 'aria-hidden': 'true' }), head, body, foot);
  requestAnimationFrame(() => {
    sh.classList.add('is-open');
    if (opts?.keepFocus) return;
    const target = focusSection ? body.querySelector<HTMLElement>('[data-name="' + focusSection + '"]') : null;
    if (target) {
      target.scrollIntoView({ block: 'start' }); target.setAttribute('data-flash', ''); setTimeout(() => target.removeAttribute('data-flash'), 1300);
      (target.querySelector<HTMLElement>('.ui-sec__body input, .ui-sec__body button, .ui-sec__body select, .ui-sec__body textarea') ?? target.querySelector<HTMLElement>('.ui-sec__head'))?.focus({ preventScroll: true });
    } else heads[0]?.focus({ preventScroll: true });
  });
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
  ui.toast('Archived ' + gone.name);
  focusConversation();
}
