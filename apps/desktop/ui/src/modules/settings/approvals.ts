/* Settings › Approvals: the one rules list for every bot (ADR-0060; docs/specs/rules-engine.md 11 and 13). The lead's design, in board
   O-B07's look (the rules as rows, each led by its Switch; on a row under the pointer or the focus its Edit and Remove):
   - a Notice at the top when the file changed outside boopis: "Use the new rules" (keep theirs) and "Keep mine" (put back what boopis
     wrote); changes wait until one is chosen. The file unreadable: "Rules can't be read. Every action asks." (the spec's words);
   - "Drafts" first when "Always allow" kept any: each draft's words in a Field to finish, with what it lets through, then "Save rule"
     (it becomes active) and Discard;
   - "Your approval rules, for every bot" (O-B07's head): a row per ask rule (its Switch, its words, where it came from as a quiet word); Edit opens the row on its
     words in a Field with "What this catches" (the kinds of action it is checked against) and Save; Remove takes it out. "Add a rule"
     opens an empty one; its kinds are the reviewer's reading of its words (`rules.kinds`). Exceptions that are active follow under
     "Bots go ahead without asking";
   - under them: the last change as a SystemLine with Undo (as board S33's line after a change), "Restore defaults" behind a confirm in
     place, and "Reviewer model" as a select (Automatic: the cheapest connected model; or one pinned).
   The page exists only where the plugin reports `rules-v1` (`rules-settings`, the dialog's nav); the provider's `rules` is the host. */
import { kit } from '@boopis/ui';
import { data } from '../../data';
import type { Rule, RulesSource, RulesView, ReviewerChoice } from '../../data';
import { fill, pageEl, revealPart } from './page';
import type { Page } from './page';
import { actionsHTML, buttonHTML, esc, openSelect, said, section, sectionOf } from './rows';
import type { RowOpts } from './rows';

/** where a rule came from, as the quiet word at its row's end */
export const SOURCE_WORDS: Readonly<Record<Rule['source'], string>> = { default: 'default', owner: 'yours', card: 'from a card', chat: 'from a chat' };
/** the kinds of action a rule is checked against, in words ("What this catches") */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  reads: 'reading files', writes: 'writing files', commands: 'running commands', code: 'running code', network: 'network requests', connector_write: 'changes through a connector',
  messages: 'sending messages', spend: 'spending money', browser: 'driving a browser', computer: 'using the computer', delegation: 'handing work to another bot', unknown: 'anything it cannot place'
};
export function catches(kinds: readonly string[]): string {
  const words = kinds.map((k) => KIND_WORDS[k] ?? k);
  if (!words.length) return 'The reviewer has not read what this catches yet.';
  return 'Checked when a bot is ' + (words.length === 1 ? words[0] : words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1]) + '.';
}
const isDraft = (r: Rule): boolean => r.type === 'exception' && r.state === 'draft';
const forWhom = (r: Rule): string => (r.bots && r.bots.length ? 'For ' + r.bots.join(', ') : '');

type Change = { what: string; undo: () => Promise<unknown> };

export function approvalsPage(rules: RulesSource | undefined = data().rules): Page {
  const { el, body } = pageEl('approvals', 'Approvals');
  if (!rules) { fill(body, kit.html.emptyState({ text: 'The rules list is in the desktop app.' })); return { el }; }
  const src = rules;
  let view: RulesView | null = null, readOnce = false, readError = '', open: string | null = null, adding = false, confirming = false, reviewers: readonly ReviewerChoice[] = [], last: Change | null = null, busy = false;

  const read = async (): Promise<void> => {
    try { view = await src.get(); readError = ''; } catch (e) { view = null; readError = said(e); }
    readOnce = true;
  };
  const ruleRow = (r: Rule): RowOpts => ({
    label: r.text, wrap: true,
    leadHTML: kit.html.switch({ checked: r.enabled, label: r.text, attrs: { 'data-rule-switch': r.id } }),
    ...(forWhom(r) ? { sub: forWhom(r) } : {}),
    control: '<span class="k7-row__value">' + esc(r.edited ? 'edited default' : SOURCE_WORDS[r.source]) + '</span>' +
      '<span class="hx-set__hover">' + kit.html.iconButton({ icon: 'pen', label: 'Edit: ' + r.text, variant: 'ghost', expanded: open === r.id, attrs: { 'data-rule-edit': r.id } }) +
      kit.html.iconButton({ icon: 'close', label: 'Remove: ' + r.text, variant: 'ghost', attrs: { 'data-rule-remove': r.id } }) + '</span>',
    attrs: { 'data-rule': r.id, ...(open === r.id ? { 'data-open': '' } : {}) }
  });
  /** a rule opened to edit: its words in a Field, what it catches, Save, Cancel and Remove */
  const editor = (r: Rule | null): string => kit.html.block({ attrs: { 'data-rule-editor': r?.id ?? 'new' }, body:
    kit.html.field({ id: 'hx-rule-text-' + (r?.id ?? 'new'), label: r ? 'The rule' : 'A new rule', value: r?.text ?? '', placeholder: 'Ask before …', hint: r ? catches(r.kinds) : 'One line. The reviewer reads what it catches when you save it.', attrs: { maxlength: '200', 'data-rule-input': '' } }) +
    actionsHTML(buttonHTML('Save', { variant: 'primary', attrs: { 'data-rule-save': r?.id ?? 'new' } }), buttonHTML('Cancel', { variant: 'ghost', attrs: { 'data-rule-cancel': '' } }), r ? buttonHTML('Remove', { variant: 'ghost', attrs: { 'data-rule-remove': r.id } }) : '') });
  /** a card of rule rows, with the opened one's editor under it */
  const rulesCard = (title: string, list: readonly Rule[], part: string, count?: string): string => {
    if (!list.length) return '';
    const rows = list.map(ruleRow);
    const opened = list.find((r) => r.id === open);
    return '<div class="k7-section" data-part="' + part + '">' + kit.html.sectionHead({ title, ...(count ? { count } : {}) }) + kit.html.card({ variant: 'settings', rows, attrs: { 'data-mark-reveal': 'hover' } }) + (opened ? editor(opened) : '') + '</div>';
  };
  const draftHTML = (r: Rule): string => {
    const excepts = (r.excepts ?? []).map((id) => view?.rules.find((x) => x.id === id)?.text ?? id);
    return kit.html.block({ attrs: { 'data-draft': r.id }, body:
      kit.html.field({ id: 'hx-draft-' + r.id, label: 'Always allow', value: r.text, hint: [forWhom(r), excepts.length ? 'Lets through: ' + excepts.join('; ') : '', (r.match ?? []).length ? 'Only: ' + (r.match ?? []).join(', ') : ''].filter(Boolean).join('. ') || 'An exception kept from “Always allow”. It does nothing until you save it.', attrs: { maxlength: '200', 'data-draft-input': '' } }) +
      actionsHTML(buttonHTML('Save rule', { variant: 'primary', attrs: { 'data-draft-save': r.id } }), buttonHTML('Discard', { variant: 'ghost', attrs: { 'data-draft-discard': r.id } })) });
  };
  const reviewerLabel = (v: RulesView): string => (v.reviewer.mode === 'auto' ? 'Automatic' : v.reviewer.model ?? 'Automatic');
  function draw(): void {
    const keep = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement : null;
    const keepKey = keep ? ['data-rule-switch', 'data-rule-edit', 'data-draft-save', 'data-rule-save'].map((a) => (keep.hasAttribute(a) ? '[' + a + '="' + CSS.escape(keep.getAttribute(a) ?? '') + '"]' : '')).find(Boolean) : '';
    if (!view && !readOnce) { fill(body, '<p class="k7-page__note" role="status">Reading your rules.</p>'); return; }
    if (!view) {
      fill(body, kit.html.notice({ tone: 'red', icon: 'shield', title: 'Rules can’t be read. Every action asks.', text: readError ? ' ' + readError : '', actions: [{ label: 'Read again', value: 'reread' }] }));
      return;
    }
    const v = view;
    const outside = v.changedOutside ? kit.html.notice({ tone: 'owe', icon: 'shield', title: 'The rules changed outside boopis', text: '', actions: [{ label: 'Use the new rules', value: 'accept', primary: true }, { label: 'Keep mine', value: 'discard' }], attrs: { 'data-outside': '' } }) : '';
    const drafts = v.rules.filter(isDraft), asks = v.rules.filter((r) => r.type === 'ask'), allowed = v.rules.filter((r) => r.type === 'exception' && !isDraft(r));
    const on = asks.filter((r) => r.enabled).length;
    const change = last ? kit.html.systemLine({ icon: 'sliders', text: last.what, action: 'Undo', attrs: { 'data-last': '' } }) : '';
    const reviewerSub = v.reviewerStatus === 'none' ? 'No reviewer yet: a check it cannot make holds the action.' : v.reviewerStatus === 'failing' ? 'The reviewer is failing: checks hold the action until it answers.' : 'Reads each action against your rules. Automatic picks the cheapest model you have connected.';
    fill(body,
      outside +
      (drafts.length ? sectionOf('Drafts', drafts.map(draftHTML).join(''), { 'data-part': 'drafts', id: 'hx-set-drafts' }) : '') +
      (asks.length ? rulesCard('Your approval rules, for every bot', asks, 'asks', on + ' on') : sectionOf('Your approval rules, for every bot', kit.html.emptyState({ text: 'Nothing asks. Bots do everything.' }), { 'data-part': 'asks' })) +
      (adding ? editor(null) : '<div class="hx-set__acts">' + buttonHTML('Add a rule', { attrs: { 'data-rule-add': '' } }) + '</div>') +
      rulesCard('Bots go ahead without asking', allowed, 'allowed') +
      '<p class="k7-page__note">Anything not on the list runs on its own. A check that fails holds the action.</p>' +
      change +
      section('Rules', [
        confirming
          ? { label: 'Put the shipped rules back?', sub: 'Their words, on, for every bot; removed ones come back. Your own rules stay.', control: actionsHTML(buttonHTML('Restore', { variant: 'danger', attrs: { 'data-restore': 'yes' } }), buttonHTML('Cancel', { variant: 'ghost', attrs: { 'data-restore': 'no' } })) }
          : { label: 'Restore defaults', sub: v.removedDefaults.length ? v.removedDefaults.length + ' removed' : 'The shipped rules, as they came.', control: buttonHTML('Restore defaults', { attrs: { 'data-restore': 'ask' } }) },
        { label: 'Reviewer model', sub: reviewerSub, control: kit.html.selectorItem({ variant: 'field', label: 'Reviewer model', value: reviewerLabel(v), attrs: { 'data-select': 'reviewer' } }) }
      ], { 'data-part': 'more' }));
    if (keepKey) body.querySelector<HTMLElement>(keepKey)?.focus({ preventScroll: true });
  }
  /** run a change against the revision read; a conflict or a refusal is said and the list read again */
  const run = (fn: (rev: number) => Promise<unknown>, done?: Change | null): void => {
    if (busy || !view) return;
    busy = true;
    fn(view.revision).then(() => { if (done !== undefined) last = done; }, (e: unknown) => { kit.notify(said(e)); })
      .finally(() => { busy = false; void read().then(draw); });
  };
  const textOf = (sel: string): string => (body.querySelector<HTMLInputElement>(sel)?.value ?? '').trim();
  const rule = (id: string): Rule | undefined => view?.rules.find((r) => r.id === id);
  const saveText = (r: Rule | null, text: string, extra: Partial<Rule> = {}): void => {
    if (!text) { kit.notify('Write the rule first'); return; }
    if (text.length > 200) { kit.notify('A rule is one line of at most 200 characters'); return; }
    run(async (rev) => {
      const read = r && text === r.text ? { kinds: r.kinds } : await src.kinds(text).catch(() => ({ kinds: null }));
      const kinds = read.kinds ?? r?.kinds ?? [];
      const out = await src.put({ ...(r ? { id: r.id } : {}), type: r?.type ?? 'ask', text, kinds, ...extra }, rev);
      open = null; adding = false;
      return out;
    }, r ? { what: extra.state === 'active' ? 'Rule saved: ' + text : 'Rule changed', undo: () => src.get().then((v) => src.put({ ...r }, v.revision)) } : null);
  };

  body.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement;
    const id = t.dataset['ruleSwitch'];
    if (!id) return;
    const on = !!(e as CustomEvent<{ value: boolean }>).detail.value, r = rule(id);
    run((rev) => src.setEnabled(id, on, rev), r ? { what: (on ? 'Turned on: ' : 'Turned off: ') + r.text, undo: () => src.get().then((v) => src.setEnabled(id, !on, v.revision)) } : null);
  });
  body.addEventListener('click', (e) => {
    const t = e.target as Element;
    const val = t.closest<HTMLElement>('[data-kit~="Notice"] [data-value]')?.dataset['value'];
    if (val === 'reread') { void read().then(draw); return; }
    if (val === 'accept') { run(() => src.acceptOutside(), null); return; }
    if (val === 'discard') { run(() => src.discardOutside(), null); return; }
    const edit = t.closest<HTMLElement>('[data-rule-edit]')?.dataset['ruleEdit'];
    if (edit) { open = open === edit ? null : edit; adding = false; draw(); body.querySelector<HTMLInputElement>('[data-rule-editor] [data-rule-input]')?.focus(); return; }
    if (t.closest('[data-rule-cancel]')) { open = null; adding = false; draw(); return; }
    if (t.closest('[data-rule-add]')) { adding = true; open = null; draw(); body.querySelector<HTMLInputElement>('[data-rule-editor="new"] [data-rule-input]')?.focus(); return; }
    const save = t.closest<HTMLElement>('[data-rule-save]')?.dataset['ruleSave'];
    if (save) { saveText(save === 'new' ? null : rule(save) ?? null, textOf('[data-rule-editor="' + CSS.escape(save) + '"] [data-rule-input]')); return; }
    const remove = t.closest<HTMLElement>('[data-rule-remove]')?.dataset['ruleRemove'];
    if (remove) {
      const r = rule(remove);
      let token = '';
      run(async (rev) => { const out = await src.remove(remove, rev); token = out.undo; open = null; }, r ? { what: 'Removed: ' + r.text, undo: () => src.undo(token) } : null);
      return;
    }
    const keep = t.closest<HTMLElement>('[data-draft-save]')?.dataset['draftSave'];
    if (keep) { const r = rule(keep); if (r) saveText(r, textOf('#hx-draft-' + CSS.escape(keep)), { state: 'active', enabled: true }); return; }
    const drop = t.closest<HTMLElement>('[data-draft-discard]')?.dataset['draftDiscard'];
    if (drop) { const r = rule(drop); let token = ''; run(async (rev) => { token = (await src.remove(drop, rev)).undo; }, r ? { what: 'Draft discarded', undo: () => src.undo(token) } : null); return; }
    if (t.closest('[data-last] [data-line]') && last) { const l = last; last = null; run(() => l.undo(), null); return; }
    const restore = t.closest<HTMLElement>('[data-restore]')?.dataset['restore'];
    if (restore === 'ask') { confirming = true; draw(); body.querySelector<HTMLElement>('[data-restore="no"]')?.focus(); return; }
    if (restore === 'no') { confirming = false; draw(); return; }
    if (restore === 'yes') { confirming = false; run(() => src.restoreDefaults(), null); return; }
    const sel = t.closest<HTMLElement>('[data-select="reviewer"]');
    if (sel && view) {
      const v = view;
      const pick = (): void => openSelect(sel, {
        label: 'Reviewer model', value: v.reviewer.mode === 'auto' ? 'auto' : (v.reviewer.provider ?? '') + '/' + (v.reviewer.model ?? ''),
        choices: [{ value: 'auto', label: 'Automatic', desc: 'The cheapest model you have connected' }, ...reviewers.map((c) => ({ value: c.provider + '/' + c.model, label: c.model, desc: c.provider + (c.estimateUsd != null ? ', about $' + c.estimateUsd.toFixed(4) + ' a check' : '') }))],
        onPick: (val2) => {
          const c = reviewers.find((x) => x.provider + '/' + x.model === val2) ?? null;
          run(async () => { const problems = await src.setReviewer(val2 === 'auto' ? 'auto' : 'pinned', c); if (problems.length) kit.notify('The reviewer could not be set for: ' + problems.join('; ')); }, null);
        }
      });
      if (reviewers.length) pick(); else void src.reviewers().then((r) => { reviewers = r; pick(); }, (err: unknown) => { kit.notify(said(err)); });
    }
  });
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.matches('[data-rule-input]')) { e.preventDefault(); t.closest('[data-rule-editor]')?.querySelector<HTMLElement>('[data-rule-save]')?.click(); }
    if (t.matches('[data-draft-input]')) { e.preventDefault(); t.closest('[data-draft]')?.querySelector<HTMLElement>('[data-draft-save]')?.click(); }
  });
  const off = src.onChangedOutside(() => { void read().then(draw); });
  draw();
  const loaded = read().then(draw);
  return {
    el,
    refresh: async () => { await read(); draw(); },
    reveal: async (o) => { await loaded; if (o.focus === 'drafts') revealPart(body.querySelector('#hx-set-drafts') ?? body.querySelector('[data-part="asks"]')); },
    destroy: off
  };
}
