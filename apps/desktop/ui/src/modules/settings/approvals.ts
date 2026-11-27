/* Settings › Approvals: the rules for every bot (ADR-0060; docs/specs/rules-engine.md 11 and 13). The lead's design, in board O-B07's
   look (the rules as rows, each led by its Switch; on a row under the pointer or the focus its Edit and Remove; the parts are
   `rule-parts.ts`, the same a bot sheet's Approvals draws):
   - a Notice at the top when the file changed outside boopis: "Use the new rules" (keep theirs) and "Keep mine" (put back what boopis
     wrote); changes wait until one is chosen. The file unreadable: "Rules can't be read. Every action asks." (the spec's words);
   - "Drafts" first when "Always allow" kept any that name no bot: each draft's words in a Field to finish, then "Save rule" and Discard;
   - "Your approval rules, for every bot" (O-B07's head): a row per ask rule; Edit opens it on its words in a Field with "What this
     catches" and Save; Remove takes it out. "Add a rule" opens an empty one. Exceptions for every bot follow under "Bots go ahead without
     asking";
   - only rules for every bot are here (7a follow-ups, the owner: "if there's a way to make a setting bot specific, it should be in the
     bot's settings"): a rule or a draft that names a bot is in that bot's sheet, and one quiet line names the bots with rules of their
     own, each a link to its sheet's Approvals (hidden when none);
   - under them: the built-in protections in a line, the last change as a SystemLine with Undo (S33's line), "Restore defaults" behind a
     confirm in place, and "Reviewer model" as a select.
   The page exists only where the plugin reports `rules-v1` (`rules-settings`, the dialog's nav); the provider's `rules` is the host. */
import { kit } from '@boopis/ui';
import type { PageNotePart } from '@boopis/ui';
import { data, BOOPIS_ID } from '../../data';
import type { Rule, RulesSource, RulesView, ReviewerChoice } from '../../data';
import { fill, pageEl, revealPart } from './page';
import type { Page } from './page';
import { actionsHTML, buttonHTML, openSelect, said, section, sectionOf } from './rows';
import { BUILT_IN, catches, draftBlock, everyBot, isDraft, originWord, ruleEditor, ruleLimit, rulesCard } from './rule-parts';
import type { RuleRowOpts } from './rule-parts';
import { ownCount } from '../bots/own-rules';
import { openBotSheet } from './open-bot';

export { SOURCE_WORDS, KIND_WORDS, catches } from './rule-parts';

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
  const rowOf = (r: Rule): RuleRowOpts => ({ key: r.id, text: r.text, enabled: r.enabled, origin: originWord(r), open: open === r.id });
  const editor = (r: Rule | null): string => ruleEditor({ key: r?.id ?? 'new', ...(r ? { text: r.text } : {}), hint: r ? catches(r.kinds) : 'One line. The reviewer reads what it catches when you save it.', removable: !!r });
  const card = (title: string, list: readonly Rule[], part: string, count?: string): string => {
    const opened = list.find((r) => r.id === open);
    return rulesCard({ title, rows: list.map(rowOf), part, ...(count ? { count } : {}), ...(opened ? { editor: editor(opened) } : {}) });
  };
  /** the bots with rules of their own (the rules list's that name them, and their kinds that ask or are blocked), each a link to its sheet */
  const ownLine = (v: RulesView): string => {
    const kinds = data().bots.catalog().approvals;
    const bots = data().bots.snapshot().bots.filter((b) => b.id !== BOOPIS_ID && (() => { const n = ownCount(b, kinds, v.rules); return n.rules + n.drafts > 0; })());
    if (!bots.length) return '';
    const parts: PageNotePart[] = [bots.length === 1 ? 'One bot has rules of its own: ' : 'Bots with rules of their own: '];
    bots.forEach((b, i) => { if (i) parts.push(i === bots.length - 1 ? ' and ' : ', '); parts.push({ text: b.name, attrs: { 'data-own-bot': b.id, 'aria-label': b.name + '’s own rules' } }); });
    parts.push('.');
    return kit.html.pageNote({ parts, attrs: { 'data-part': 'own' } });
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
    const all = v.rules.filter(everyBot);
    const drafts = all.filter(isDraft), asks = all.filter((r) => r.type === 'ask'), allowed = all.filter((r) => r.type === 'exception' && !isDraft(r));
    const on = asks.filter((r) => r.enabled).length;
    const change = last ? kit.html.systemLine({ icon: 'sliders', text: last.what, action: 'Undo', attrs: { 'data-last': '' } }) : '';
    const reviewerSub = v.reviewerStatus === 'none' ? 'No reviewer yet: a check it cannot make holds the action.' : v.reviewerStatus === 'failing' ? 'The reviewer is failing: checks hold the action until it answers.' : 'Reads each action against your rules. Automatic picks the cheapest model you have connected.';
    fill(body,
      outside +
      (drafts.length ? sectionOf('Drafts', drafts.map((r) => draftBlock(r, v)).join(''), { 'data-part': 'drafts', id: 'hx-set-drafts' }) : '') +
      (asks.length ? card('Your approval rules, for every bot', asks, 'asks', on + ' on') : sectionOf('Your approval rules, for every bot', kit.html.emptyState({ text: 'Nothing asks. Bots do everything.' }), { 'data-part': 'asks' })) +
      (adding ? editor(null) : '<div class="hx-set__acts">' + buttonHTML('Add a rule', { attrs: { 'data-rule-add': '' } }) + '</div>') +
      card('Bots go ahead without asking', allowed, 'allowed') +
      '<p class="k7-page__note">Anything not on the list runs on its own. A check that fails holds the action.</p>' +
      '<p class="k7-page__note" data-part="built-in">' + BUILT_IN + '</p>' +
      ownLine(v) +
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
    const limit = ruleLimit(text);
    if (limit) { kit.notify(limit); return; }
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
    const own = t.closest<HTMLElement>('[data-own-bot]')?.dataset['ownBot'];
    if (own) { openBotSheet(body, own, 'approvals'); return; }
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
