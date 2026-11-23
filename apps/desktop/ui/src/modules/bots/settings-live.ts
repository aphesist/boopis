/* The settings sheet of a bot that is a real Hermes profile (`bots.admin`). Same sheet, same sections and keys as the mock's
   (settings.ts), with three differences that follow from the bot being real:
   - what Hermes keeps (role, SOUL.md, model, routines) is edited here and written only when you have seen the diff of each
     file and said save (the config diff card's rule, FORMS.md "setup"); routines pause and resume at once, like a switch;
   - what boopis keeps (its look, governance, cap, workspace, what it asks first) is saved at once, in the bot's own store;
   - archive keeps everything and is undone from the toast; delete says what goes, and asks twice.
   Nothing is shown that Hermes did not report: a list it did not answer says so. */
import { $, cap1, el, frag } from '../../core/dom';
import { ui } from '@boopis/ui';
import { data, NeedsConfirmation } from '../../data';
import type { ApprovalTier, Bot, BotConfig, BotsAdmin, BotPatch, RoutineDraft } from '../../data';
import { diffWell } from '../cards/parts';
import { cronValid, CRON_PRESETS, scheduleWords } from './cron';
import { deliveryParts } from '../../data/delivery';
import { openGroup } from './group-room';
import { inventoryLine } from './glance';
import { bot, S } from './model';
import { orbButton } from './orbs';
import { checkClips } from './clips';
import { closeSettings, hintOf, lookSection, openSettings, runLimitRow, sectionOf, tierRow, wireSectionKeys } from './settings';
import { focusConversation, openBot, refreshPresence } from './room';
import { openNew } from './new-bot';
import { updateRow } from './list';

const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** what the cap per run means, said where it is set (ADR-0048) */
export const CAP_HINT = 'Dollars per run: one message, room turn, card or scheduled run. A new bot starts at $5. At the cap it pauses and asks you; no answer stops it. On a subscription it counts what the same tokens would cost on the API, so it works as a token budget.';

export function openLiveSheet(b: Bot, sh: HTMLElement, focusSection: string | null, keepFocus: boolean): void {
  const admin = data().bots.admin as BotsAdmin;
  const info = b.info as NonNullable<Bot['info']>;
  const catalog = data().bots.catalog();
  const sec = sectionOf, hint = hintOf;
  const loaded = info.soul !== null;
  const base = { role: b.role, instructions: info.soul ?? '', model: info.model ?? '' };
  const pend = { role: base.role, instructions: base.instructions, model: base.model, add: [] as RoutineDraft[], remove: new Set<string>() };
  const patch = (): BotPatch => ({
    ...(pend.role.trim() !== base.role.trim() ? { role: pend.role } : {}),
    ...(loaded && pend.instructions !== base.instructions ? { instructions: pend.instructions } : {}),
    ...(pend.model && pend.model !== base.model ? { model: pend.model } : {}),
    ...(pend.add.length ? { addRoutines: pend.add } : {}),
    ...(pend.remove.size ? { removeRoutines: [...pend.remove] } : {})
  });
  const writes = () => admin.review(b.id, patch());
  const live = (): boolean => S.sheetOpen && S.sheetFor === b.id;

  const close = ui.iconButton({ icon: 'close', label: 'Close bot settings', keys: 'mod+I' });
  close.addEventListener('click', () => { closeSettings(); focusConversation(); });
  const head = el('header', { class: 'ui-panel__head' }, [el('h2', { class: 'ui-panel__title', text: 'Bot settings' }), close]);
  const body = el('div', { class: 'ui-panel__body ui-scroll ui-scroll--stable' });

  /* the two panes that stand in for the sections while they are needed: the diff to review, and the question before a delete */
  const review = el('section', { class: 'bt-review', 'aria-label': 'Review before saving', hidden: true });
  const gone = el('section', { class: 'bt-review', 'aria-label': 'Delete ' + b.name, hidden: true });

  /* ───────── role and instructions: profile.yaml and SOUL.md ───────── */
  const roleF = ui.field({ label: 'Role, shown under its name', value: pend.role, hint: 'Kept as the bot’s description; other bots read it to know what this one is for.' });
  $<HTMLInputElement>('input', roleF).addEventListener('input', (e) => { pend.role = (e.target as HTMLInputElement).value; paintDirty(); });
  const instrF = ui.field({ kind: 'textarea', label: 'Instructions (SOUL.md)', placeholder: loaded ? 'How it should work, what to avoid, who to tell' : 'Reading SOUL.md…', value: pend.instructions, disabled: !loaded, hint: loaded ? 'Takes effect in its next session; a session already running keeps the text it started with.' : (info.notes.detail ?? 'It has not been read yet.') });
  $<HTMLTextAreaElement>('textarea', instrF).addEventListener('input', (e) => { pend.instructions = (e.target as HTMLTextAreaElement).value; paintDirty(); });

  /* ───────── model: config.yaml ───────── */
  const models = [...admin.models()];
  if (info.model && !models.includes(info.model)) models.unshift(info.model);
  const modelHint = info.model ? 'The model ' + b.name + ' runs on.' : (info.notes.detail ?? 'No model is pinned for this bot.') + (models.length ? ' Pick one to pin it.' : ' No provider is configured yet.');
  const modelF = ui.field({ kind: 'model', label: 'Model', options: models, value: info.model ?? '', hint: modelHint, disabled: !models.length });
  modelF.addEventListener('ui:change', (e) => { pend.model = (e as CustomEvent<{ value: string }>).detail.value; paintDirty(); });

  /* ───────── routines: Hermes's cron store, this profile's ───────── */
  const routines = el('ul', { class: 'bt-routines', 'aria-label': 'Routines' });
  const routineErr = el('p', { class: 'ui-field__hint', role: 'alert', 'data-tone': 'attention', hidden: true });
  const jobsKnown = info.jobs !== null;
  /* where a routine's result goes, in words, with a link to the room when it posts to one of the groups */
  function deliveryLine(deliver: string): Node {
    const rooms = data().groups.snapshot().groups;
    const parts = deliveryParts(deliver, rooms, (p) => bot(p)?.name ?? p);
    const line = el('p', { class: 'ui-field__hint bt-routine-to' });
    if (!parts.length) return line;
    line.append(el('span', { text: cap1(parts.map((p) => p.text).join('')) }));
    for (const id of new Set(parts.flatMap((p) => (p.room ? [p.room] : [])))) {
      const name = rooms.find((g) => g.id === id)?.name ?? id;
      const open = ui.button({ label: 'Open ' + name, size: 's', variant: 'ghost' });
      open.classList.add('bt-routine-open');
      open.addEventListener('click', () => { openGroup(id); });
      line.append(open);
    }
    return line;
  }
  function paintRoutines(): void {
    routines.textContent = '';
    if (!jobsKnown) { routines.append(el('li', { class: 'bt-routine-note', text: 'Unknown. ' + (info.notes.jobs ?? 'boopis could not read its schedule.') })); return; }
    if (!(info.jobs ?? []).length && !pend.add.length) routines.append(el('li', { class: 'bt-routine-note', text: b.name + ' has no routines: it only works when asked.' }));
    for (const j of info.jobs ?? []) {
      const going = pend.remove.has(j.id);
      const sid = 'bt-job-' + b.id + '-' + j.id;
      const label = j.name || j.prompt || j.id;
      const meta = [scheduleWords(j.schedule), j.enabled ? (j.next ? 'next ' + j.next : '') : 'paused', j.last && j.last !== 'ok' ? 'last run: ' + j.last : ''].filter(Boolean).join(' · ');
      const row = frag(ui.html.setRow({ label: going ? label + ' (removed when you save)' : label, hint: meta, for: sid, control: ui.html.switch({ id: sid, checked: j.enabled, disabled: going }) }));
      ui.hydrate(row);
      const sw = $<HTMLInputElement>('input', row);
      sw.addEventListener('change', () => {
        routineErr.hidden = true;
        admin.setRoutinePaused(b.id, j.id, !sw.checked).catch((e: unknown) => { sw.checked = !sw.checked; routineErr.textContent = 'It was not ' + (sw.checked ? 'resumed' : 'paused') + ': ' + sentence(e); routineErr.hidden = false; });
      });
      const del = ui.iconButton({ icon: going ? 'check' : 'close', label: (going ? 'Keep routine ' : 'Remove routine ') + label, size: 's' });
      del.addEventListener('click', () => { if (going) pend.remove.delete(j.id); else pend.remove.add(j.id); paintRoutines(); paintDirty(); del.focus(); });
      const li = el('li', { class: 'bt-routine' + (going ? ' is-going' : '') }, [el('div', { class: 'bt-routine-main' }, [row, deliveryLine(j.deliver)]), del]);
      routines.append(li);
    }
    pend.add.forEach((a, i) => {
      const del = ui.iconButton({ icon: 'close', label: 'Do not add routine ' + (a.name || a.schedule), size: 's' });
      del.addEventListener('click', () => { pend.add.splice(i, 1); paintRoutines(); paintDirty(); });
      routines.append(el('li', { class: 'bt-routine is-new' }, [el('div', { class: 'bt-routine-text' }, [el('span', { text: a.name || a.prompt }), el('span', { class: 'ui-field__hint', text: scheduleWords(a.schedule) + ' · added when you save' })]), del]));
    });
  }
  const promptF = ui.field({ kind: 'textarea', label: 'What should it do?', placeholder: 'Review what changed since yesterday and tell me what needs me', value: '' });
  const presets = ui.chipGroup({ label: 'Schedule', value: null, options: CRON_PRESETS.filter(([v]) => v).map(([value, label]) => ({ value, label })) });
  const cronF = ui.field({ label: 'Cron', mono: true, value: '', placeholder: '0 9 * * 1-5', hint: 'Minute, hour, day, month, weekday.' });
  const cronIn = $<HTMLInputElement>('input', cronF), cronHint = $('.ui-field__hint', cronF), promptIn = $<HTMLTextAreaElement>('textarea', promptF);
  presets.addEventListener('ui:change', (e) => { cronIn.value = (e as CustomEvent<{ value: string }>).detail.value || ''; cronHint.textContent = cap1(scheduleWords(cronIn.value)); cronHint.removeAttribute('data-tone'); cronIn.removeAttribute('aria-invalid'); });
  cronIn.addEventListener('input', () => { cronHint.textContent = cronIn.value.trim() ? cap1(scheduleWords(cronIn.value)) : 'Minute, hour, day, month, weekday.'; if (cronValid(cronIn.value)) { cronHint.removeAttribute('data-tone'); cronIn.removeAttribute('aria-invalid'); } else { cronHint.setAttribute('data-tone', 'attention'); cronIn.setAttribute('aria-invalid', 'true'); } });
  const addBtn = ui.button({ label: 'Add routine', size: 's' });
  addBtn.disabled = !jobsKnown;
  addBtn.addEventListener('click', () => {
    const prompt = promptIn.value.trim(), schedule = cronIn.value.trim();
    if (!prompt) { promptIn.setAttribute('aria-invalid', 'true'); promptIn.focus(); return; }
    if (!schedule || !cronValid(schedule) || schedule.split(/\s+/).length !== 5) { cronIn.setAttribute('aria-invalid', 'true'); cronHint.setAttribute('data-tone', 'attention'); cronHint.textContent = 'A routine needs five fields: minute hour day month weekday.'; cronIn.focus(); return; }
    promptIn.removeAttribute('aria-invalid');
    pend.add.push({ name: prompt.replace(/\s+/g, ' ').slice(0, 40), prompt, schedule });
    promptIn.value = ''; cronIn.value = ''; cronHint.textContent = 'Minute, hour, day, month, weekday.';
    presets.querySelectorAll<HTMLElement>('[role="radio"]').forEach((x) => { x.setAttribute('aria-checked', 'false'); });
    paintRoutines(); paintDirty();
  });

  /* ───────── what boopis keeps for it: its own store, saved at once ───────── */
  const c = b.cfg;
  const own = (patch: Partial<Pick<BotConfig, 'gov' | 'cap' | 'workspace'>> & { approvals?: Readonly<Record<string, ApprovalTier>> }, then?: () => void, undo?: () => void): void => {
    admin.saveOwn(b.id, { cfg: patch }).then(() => { if (patch.gov) c.gov = patch.gov; then?.(); }).catch((e: unknown) => { undo?.(); ownErr.textContent = 'boopis did not save it: ' + sentence(e); ownErr.hidden = false; });
    ownErr.hidden = true;
  };
  const ownErr = el('p', { class: 'ui-field__hint', role: 'alert', 'data-tone': 'attention', hidden: true });
  const gov = ui.segmented({ mode: 'radio', label: 'Governance', value: c.gov, options: [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }], fill: true });
  const capId = 'bt-cap-' + b.id;
  const capRow = frag(ui.html.setRow({ label: 'Cap per run', hint: CAP_HINT, for: capId, control: ui.html.input({ id: capId, value: c.cap, mono: true, class: 'bt-cap', attrs: { inputmode: 'decimal', spellcheck: null } }) }));
  let capTimer = 0;
  $<HTMLInputElement>('input', capRow).addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value.trim(); window.clearTimeout(capTimer); capTimer = window.setTimeout(() => { if (/^\d{1,4}(\.\d{1,4})?$/.test(v)) own({ cap: v }); }, 500); });
  gov.addEventListener('ui:change', (e) => {
    const v = (e as CustomEvent<{ value: string }>).detail.value as BotConfig['gov'];
    /* refused (governed mode needs a frontier model): the switch goes back to what is saved, and the reason shows below */
    own({ gov: v }, undefined, () => { gov.select(c.gov); });
  });
  const ws = ui.segmented({ mode: 'radio', label: 'Workspace', value: c.workspace, options: [{ value: 'worktree', label: 'Worktree' }, { value: 'sandbox', label: 'Sandbox' }], fill: true });
  ws.addEventListener('ui:change', (e) => { own({ workspace: (e as CustomEvent<{ value: string }>).detail.value as BotConfig['workspace'] }); });
  /* what it may do: the plugin enforces each row before every tool call (ADR-0048); a kind the plugin did not report has no row */
  const appr = el('div', { class: 'ui-set' }, catalog.approvals.map((ap) => tierRow(b, ap, c.approvals[ap.id], (v) => own({ approvals: { [ap.id]: v } }))).filter((n): n is HTMLElement => !!n));
  const apprNote = Object.keys(c.approvals).length ? null : hint('What it may do is not shown: this version of boopis’s plugin did not report it.');

  /* ───────── what it has: read only ───────── */
  const mcpLine = inventoryLine('MCP servers', 'server', 'servers', info.mcpServers, info.notes.detail);
  const caps = el('div', { class: 'bt-caps' }, [
    el('p', { class: 'ui-field__hint', text: inventoryLine('Skills', 'skill', 'skills', info.skills, info.notes.detail) }),
    el('p', { class: 'ui-field__hint', text: inventoryLine('Toolsets', 'toolset', 'toolsets', info.toolsets, info.notes.detail) }),
    el('p', { class: 'ui-field__hint', text: mcpLine })
  ]);

  const who = el('div', { class: 'bt-sh-who' }, [orbButton(b, 28, b.name, { state: b.state }), el('span', { class: 'bt-sh-name', text: b.name }), el('span', { class: 'bt-sh-role', text: b.role })]);
  checkClips();
  const jobsMeta = info.jobs ? (info.jobs.filter((j) => j.enabled).length ? info.jobs.filter((j) => j.enabled).length + ' on' : 'none') : 'unknown';
  body.append(
    who, review, gone,
    lookSection(b),
    sec('role', 'Role and instructions', null, [roleF, instrF]),
    sec('model', 'Model', info.model ?? 'not set', [modelF]),
    sec('schedule', 'Schedule', jobsMeta, [hint('What it does when you have not asked. Each is a job in this bot’s own schedule.'), routines, routineErr, promptF, presets, cronF, el('div', { class: 'bt-add-row' }, addBtn)]),
    sec('capabilities', 'What it can use', null, [hint('The tools and skills this bot has. boopis shows them here; changing them is not offered here yet.'), caps]),
    sec('rules', 'Rules', null, [hint('Saved with the bot, in its boopis folder. Governed applies from its next session and needs a frontier model; the cap and what it may do apply from its next step (Allow: it goes ahead, Ask: it pauses for your approval, Block: it may not); the workspace does not apply yet.'), gov, capRow, ws, appr, apprNote, ownErr, el('div', { class: 'ui-set' }, runLimitRow(b))])
  );
  paintRoutines();
  const heads = wireSectionKeys(body);

  /* ───────── the foot: archive, delete, review, done ───────── */
  const archive = ui.button({ label: 'Archive ' + b.name });
  const archLabel = el('span', { class: 'bt-arch-label', text: 'Archive ' + b.name });
  $('span', archive).replaceChildren(archLabel);
  archive.addEventListener('click', () => {
    if (archive.hasAttribute('data-armed')) { void archiveBot(); return; }
    archive.setAttribute('data-armed', ''); archLabel.textContent = 'Click again to archive'; checkClips();
    setTimeout(() => { if (archive.isConnected) { archive.removeAttribute('data-armed'); archLabel.textContent = 'Archive ' + b.name; checkClips(); } }, 4000);
  });
  const del = ui.button({ label: 'Delete…' });
  del.addEventListener('click', () => { void askDelete(); });
  const reviewBtn = ui.button({ label: 'Review changes', variant: 'primary' });
  reviewBtn.hidden = true;
  reviewBtn.addEventListener('click', () => showReview());
  const done = ui.button({ label: 'Done' });
  done.addEventListener('click', () => { if (writes().length) { showReview(); return; } closeSettings(); focusConversation(); });
  const foot = el('footer', { class: 'ui-panel__foot' }, [archive, del, reviewBtn, done]);
  const paintDirty = (): void => {
    const n = writes().length;
    reviewBtn.hidden = !n;
    reviewBtn.setAttribute('aria-label', 'Review ' + n + (n === 1 ? ' change' : ' changes') + ' before saving');
    $('span', reviewBtn).textContent = n > 1 ? 'Review ' + n + ' changes' : 'Review changes';
    if (!n) review.hidden = true;
  };

  /* what each change would write, as the config diff card draws it, then save */
  function showReview(confirmModel = false, ask: string | null = null): void {
    const planned = writes();
    if (!planned.length) { review.hidden = true; return; }
    review.hidden = false; gone.hidden = true;
    const err = el('p', { class: 'ui-field__hint', role: 'alert', 'data-tone': 'attention', hidden: true });
    const keep = ui.button({ label: 'Keep editing' });
    const save = ui.button({ label: ask ? 'Use this model anyway' : 'Save changes', variant: 'primary' });
    review.replaceChildren(
      el('h3', { class: 'bt-review-h', text: 'Review before saving' }),
      el('p', { class: 'ui-field__hint', text: 'These are the files boopis keeps for ' + b.name + '. Nothing is written until you save.' }),
      ...planned.map((w) => frag(diffWell(w.diff, w.file))),
      ...(ask ? [el('p', { class: 'ui-field__hint', role: 'alert', 'data-tone': 'attention', text: ask })] : []),
      err, el('div', { class: 'bt-review-acts' }, [keep, save])
    );
    keep.addEventListener('click', () => { review.hidden = true; });
    save.addEventListener('click', () => {
      save.disabled = true; keep.disabled = true; err.hidden = true;
      admin.save(b.id, patch(), confirmModel || ask ? { confirmModel: true } : {})
        .then(() => { ui.toast('Saved ' + b.name); if (live()) openSettings(b.id, null, { keepFocus: true }); refreshPresence(); })
        .catch((e: unknown) => {
          if (e instanceof NeedsConfirmation) { showReview(false, e.message); return; }
          save.disabled = false; keep.disabled = false; err.textContent = sentence(e); err.hidden = false;
          if (live() && /The rest was saved/.test(sentence(e))) { updateRow(b.id); refreshPresence(); }
        });
    });
    requestAnimationFrame(() => { review.scrollIntoView({ block: 'nearest' }); save.focus({ preventScroll: true }); });
  }

  /* delete: say what goes, archive is the first answer, the second is two clicks away */
  async function askDelete(): Promise<void> {
    gone.hidden = false; review.hidden = true;
    gone.replaceChildren(el('h3', { class: 'bt-review-h', text: 'Delete ' + b.name + ' for good?' }), el('p', { class: 'ui-field__hint', text: 'Counting what is in its folder…' }));
    let lines: readonly string[] = [];
    try { lines = (await admin.removal(b.id)).lines; } catch (e) { lines = ['Everything in its folder (boopis could not count it: ' + sentence(e) + ').']; }
    if (!live()) return;
    const err = el('p', { class: 'ui-field__hint', role: 'alert', 'data-tone': 'attention', hidden: true });
    const instead = ui.button({ label: 'Archive instead', variant: 'primary' });
    const sure = ui.button({ label: 'Delete permanently' });
    const sureLabel = el('span', { text: 'Delete permanently' });
    $('span', sure).replaceChildren(sureLabel);
    const cancel = ui.button({ label: 'Cancel' });
    gone.replaceChildren(
      el('h3', { class: 'bt-review-h', text: 'Delete ' + b.name + ' for good?' }),
      el('p', { class: 'ui-field__hint', text: 'This removes, and cannot be undone:' }),
      el('ul', { class: 'bt-gone-list' }, lines.map((l) => el('li', { text: l }))),
      el('p', { class: 'ui-field__hint', text: 'Archiving keeps all of it, pauses its routines, frees the name, and can be undone.' }),
      err, el('div', { class: 'bt-review-acts' }, [cancel, sure, instead])
    );
    cancel.addEventListener('click', () => { gone.hidden = true; del.focus(); });
    instead.addEventListener('click', () => { void archiveBot(); });
    sure.addEventListener('click', () => {
      if (!sure.hasAttribute('data-armed')) { sure.setAttribute('data-armed', ''); sureLabel.textContent = 'Click again to delete'; setTimeout(() => { if (sure.isConnected) { sure.removeAttribute('data-armed'); sureLabel.textContent = 'Delete permanently'; } }, 4000); return; }
      sure.disabled = true; cancel.disabled = true; instead.disabled = true; err.hidden = true;
      const name = b.name, id = b.id;
      admin.remove(id, id).then(() => { afterGone(); ui.toast('Deleted ' + name); })
        .catch((e: unknown) => { sure.disabled = false; cancel.disabled = false; instead.disabled = false; err.textContent = 'It was not deleted: ' + sentence(e); err.hidden = false; });
    });
    requestAnimationFrame(() => { gone.scrollIntoView({ block: 'nearest' }); instead.focus({ preventScroll: true }); });
  }
  async function archiveBot(): Promise<void> {
    const name = b.name, id = b.id;
    archive.disabled = true;
    try {
      const done = await admin.archive(id);
      afterGone();
      ui.toast('Archived ' + name, { action: { label: 'Undo', onClick: () => { done.undo().then(() => { ui.toast('Restored ' + name); }).catch((e: unknown) => { ui.toast('Could not restore ' + name + ': ' + sentence(e)); }); } } });
    } catch (e) {
      archive.disabled = false; archive.removeAttribute('data-armed'); archLabel.textContent = 'Archive ' + name;
      gone.hidden = false; review.hidden = true;
      gone.replaceChildren(el('h3', { class: 'bt-review-h', text: name + ' was not archived' }), el('p', { class: 'ui-field__hint', role: 'alert', 'data-tone': 'attention', text: sentence(e) }));
    }
  }
  /** the bot is gone from the list (the provider said so); open the next one, or the new-bot form when there is none */
  function afterGone(): void {
    closeSettings(true);
    const next = S.bots[0];
    if (next) { openBot(next.id); focusConversation(); } else openNew();
  }

  sh.append(el('span', { class: 'ui-concave bt-sheet-corner', 'data-at': 'tr', 'aria-hidden': 'true' }), head, body, foot);
  if (!loaded) void admin.open(b.id).then(() => { if (live() && !writes().length) { const nb = bot(b.id); if (nb) openSettings(nb.id, focusSection, { keepFocus: true }); } }).catch(() => undefined);
  requestAnimationFrame(() => {
    sh.classList.add('is-open');
    if (keepFocus) return;
    const target = focusSection ? body.querySelector<HTMLElement>('[data-name="' + focusSection + '"]') : null;
    if (target) {
      target.scrollIntoView({ block: 'start' }); target.setAttribute('data-flash', ''); setTimeout(() => target.removeAttribute('data-flash'), 1300);
      (target.querySelector<HTMLElement>('.ui-sec__body input, .ui-sec__body button, .ui-sec__body select, .ui-sec__body textarea') ?? target.querySelector<HTMLElement>('.ui-sec__head'))?.focus({ preventScroll: true });
    } else heads[0]?.focus({ preventScroll: true });
  });
}
