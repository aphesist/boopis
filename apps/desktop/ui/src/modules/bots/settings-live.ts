/* The settings sheet of a bot that is a real Hermes profile (`bots.admin`). Same sheet, same sections and keys as the mock's
   (settings.ts), with three differences that follow from the bot being real:
   - what Hermes keeps (role, SOUL.md, model, routines) is edited here and written only when you have seen the diff of each
     file and said save (the config diff card's rule, FORMS.md "setup"); routines pause and resume at once, like a switch;
   - what boopis keeps (its look, governance, cap, workspace, what it asks first) is saved at once, in the bot's own store;
   - archive keeps everything and is undone from the floating Notice; delete says what goes, and asks twice.
   Nothing is shown that Hermes did not report: a list it did not answer says so. The sheet is the kit's (settings.ts, step 2a): the
   Pane as a sheet, folding SectionHeads, Fields, Card rows with Switches, Segmenteds, the model's Menu, a review of each file's diff
   as the kit's DiffView, and the foot's Buttons. */
import { cap1, el, esc } from '../../core/dom';
import { kit } from '@boopis/ui';
import type { DiffLine, RowOpts } from '@boopis/ui';
import { data, NeedsConfirmation } from '../../data';
import type { Bot, BotConfig, BotsAdmin, BotPatch, RoutineDraft, BotCapability } from '../../data';
import { cronValid, scheduleWords } from './cron';
import { deliveryParts } from '../../data/delivery';
import { openGroup } from './group-room';
import { bot, S } from './model';
import { checkClips } from './clips';
import { approvalsOf, armArchive, cardOf, closeSettings, errorOf, fieldOf, focusOpen, hintOf, inputOf, kitEl, lookSection, openSettings, paintPresets, presetChips, runLimitRow, sayError, sectionOf, segFieldOf, setMeta, setSeg, sheetFrame, switchHTML, whoOf, wireSectionKeys } from './settings';
import { modelFieldHTML, openModelMenu, wireModelField } from './model-pick';
import { focusConversation, openBot, refreshPresence } from './room';
import { openNew } from './new-bot';
import { updateRow } from './list';
import { deleteFlow } from './delete-flow';

const on = (list: readonly BotCapability[] | null): BotCapability[] => (list ?? []).filter((c) => c.enabled);
const count = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);

/** the line that says what a capability list holds: "3 skills on of 5", or that Hermes has not said */
export function inventoryLine(label: string, one: string, many: string, list: readonly BotCapability[] | null, note: string | undefined): string {
  if (list === null) return label + ': unknown' + (note ? '. ' + note : '');
  if (!list.length) return label + ': none';
  const names = on(list).map((c) => c.label || c.name);
  return label + ': ' + count(names.length, one, many) + ' on' + (names.length < list.length ? ' of ' + list.length : '') + (names.length && names.length <= 6 ? ' (' + names.join(', ') + ')' : '');
}


const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** what the cap per run means, said where it is set (ADR-0050) */
export const CAP_HINT = 'Pauses and asks you when it’s reached.';
/** the cap's placeholder: no cap is the default (copy rule 5) */
export const CAP_PLACEHOLDER = 'No cap';

export function openLiveSheet(b: Bot, sh: HTMLElement, focusSection: string | null, keepFocus: boolean): void {
  const admin = data().bots.admin as BotsAdmin;
  const info = b.info as NonNullable<Bot['info']>;
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
  const k = (key: string): string => 'bt-' + key + '-' + b.id;
  const btn = (label: string, act: string, variant: 'secondary' | 'primary' | 'tint' | 'ghost' = 'ghost', more: Record<string, string> = {}): string => kit.html.button({ label, variant, attrs: { 'data-act': act, ...more } });
  const { body, foot } = sheetFrame(b, sh, btn('Archive ' + b.name, 'archive', 'ghost', { 'data-clip-label': '' }) + btn('Delete…', 'delete') + btn('Review changes', 'review', 'primary', { hidden: '' }) + btn('Done', 'done'));

  /* the two parts that stand in for the sections while they are needed: the diff to review, and the question before a delete */
  const review = el('section', { class: 'bt-review', 'aria-label': 'Review before saving', hidden: true });
  const gone = el('section', { class: 'bt-review', 'aria-label': 'Delete ' + b.name, hidden: true });

  /* ───────── role and instructions: profile.yaml and SOUL.md ───────── */
  const roleF = fieldOf({ id: k('role'), label: 'Role, shown under its name', value: pend.role, hint: 'Other bots read it too.' });
  inputOf(roleF).addEventListener('input', (e) => { pend.role = (e.target as HTMLInputElement).value; paintDirty(); });
  const instrF = fieldOf({ id: k('instructions'), kind: 'multiline', rows: 4, label: 'Instructions', placeholder: loaded ? 'How it should work, what to avoid, who to tell' : 'Reading…', value: pend.instructions, disabled: !loaded, hint: loaded ? 'Applies from its next session.' : (info.notes.detail ?? 'It has not been read yet.') });
  inputOf(instrF).addEventListener('input', (e) => { pend.instructions = (e.target as HTMLTextAreaElement).value; paintDirty(); });

  /* ───────── model: config.yaml ───────── */
  const models = [...admin.models()];
  if (info.model && !models.includes(info.model)) models.unshift(info.model);
  const modelHint = info.model ? null : info.notes.detail ?? (models.length ? 'None pinned yet.' : 'Connect a model provider first.');
  const modelCard = cardOf([{ label: 'Model', ...(modelHint ? { sub: modelHint } : {}), control: modelFieldHTML('model', 'Model', info.model ?? '', { disabled: !models.length }) }], { 'aria-label': 'Model' });
  const modelField = modelCard.querySelector<HTMLElement>('[data-model-pick]') as HTMLElement;
  wireModelField(modelField, () => { openModelMenu(modelField, { label: 'Model', models, value: modelField.dataset['value'] ?? '', onPick: (v) => { pend.model = v; paintDirty(); } }); });

  /* ───────── routines: Hermes's cron store, this profile's ───────── */
  const routines = el('div', { class: 'bt-routines', role: 'list', 'aria-label': 'Routines' });
  const routineErr = errorOf();
  const jobsKnown = info.jobs !== null;
  /* where a routine's result goes, in words, with a link to the room when it posts to one of the groups */
  function deliveryLine(deliver: string): HTMLElement | null {
    const rooms = data().groups.snapshot().groups;
    const parts = deliveryParts(deliver, rooms, (p) => bot(p)?.name ?? p);
    if (!parts.length) return null;
    const line = el('p', { class: 'k7-pane__note bt-routine-to' }, [el('span', { text: cap1(parts.map((p) => p.text).join('')) })]);
    for (const id of new Set(parts.flatMap((p) => (p.room ? [p.room] : [])))) {
      const name = rooms.find((g) => g.id === id)?.name ?? id;
      const open = kitEl(kit.html.button({ label: 'Open ' + name, variant: 'ghost', size: 28, attrs: { 'data-routine-open': id } }));
      open.addEventListener('click', () => { openGroup(id); });
      line.append(open);
    }
    return line;
  }
  function paintRoutines(): void {
    routines.textContent = '';
    if (!jobsKnown) { routines.append(el('p', { class: 'k7-pane__note bt-routine-note', role: 'listitem', text: 'Unknown. ' + (info.notes.jobs ?? 'boopis could not read its schedule.') })); return; }
    if (!(info.jobs ?? []).length && !pend.add.length) routines.append(el('p', { class: 'k7-pane__note bt-routine-note', role: 'listitem', text: 'No routines yet.' }));
    for (const j of info.jobs ?? []) {
      const going = pend.remove.has(j.id);
      const label = j.name || j.prompt || j.id;
      const meta = [scheduleWords(j.schedule), j.enabled ? (j.next ? 'next ' + j.next : '') : 'paused', j.last && j.last !== 'ok' ? 'last run: ' + j.last : ''].filter(Boolean).join(' · ');
      const row: RowOpts = { label: going ? label + ' (removed when you save)' : label, sub: meta, control: switchHTML('job-' + j.id, label, j.enabled, going) + kit.html.iconButton({ icon: going ? 'check' : 'close', label: (going ? 'Keep routine ' : 'Remove routine ') + label, variant: 'ghost', attrs: { 'data-routine-drop': j.id } }) };
      const item = el('div', { role: 'listitem', 'data-routine': j.id, ...(going ? { 'data-going': '' } : {}) }, [cardOf([row])]);
      const to = deliveryLine(j.deliver); if (to) item.append(to);
      routines.append(item);
    }
    pend.add.forEach((a, i) => {
      routines.append(el('div', { role: 'listitem', 'data-routine': '', 'data-new': '' }, [cardOf([{ label: a.name || a.prompt, sub: scheduleWords(a.schedule) + ' · added when you save', control: kit.html.iconButton({ icon: 'close', label: 'Do not add routine ' + (a.name || a.schedule), variant: 'ghost', attrs: { 'data-routine-undo': String(i) } }) }])]));
    });
  }
  routines.addEventListener('ui:change', (e) => {
    const sw = (e.target as Element).closest<HTMLButtonElement>('[data-switch^="job-"]'); if (!sw) return;
    const id = (sw.dataset['switch'] ?? '').slice(4), on = !!(e as CustomEvent<{ value: boolean }>).detail.value;
    sayError(routineErr, null);
    admin.setRoutinePaused(b.id, id, !on).catch((err: unknown) => { sw.setAttribute('aria-checked', String(!on)); sayError(routineErr, 'It was not ' + (on ? 'resumed' : 'paused') + ': ' + sentence(err)); });
  });
  routines.addEventListener('click', (e) => {
    const t = e.target as Element;
    const drop = t.closest<HTMLElement>('[data-routine-drop]');
    if (drop) { const id = drop.dataset['routineDrop'] ?? ''; if (pend.remove.has(id)) pend.remove.delete(id); else pend.remove.add(id); paintRoutines(); paintDirty(); routines.querySelector<HTMLElement>('[data-routine-drop="' + CSS.escape(id) + '"]')?.focus(); return; }
    const undo = t.closest<HTMLElement>('[data-routine-undo]');
    if (undo) { pend.add.splice(Number(undo.dataset['routineUndo']), 1); paintRoutines(); paintDirty(); }
  });
  const CRON_HINT = 'Minute, hour, day, month, weekday.';
  const promptF = fieldOf({ id: k('routine-prompt'), kind: 'multiline', rows: 2, label: 'What should it do?', placeholder: 'Tell me what changed since yesterday', value: '' });
  const presets = presetChips('Schedule', null, false);
  const cronF = fieldOf({ id: k('routine-cron'), label: 'Cron', mono: true, value: '', placeholder: '0 9 * * 1-5', hint: CRON_HINT });
  const cronIn = inputOf(cronF), cronHint = cronF.querySelector('.k7-field__hint') as HTMLElement, promptIn = inputOf(promptF);
  const cronBad = (bad: boolean, words?: string): void => { cronF.toggleAttribute('data-error', bad); if (bad) cronIn.setAttribute('aria-invalid', 'true'); else cronIn.removeAttribute('aria-invalid'); if (words !== undefined) cronHint.textContent = words; };
  presets.addEventListener('bt:preset', (e) => { cronIn.value = (e as CustomEvent<string>).detail; cronBad(false, cap1(scheduleWords(cronIn.value))); });
  cronIn.addEventListener('input', () => { cronBad(!cronValid(cronIn.value), cronIn.value.trim() ? cap1(scheduleWords(cronIn.value)) : CRON_HINT); paintPresets(presets, cronIn.value); });
  const addRow = kitEl('<div class="bt-add-row">' + kit.html.button({ label: 'Add routine', variant: 'tint', size: 28, disabled: !jobsKnown, attrs: { 'data-routine-add': '' } }) + '</div>');
  addRow.querySelector('[data-routine-add]')?.addEventListener('click', () => {
    const prompt = promptIn.value.trim(), schedule = cronIn.value.trim();
    if (!prompt) { promptIn.setAttribute('aria-invalid', 'true'); promptIn.focus(); return; }
    if (!schedule || !cronValid(schedule) || schedule.split(/\s+/).length !== 5) { cronBad(true, 'A routine needs five fields: minute hour day month weekday.'); cronIn.focus(); return; }
    promptIn.removeAttribute('aria-invalid');
    pend.add.push({ name: prompt.replace(/\s+/g, ' ').slice(0, 40), prompt, schedule });
    promptIn.value = ''; cronIn.value = ''; cronBad(false, CRON_HINT); paintPresets(presets, null);
    paintRoutines(); paintDirty();
  });

  /* ───────── what boopis keeps for it: its own store, saved at once ───────── */
  const c = b.cfg;
  const ownErr = errorOf();
  const own = (p: Partial<Pick<BotConfig, 'gov' | 'cap' | 'workspace'>>, then?: () => void, undo?: () => void): void => {
    sayError(ownErr, null);
    admin.saveOwn(b.id, { cfg: p }).then(() => { if (p.gov) c.gov = p.gov; then?.(); }).catch((e: unknown) => { undo?.(); sayError(ownErr, 'boopis did not save it: ' + sentence(e)); });
  };
  const gov = segFieldOf(k('gov'), 'Governance', [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }], c.gov);
  /* refused (governed mode needs a frontier model): the choice goes back to what is saved, and the reason shows below */
  gov.addEventListener('ui:change', (e) => { const v = (e as CustomEvent<{ value: string }>).detail.value as BotConfig['gov']; own({ gov: v }, undefined, () => { setSeg(gov.querySelector('.k7-seg'), c.gov); }); });
  const capCard = cardOf([{ label: 'Cap per run', sub: CAP_HINT, control: kit.html.field({ id: k('cap'), ariaLabel: 'Cap per run', value: c.cap, mono: true, placeholder: CAP_PLACEHOLDER, attrs: { inputmode: 'decimal', spellcheck: 'false' } }) }]);
  const capIn = capCard.querySelector<HTMLInputElement>('#' + CSS.escape(k('cap'))) as HTMLInputElement;
  capIn.classList.add('bt-cap');
  let capTimer = 0;
  capIn.addEventListener('input', () => { const v = capIn.value.trim(); window.clearTimeout(capTimer); capTimer = window.setTimeout(() => { if (v === '' || /^\d{1,4}(\.\d{1,4})?$/.test(v)) own({ cap: v }); }, 500); });   /* empty: no cap */
  const ws = segFieldOf(k('ws'), 'Workspace', [{ value: 'worktree', label: 'Worktree' }, { value: 'sandbox', label: 'Sandbox' }], c.workspace);
  ws.addEventListener('ui:change', (e) => { own({ workspace: (e as CustomEvent<{ value: string }>).detail.value as BotConfig['workspace'] }); });

  /* ───────── what it has: skills and servers read only; its toolsets switch here (ADR-0048), and its project folder (ADR-0049) ───────── */
  const caps = el('div', { class: 'bt-caps' }, [
    hintOf(inventoryLine('Skills', 'skill', 'skills', info.skills, info.notes.detail)),
    hintOf(inventoryLine('MCP servers', 'server', 'servers', info.mcpServers, info.notes.detail))
  ]);
  const toolErr = errorOf();
  const tools = info.toolsets === null
    ? hintOf(inventoryLine('Toolsets', 'toolset', 'toolsets', info.toolsets, info.notes.detail))
    : cardOf(info.toolsets.map((t) => ({ label: t.label || t.name, control: switchHTML('ts-' + t.name, t.label || t.name, t.enabled) })), { 'aria-label': 'Toolsets' });
  tools.addEventListener('ui:change', (e) => {
    const sw = (e.target as Element).closest<HTMLElement>('[data-switch^="ts-"]'); if (!sw) return;
    const name = (sw.dataset['switch'] ?? '').slice(3), v = !!(e as CustomEvent<{ value: boolean }>).detail.value;
    sayError(toolErr, null);
    admin.setToolsets(b.id, v ? [name] : [], v ? [] : [name]).catch((err: unknown) => { sw.setAttribute('aria-checked', String(!v)); sayError(toolErr, 'boopis did not change it: ' + sentence(err)); });
  });
  const projId = k('project');
  const projCard = cardOf([{ label: 'Project folder', control: kit.html.field({ id: projId, ariaLabel: 'Project folder', value: info.project ?? '', mono: true, placeholder: 'None', attrs: { spellcheck: 'false' } }) }], { 'data-project': '' });
  const projInput = projCard.querySelector<HTMLInputElement>('#' + CSS.escape(projId)) as HTMLInputElement;
  const projErr = errorOf(); sayError(projErr, info.notes.project ?? null);
  let projSaved = info.project ?? '';
  const saveProject = (v: string): void => {
    const want = v.trim();
    if (want === projSaved) return;
    sayError(projErr, null);
    admin.setProject(b.id, want || null).then(() => { projSaved = want; }).catch((e: unknown) => { projInput.value = projSaved; sayError(projErr, 'boopis did not set it: ' + sentence(e)); });
  };
  projInput.addEventListener('change', () => saveProject(projInput.value));
  const project = el('div', { class: 'bt-project' }, [projCard, projErr]);
  if (data().forms.can.folder) {
    const choose = kitEl('<div class="bt-add-row">' + kit.html.button({ label: 'Choose a folder…', variant: 'tint', size: 28 }) + '</div>');
    choose.querySelector('button')?.addEventListener('click', () => { void data().forms.pickFolder().then((f) => { if (f) { projInput.value = f; saveProject(f); } }); });
    project.append(choose);
  }

  const jobsMeta = info.jobs ? (info.jobs.filter((j) => j.enabled).length ? info.jobs.filter((j) => j.enabled).length + ' on' : 'none') : 'unknown';
  const modelSec = sectionOf('model', 'Model', info.model ?? 'not set', [modelCard]);
  body.append(
    whoOf(b), review, gone,
    lookSection(b),
    sectionOf('role', 'Role and instructions', null, [roleF, instrF]),
    modelSec,
    sectionOf('schedule', 'Schedule', jobsMeta, [hintOf('What it does without being asked.'), routines, routineErr, promptF, presets, cronF, addRow]),
    sectionOf('capabilities', 'What it can use', null, [hintOf('Changes apply from its next session.'), caps, tools, toolErr, project]),
    approvalsOf(b),
    sectionOf('rules', 'Limits and workspace', null, [hintOf('The workspace choice doesn’t apply yet.'), gov, capCard, ws, ownErr, runLimitRow(b)])
  );
  paintRoutines();
  const heads = wireSectionKeys(body);

  /* ───────── the foot: archive, delete, review, done ───────── */
  const act = (a: string): HTMLButtonElement => foot.querySelector<HTMLButtonElement>('[data-act="' + a + '"]') as HTMLButtonElement;
  const archive = act('archive'), del = act('delete'), reviewBtn = act('review');
  armArchive(archive, b.name, () => { void archiveBot(); });
  del.addEventListener('click', () => { void askDelete(); });
  reviewBtn.addEventListener('click', () => showReview());
  act('done').addEventListener('click', () => { if (writes().length) { showReview(); return; } closeSettings(); focusConversation(); });
  const paintDirty = (): void => {
    const n = writes().length;
    reviewBtn.hidden = !n;
    reviewBtn.setAttribute('aria-label', 'Review ' + n + (n === 1 ? ' change' : ' changes') + ' before saving');
    (reviewBtn.querySelector('.k7-btn__label') as HTMLElement).textContent = n > 1 ? 'Review ' + n + ' changes' : 'Review changes';
    if (pend.model) setMeta(modelSec, pend.model);
    if (!n) review.hidden = true;
  };

  /* what each change would write, as the kit's DiffView draws a file, then save */
  const linesOf = (diff: string): DiffLine[] => diff.split('\n').map((l) => ({ sign: l.startsWith('+') ? '+' : l.startsWith('-') ? '-' : ' ', text: l.replace(/^[+\- ]/, '') }));
  function showReview(confirmModel = false, ask: string | null = null): void {
    const planned = writes();
    if (!planned.length) { review.hidden = true; return; }
    review.hidden = false; gone.hidden = true;
    review.replaceChildren(kitEl(kit.html.block({ attrs: { 'data-review': '' }, body: '<div class="bt-review__flow">' + kit.html.sectionHead({ title: 'Review before saving' }) +
      '<p class="k7-pane__note">Nothing is written until you save.</p>' +
      planned.map((w) => kit.html.diffView({ path: w.file, lines: linesOf(w.diff), body: 'group' })).join('') +
      (ask ? '<p class="k7-pane__note bt-sheet__error" role="alert">' + esc(ask) + '</p>' : '') +
      '<p class="k7-pane__note bt-sheet__error" role="alert" data-review-error hidden></p>' +
      '<div class="bt-review__acts">' + kit.html.button({ label: 'Keep editing', variant: 'ghost', size: 32, attrs: { 'data-review-act': 'keep' } }) + kit.html.button({ label: ask ? 'Use this model anyway' : 'Save changes', variant: 'primary', size: 32, attrs: { 'data-review-act': 'save' } }) + '</div></div>' })));
    const keep = review.querySelector<HTMLButtonElement>('[data-review-act="keep"]') as HTMLButtonElement, save = review.querySelector<HTMLButtonElement>('[data-review-act="save"]') as HTMLButtonElement;
    const err = review.querySelector<HTMLElement>('[data-review-error]') as HTMLElement;
    keep.addEventListener('click', () => { review.hidden = true; });
    save.addEventListener('click', () => {
      save.disabled = true; keep.disabled = true; sayError(err, null);
      admin.save(b.id, patch(), confirmModel || ask ? { confirmModel: true } : {})
        .then(() => { kit.notify('Saved ' + b.name); if (live()) openSettings(b.id, null, { keepFocus: true }); refreshPresence(); })
        .catch((e: unknown) => {
          if (e instanceof NeedsConfirmation) { showReview(false, e.message); return; }
          save.disabled = false; keep.disabled = false; sayError(err, sentence(e));
          if (live() && /The rest was saved/.test(sentence(e))) { updateRow(b.id); refreshPresence(); }
        });
    });
    requestAnimationFrame(() => { review.scrollIntoView({ block: 'nearest' }); save.focus({ preventScroll: true }); });
  }

  /* delete: say what goes, archive is the first answer, the second is two clicks away (delete-flow.ts, shared with Settings › Bots) */
  async function askDelete(): Promise<void> {
    review.hidden = true;
    await deleteFlow(gone, { id: b.id, name: b.name, admin, live, onCancel: () => { del.focus(); }, onArchive: () => { void archiveBot(); }, onDone: (name) => { afterGone(); kit.notify('Deleted ' + name); } });
  }
  async function archiveBot(): Promise<void> {
    const name = b.name, id = b.id;
    archive.disabled = true;
    try {
      const done = await admin.archive(id);
      afterGone();
      kit.notify('Archived ' + name, { action: { label: 'Undo', onClick: () => { done.undo().then(() => { kit.notify('Restored ' + name); }).catch((e: unknown) => { kit.notify('Could not restore ' + name + ': ' + sentence(e)); }); } } });
    } catch (e) {
      archive.disabled = false; archive.removeAttribute('data-armed'); (archive.querySelector('.k7-btn__label') as HTMLElement).textContent = 'Archive ' + name;
      gone.hidden = false; review.hidden = true;
      gone.replaceChildren(kitEl(kit.html.block({ attrs: { 'data-archive-failed': '' }, body: '<div class="bt-review__flow">' + kit.html.sectionHead({ title: name + ' was not archived' }) + '<p class="k7-pane__note bt-sheet__error" role="alert">' + esc(sentence(e)) + '</p></div>' })));
    }
  }
  /** the bot is gone from the list (the provider said so); open the next one, or the new-bot form when there is none */
  function afterGone(): void {
    closeSettings(true);
    const next = S.bots[0];
    if (next) { openBot(next.id); focusConversation(); } else openNew();
  }

  checkClips();
  if (!loaded) void admin.open(b.id).then(() => { if (live() && !writes().length) { const nb = bot(b.id); if (nb) openSettings(nb.id, focusSection, { keepFocus: true }); } }).catch(() => undefined);
  focusOpen(sh, body, heads, focusSection, keepFocus);
}
