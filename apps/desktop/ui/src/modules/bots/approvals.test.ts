// @vitest-environment jsdom
/* A bot sheet's Approvals (7a follow-ups): a bot's own rules read from its tiers and the rules list (`own-rules.ts`), what Settings › Bots
   says of a bot, where "Open" on a receipt goes, and the section driven as a person drives it against a scripted rules list. */
import { beforeEach, describe, expect, it } from 'vitest';
import { on } from '../../core/bus';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import type { ApprovalTier, Bot, DataProvider } from '../../data';
import { APPROVALS } from '../../data/bot-catalog';
import { DEFAULT_RULES, DRAFT, EXCEPTION, fakeRules, withSettings } from '../../lab/settings-fixtures';
import type { FakeRules } from '../../lab/settings-fixtures';
import { approvalsSection } from './approvals';
import { botStatus, ownRules } from './own-rules';
import { draftHome } from './rule-route';

const tick = (n = 4): Promise<void> => new Promise((r) => { let i = 0; const go = (): void => { if (++i >= n) r(); else setTimeout(go, 0); }; setTimeout(go, 0); });
const ALLOW: Record<string, ApprovalTier> = { deploys: 'allow', push: 'allow', network: 'allow', spend: 'ask', people: 'allow', outside: 'allow', delete: 'allow', commands: 'allow' };
const botOf = (id: string, approvals: Record<string, ApprovalTier> = ALLOW): Bot => {
  const b = (createMockProvider({ simulate: false }) as DataProvider).bots.snapshot().bots.find((x) => x.id === id) as Bot;
  return { ...b, cfg: { ...b.cfg, approvals } };
};
const ASK: typeof DRAFT = { id: 'r_kai_ask', type: 'ask', text: 'Ask before publishing the docs site.', enabled: true, source: 'owner', bots: ['kai'], kinds: ['commands'] };

describe('a bot\'s own rules', () => {
  it('a kind that asks is an extra ask, a blocked one "may never", Allow adds nothing; spending past the cap always asks, so it is not its own', () => {
    const r = ownRules(botOf('kai', { ...ALLOW, deploys: 'ask', people: 'block' }), APPROVALS, null);
    expect(r.map((x) => [x.sense, x.text])).toEqual([['ask', 'Asks before deploying anywhere'], ['never', 'May never message people']]);
    expect(ownRules(botOf('kai'), APPROVALS, null)).toEqual([]);
    expect(ownRules(botOf('kai', { ...ALLOW, spend: 'block' }), APPROVALS, null).map((x) => x.text)).toEqual(['May never spend past the run cap']);
  });
  it('rules naming the bot are its own: an ask rule asks, an exception lets through, a draft comes first; rules for every bot are not', () => {
    const r = ownRules(botOf('kai'), APPROVALS, [...DEFAULT_RULES, DRAFT, EXCEPTION, ASK, { ...EXCEPTION, id: 'k2', bots: ['kai'], text: 'kai may restart the docs preview.' }]);
    expect(r.map((x) => [x.sense, x.draft, x.text])).toEqual([
      ['allow', true, DRAFT.text], ['ask', false, ASK.text], ['allow', false, 'kai may restart the docs preview.']
    ]);
  });
  it('Settings › Bots says only what differs: its own rules, drafts to finish, a cap', () => {
    expect(botStatus(botOf('kai'), APPROVALS, null)).toBe('Follows your rules');
    expect(botStatus({ ...botOf('kai', { ...ALLOW, deploys: 'ask' }), cfg: { ...botOf('kai').cfg, approvals: { ...ALLOW, deploys: 'ask', push: 'block' }, cap: '5' } }, APPROVALS, [DRAFT])).toBe('2 rules of its own · 1 draft to finish · $5 cap');
  });
  it('"Open" on a receipt goes to the asker\'s sheet when a draft names it, else Settings › Approvals', () => {
    const kai = { id: 'kai', name: 'kai' };
    expect(draftHome([...DEFAULT_RULES, DRAFT], kai)).toBe('bot');
    expect(draftHome([...DEFAULT_RULES, { ...DRAFT, bots: null }], kai)).toBe('settings');
    expect(draftHome([...DEFAULT_RULES, DRAFT], { id: 'nina', name: 'nina' })).toBe('settings');
    expect(draftHome([DRAFT], null)).toBe('settings');
  });
});

describe('the sheet\'s Approvals', () => {
  let rules: FakeRules, writes: string[], host: HTMLElement;
  const mount = async (b: Bot, list = [...DEFAULT_RULES], o: { rulesOn?: boolean } = {}): Promise<void> => {
    rules = fakeRules({ rules: list }); writes = [];
    const p = createMockProvider({ simulate: false }) as DataProvider;
    setProvider(o.rulesOn === false ? p : withSettings(p, { rules, speech: null }));
    const a = approvalsSection(b, { saveTier: async (kind, tier) => { writes.push(kind + ':' + tier); } });
    host = document.createElement('div'); host.dataset['ui'] = 'v7'; host.append(a.el); document.body.replaceChildren(host);
    await tick(6);
  };
  const q = <T extends HTMLElement = HTMLElement>(s: string): T => { const n = host.querySelector<T>(s); if (!n) throw new Error('missing ' + s); return n; };
  beforeEach(() => { document.body.replaceChildren(); });

  it('follows your rules (a link to Settings › Approvals); a bot with none of its own says so, with Add a rule', async () => {
    await mount(botOf('kai'));
    expect(q('[data-part="follows"]').textContent).toBe('Follows your approval rules.');
    expect(q('[data-part="own"]').textContent).toContain('Nothing of its own: kai asks only where your rules say.');
    expect(host.querySelector('[data-rule-add]')).not.toBeNull();
    expect(host.textContent).not.toMatch(/tier/i);
    const seen: string[] = [];
    on('hx:open-settings', (d) => { seen.push(d.section); });
    q<HTMLButtonElement>('[data-open-rules]').click();
    expect(seen).toEqual(['approvals']);
  });
  it('its rules: an extra ask, a "may never", a let-through, each with its switch; its draft first with Save rule and Discard', async () => {
    await mount(botOf('kai', { ...ALLOW, deploys: 'ask', people: 'block' }), [...DEFAULT_RULES, DRAFT, { ...EXCEPTION, id: 'k2', bots: ['kai'], text: 'kai may restart the docs preview.' }]);
    const words = [...host.querySelectorAll('[data-part="own"] [data-rule]')].map((r) => r.querySelector('.k7-row__label')?.firstChild?.textContent);
    expect(words).toEqual(['Asks before deploying anywhere', 'May never message people', 'kai may restart the docs preview.']);
    expect(host.querySelectorAll('[data-part="own"] [data-rule] [data-kit~="Switch"]')).toHaveLength(3);
    expect(host.querySelector('[data-part="drafts"]')?.compareDocumentPosition(q('[data-part="own"]'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    q<HTMLButtonElement>('[data-draft-save="x_draft1"]').click();
    await tick(8);
    expect(rules.calls).toContain('put:x_draft1:' + DRAFT.text);
    expect(host.querySelector('[data-draft]')).toBeNull();
  });
  it('a kind switched off stops asking (Allow) and stays, off, until the sheet is drawn again; Undo puts it back', async () => {
    await mount(botOf('nina', { ...ALLOW, deploys: 'ask' }));
    q<HTMLButtonElement>('[data-rule-switch="tier:deploys"]').click();
    await tick(6);
    expect(writes).toEqual(['deploys:allow']);
    expect(q('[data-rule-switch="tier:deploys"]').getAttribute('aria-checked')).toBe('false');
    q<HTMLButtonElement>('[data-last] [data-line]').click();
    await tick(6);
    expect(writes).toEqual(['deploys:allow', 'deploys:ask']);
  });
  it('Edit on a kind chooses between asking first and never; Remove lets it follow your rules', async () => {
    await mount(botOf('nina', { ...ALLOW, deploys: 'ask' }));
    q<HTMLButtonElement>('[data-rule-edit="tier:deploys"]').click();
    const ed = q('[data-rule-editor="tier:deploys"]');
    expect(ed.textContent).toContain('Asks before deploying anywhere');
    ed.querySelector<HTMLElement>('[data-sense] [data-value="never"]')?.click();
    ed.querySelector<HTMLButtonElement>('[data-rule-save]')?.click();
    await tick(6);
    expect(writes).toEqual(['deploys:block']);
    expect(q('[data-part="own"]').textContent).toContain('May never deploy anywhere');
    q<HTMLButtonElement>('[data-rule-remove="tier:deploys"]').click();
    await tick(6);
    expect(writes).toEqual(['deploys:block', 'deploys:allow']);
    expect(q('[data-part="own"]').textContent).toContain('Nothing of its own');
  });
  it('Add a rule: its words and whether it asks first or goes ahead, kept in the rules list for this bot alone', async () => {
    await mount(botOf('kai'));
    q<HTMLButtonElement>('[data-rule-add]').click();
    q<HTMLInputElement>('[data-rule-editor="new"] [data-rule-input]').value = 'may restart the staging services';
    q<HTMLElement>('[data-sense="new"] [data-value="exception"]').click();
    q<HTMLButtonElement>('[data-rule-save="new"]').click();
    await tick(8);
    expect(rules.calls).toContain('put:new:may restart the staging services');
    const kept = (await rules.get()).rules.find((r) => r.text === 'may restart the staging services');
    expect([kept?.type, kept?.bots]).toEqual(['exception', ['kai']]);
    expect(q('[data-part="own"]').textContent).toContain('may restart the staging services');
  });
  it('a rule of its own from the list: its switch and Remove write to the list, with Undo', async () => {
    await mount(botOf('kai'), [...DEFAULT_RULES, ASK]);
    q<HTMLButtonElement>('[data-rule-switch="rule:r_kai_ask"]').click();
    await tick(6);
    expect(rules.calls).toContain('enabled:r_kai_ask:false');
    q<HTMLButtonElement>('[data-rule-remove="rule:r_kai_ask"]').click();
    await tick(6);
    expect(rules.calls).toContain('remove:r_kai_ask');
    q<HTMLButtonElement>('[data-last] [data-line]').click();
    await tick(6);
    expect(rules.calls.some((c) => c.startsWith('undo:'))).toBe(true);
  });
  it('without the rules engine: its kinds alone, and Add a rule picks a kind that will ask first', async () => {
    await mount(botOf('kai'), [], { rulesOn: false });
    expect(q('[data-part="follows"]').textContent).toBe('Anything not listed here runs on its own.');
    q<HTMLButtonElement>('[data-rule-add]').click();
    await tick(2);
    const row = [...document.querySelectorAll<HTMLElement>('.k7-menu [role^="menuitem"]')].find((r) => r.textContent?.includes('Asks before deploying anywhere'));
    row?.click();
    await tick(6);
    expect(writes).toEqual(['deploys:ask']);
  });
});
