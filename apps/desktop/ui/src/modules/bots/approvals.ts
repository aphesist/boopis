/* A bot sheet's Approvals (7a follow-ups; the lead's design, the parts Settings › Approvals draws: `settings/rule-parts.ts`). It reads
   "Follows your approval rules" (a link to Settings › Approvals where that page exists), then "Only for <bot>": the bot's own rules
   (`own-rules.ts`), each a row led by its Switch, its words, the quiet word of where it came from, Edit and Remove under the pointer or
   the focus; its drafts from "Always allow" first, each a Field with "Save rule" and Discard; "Add a rule". A bot with none says so in
   one quiet line. Writes go where each rule lives: a kind's tier through the bot's own store (`saveTier`: `saveOwn` for a real profile,
   the provider's `update` on the mock), a rule through the rules list (`data().rules`), against the revision read. The last change is a
   SystemLine with Undo (S33's line). The section keeps only how it is arranged (which row is open, the kinds switched off here). */
import { kit } from '@boopis/ui';
import { emit } from '../../core/bus';
import { data } from '../../data';
import type { ApprovalTier, Bot, Choice, Rule, RulesSource, RulesView } from '../../data';
import { later } from '../chat/compose';
import { fill } from '../settings/page';
import { buttonHTML, openSelect, said, sectionOf } from '../settings/rows';
import { catches, draftBlock, originWord, ruleEditor, ruleLimit, rulesCard } from '../settings/rule-parts';
import type { RuleRowOpts } from '../settings/rule-parts';
import { canAllow, ownRules, tierOfSense, tierWords } from './own-rules';
import type { OwnRule } from './own-rules';

export interface ApprovalsDeps {
  /** writes one kind's tier to the bot's own store; rejects with a sentence */
  saveTier(kind: string, tier: ApprovalTier): Promise<void>;
}
type Change = { what: string; undo: () => Promise<unknown> };
/** the section's head: how many rules of its own, or that it follows yours */
const metaOf = (n: number): string => (n ? n + ' of its own' : 'follows your rules');

/** the rules list where it exists for Settings (the rules engine, `rules-settings`); else the bot's kinds alone */
const rulesHere = (): RulesSource | null => (data().rules && later('rules-settings') ? data().rules ?? null : null);

export function approvalsSection(start: Bot, deps: ApprovalsDeps): { el: HTMLElement; meta: string } {
  const el = document.createElement('div');
  el.className = 'hx-rules bt-approvals';
  el.setAttribute('data-ui-part', 'approvals');
  const src = rulesHere();
  const kinds: readonly Choice[] = data().bots.catalog().approvals;
  const tiers: Record<string, ApprovalTier> = { ...start.cfg.approvals };
  const known = Object.keys(tiers).length > 0;
  const off = new Map<string, 'ask' | 'never'>();
  let view: RulesView | null = null, readError = '', open: string | null = null, adding = false, last: Change | null = null, busy = false;
  const b = (): Pick<Bot, 'id' | 'name' | 'cfg'> => ({ id: start.id, name: start.name, cfg: { ...start.cfg, approvals: tiers } });
  const list = (): OwnRule[] => ownRules(b(), known ? kinds : [], view?.rules ?? null, off);

  const read = async (): Promise<void> => {
    if (!src) return;
    try { view = await src.get(); readError = ''; } catch (e) { view = null; readError = said(e); }
  };
  const rowOf = (r: OwnRule): RuleRowOpts => ({ key: r.key, text: r.text, enabled: r.enabled, ...(r.rule ? { origin: originWord(r.rule) } : {}), open: open === r.key });
  /** an opened row: a rule's words in a Field; a kind's choice between asking first and never (its words are the kind's) */
  const editorOf = (r: OwnRule): string => r.from === 'rule' && r.rule
    ? ruleEditor({ key: r.key, text: r.text, hint: catches(r.rule.kinds), removable: true })
    : ruleEditor({ key: r.key, text: r.text, wordsFixed: true, hint: '', removable: true, extra: senseField(r.key, r.sense === 'never' ? 'never' : 'ask', canAllow(r.kind as Choice)) });
  const senseField = (key: string, value: string, canAsk: boolean): string => kit.html.field({ id: 'hx-sense-' + key.replace(/[^\w-]/g, '-'), label: 'What ' + start.name + ' does', control: kit.html.segmented({ label: 'What ' + start.name + ' does', items: [...(canAsk ? [{ value: 'ask', label: 'Asks first' }] : []), { value: 'never', label: 'Never' }], value, attrs: { 'data-sense': key } }) });
  const newEditor = (): string => ruleEditor({ key: 'new', label: 'A new rule for ' + start.name, hint: 'One line, such as “may restart the staging services” or “ask before deploying”.', extra:
    kit.html.field({ id: 'hx-rule-new-type', label: 'When it applies', control: kit.html.segmented({ label: 'When it applies', items: [{ value: 'ask', label: 'Asks first' }, { value: 'exception', label: 'Goes ahead' }], value: 'ask', attrs: { 'data-sense': 'new' } }) }) });

  function draw(): void {
    const keep = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement : null;
    const keepKey = keep ? ['data-rule-switch', 'data-rule-edit', 'data-draft-save', 'data-rule-add'].map((a) => (keep.hasAttribute(a) ? '[' + a + '="' + CSS.escape(keep.getAttribute(a) ?? '') + '"]' : '')).find(Boolean) : '';
    const all = list(), drafts = all.filter((r) => r.draft), rows = all.filter((r) => !r.draft);
    const opened = rows.find((r) => r.key === open);
    const follows = kit.html.pageNote({ parts: src ? ['Follows ', { text: 'your approval rules', attrs: { 'data-open-rules': '' } }, '.'] : ['Anything not listed here runs on its own.'], attrs: { 'data-part': 'follows' } });
    const unread = src && !view && readError ? '<p class="k7-page__note" role="status">Its rules from the list can’t be read: ' + readError + '</p>' : '';
    const unknownKinds = known ? '' : '<p class="k7-page__note">What it asks by kind of action is not shown: this version of boopis’s plugin did not report it.</p>';
    const own = rows.length
      ? rulesCard({ title: 'Only for ' + start.name, rows: rows.map(rowOf), part: 'own', ...(opened ? { editor: editorOf(opened) } : {}) })
      : sectionOf('Only for ' + start.name, '<p class="k7-page__note">Nothing of its own: ' + start.name + ' asks only where your rules say.</p>', { 'data-part': 'own' });
    const change = last ? kit.html.systemLine({ icon: 'sliders', text: last.what, action: 'Undo', attrs: { 'data-last': '' } }) : '';
    fill(el, follows + unread +
      (drafts.length ? sectionOf('Drafts', drafts.map((r) => draftBlock(r.rule as Rule, view, { forWhom: false })).join(''), { 'data-part': 'drafts' }) : '') +
      own + (adding ? newEditor() : '<div class="hx-set__acts">' + buttonHTML('Add a rule', { attrs: { 'data-rule-add': '' } }) + '</div>') + unknownKinds + change);
    if (keepKey) el.querySelector<HTMLElement>(keepKey)?.focus({ preventScroll: true });
    const meta = el.closest('.ui-sec')?.querySelector('.ui-sec__meta');
    if (meta) meta.textContent = metaOf(rows.length);
  }

  /** one change; a refusal is said, and the list read again */
  const run = (fn: () => Promise<unknown>, done: Change | null): void => {
    if (busy) return;
    busy = true;
    fn().then(() => { last = done; }, (e: unknown) => { kit.notify(said(e)); })
      .finally(() => { busy = false; void read().then(draw); });
  };
  const rev = (): number => view?.revision ?? 0;
  const setTier = (kind: string, tier: ApprovalTier): Promise<void> => deps.saveTier(kind, tier).then(() => { tiers[kind] = tier; });
  const own = (key: string): OwnRule | undefined => list().find((r) => r.key === key);
  const kindOf = (key: string): string => key.slice('tier:'.length);
  const textOf = (sel: string): string => (el.querySelector<HTMLInputElement>(sel)?.value ?? '').trim();
  const senseOf = (key: string): string => el.querySelector<HTMLElement>('[data-sense="' + CSS.escape(key) + '"] [aria-checked="true"], [data-sense="' + CSS.escape(key) + '"] [aria-selected="true"]')?.dataset['value'] ?? 'ask';

  const saveRule = (r: Rule | null, text: string, extra: Partial<Rule> = {}): void => {
    const limit = ruleLimit(text);
    if (limit) { kit.notify(limit); return; }
    if (!src) return;
    run(async () => {
      const read = r && text === r.text ? { kinds: r.kinds } : await src.kinds(text).catch(() => ({ kinds: null }));
      const kindsRead = read.kinds ?? r?.kinds ?? [];
      await src.put({ ...(r ? { id: r.id } : { bots: [start.id], source: 'owner' as const }), type: r?.type ?? 'ask', text, kinds: kindsRead, ...extra }, rev());
      open = null; adding = false;
    }, r ? { what: extra.state === 'active' ? 'Rule saved: ' + text : 'Rule changed', undo: () => src.get().then((v) => src.put({ ...r }, v.revision)) } : null);
  };

  el.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement;
    const key = t.dataset['ruleSwitch'];
    if (!key) return;
    const on = !!(e as CustomEvent<{ value: boolean }>).detail.value, r = own(key);
    if (!r) return;
    if (r.from === 'tier') {
      const kind = kindOf(key), was = tiers[kind] ?? 'ask', sense = r.sense === 'never' ? 'never' : 'ask';
      if (!on) off.set(key, sense);
      run(() => setTier(kind, on ? tierOfSense(sense) : 'allow'), { what: (on ? 'Turned on: ' : 'Turned off: ') + r.text, undo: () => setTier(kind, was) });
      return;
    }
    if (!src || !r.rule) return;
    const id = r.rule.id;
    run(() => src.setEnabled(id, on, rev()), { what: (on ? 'Turned on: ' : 'Turned off: ') + r.text, undo: () => src.get().then((v) => src.setEnabled(id, !on, v.revision)) });
  });
  el.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-open-rules]')) { emit('hx:open-settings', { section: 'approvals', from: 'bot-sheet' }); return; }
    const edit = t.closest<HTMLElement>('[data-rule-edit]')?.dataset['ruleEdit'];
    if (edit) { open = open === edit ? null : edit; adding = false; draw(); el.querySelector<HTMLElement>('[data-rule-editor] [data-rule-input], [data-rule-editor] [data-sense] [tabindex="0"]')?.focus(); return; }
    if (t.closest('[data-rule-cancel]')) { open = null; adding = false; draw(); el.querySelector<HTMLElement>('[data-rule-add]')?.focus(); return; }
    if (t.closest('[data-rule-add]')) {
      if (src) { adding = true; open = null; draw(); el.querySelector<HTMLInputElement>('[data-rule-editor="new"] [data-rule-input]')?.focus(); return; }
      /* no rules list here: a rule is a kind of action that asks first */
      const free = kinds.filter((k) => tiers[k.id] === 'allow');
      if (!free.length) { kit.notify(start.name + ' already asks before every kind of action'); return; }
      openSelect(t.closest<HTMLElement>('[data-rule-add]') as HTMLElement, { label: 'A new rule for ' + start.name, heading: 'Asks first', value: '', choices: free.map((k) => ({ value: k.id, label: tierWords(k, 'ask') })),
        onPick: (kind) => { const k = kinds.find((x) => x.id === kind); off.delete('tier:' + kind); run(() => setTier(kind, 'ask'), k ? { what: 'Added: ' + tierWords(k, 'ask'), undo: () => setTier(kind, 'allow') } : null); } });
      return;
    }
    const save = t.closest<HTMLElement>('[data-rule-save]')?.dataset['ruleSave'];
    if (save === 'new') { saveRule(null, textOf('[data-rule-editor="new"] [data-rule-input]'), { type: senseOf('new') === 'exception' ? 'exception' : 'ask', ...(senseOf('new') === 'exception' ? { state: 'active' as const } : {}) }); return; }
    if (save) {
      const r = own(save);
      if (!r) return;
      if (r.from === 'rule' && r.rule) { saveRule(r.rule, textOf('[data-rule-editor="' + CSS.escape(save) + '"] [data-rule-input]')); return; }
      const kind = kindOf(save), was = tiers[kind] ?? 'ask', sense = senseOf(save) === 'never' ? 'never' : 'ask';
      off.delete(save); open = null;
      run(() => setTier(kind, tierOfSense(sense)), { what: 'Rule changed', undo: () => setTier(kind, was) });
      return;
    }
    const remove = t.closest<HTMLElement>('[data-rule-remove]')?.dataset['ruleRemove'];
    if (remove) {
      const r = own(remove);
      if (!r) return;
      open = null;
      if (r.from === 'tier') { const kind = kindOf(remove), was = tiers[kind] ?? 'ask'; off.delete(remove); run(() => setTier(kind, 'allow'), { what: 'Removed: ' + r.text, undo: () => setTier(kind, was === 'allow' ? tierOfSense(r.sense === 'never' ? 'never' : 'ask') : was) }); return; }
      if (!src || !r.rule) return;
      const id = r.rule.id;
      let token = '';
      run(async () => { token = (await src.remove(id, rev())).undo; }, { what: 'Removed: ' + r.text, undo: () => src.undo(token) });
      return;
    }
    const keep = t.closest<HTMLElement>('[data-draft-save]')?.dataset['draftSave'];
    if (keep) { const r = view?.rules.find((x) => x.id === keep); if (r) saveRule(r, textOf('#hx-draft-' + CSS.escape(keep)), { state: 'active', enabled: true }); return; }
    const drop = t.closest<HTMLElement>('[data-draft-discard]')?.dataset['draftDiscard'];
    if (drop && src) { let token = ''; run(async () => { token = (await src.remove(drop, rev())).undo; }, { what: 'Draft discarded', undo: () => src.undo(token) }); return; }
    if (t.closest('[data-last] [data-line]') && last) { const l = last; last = null; run(() => l.undo(), null); }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.matches('[data-rule-input]')) { e.preventDefault(); e.stopPropagation(); t.closest('[data-rule-editor]')?.querySelector<HTMLElement>('[data-rule-save]')?.click(); }
    if (t.matches('[data-draft-input]')) { e.preventDefault(); e.stopPropagation(); t.closest('[data-draft]')?.querySelector<HTMLElement>('[data-draft-save]')?.click(); }
  });
  draw();
  void read().then(draw);
  return { el, meta: metaOf(list().filter((r) => !r.draft).length) };
}

/** a kind's tier as a bot's own store keeps it, for a real profile (`saveOwn`) or the mock's (`update`) */
export function tierSaver(b: Bot): ApprovalsDeps['saveTier'] {
  const admin = data().bots.admin;
  if (b.info && admin) return (kind, tier) => admin.saveOwn(b.id, { cfg: { approvals: { [kind]: tier } } });
  return (kind, tier) => { data().bots.update(b.id, { cfg: { approvals: { [kind]: tier } } }); return Promise.resolve(); };
}
