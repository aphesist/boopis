/* The "who answers next" menu: Automatic (Smart) first, then every model the user can use right now, grouped by provider with the
   provider's logo and each model's readable name. Pure: it builds the entries, the composer opens them in the kit's listbox. */
import { ui } from '@boopis/ui';
import type { SelectEntry, SelectOption } from '@boopis/ui';
import type { ModelChoice } from '../../data';
import { smartPick } from '../../data/smart';
import type { SmartInput } from '../../data/smart';

export const SMART_VALUE = '__smart';
export const SMART_DESC = 'Picks a tier for each message: the cheapest by default, a stronger one for design, debugging, code or a run that keeps failing';
export const FOOT_UNGOVERNED = 'Your pick answers the next messages of this session. Automatic picks a tier for each message.';
export const FOOT_GOVERNED = 'Governed: your pick is where the ladder starts. The gate still moves it up when a run fails.';

/** the choice the session answers with now, matched through aliases ('haiku' is 'claude-haiku-5-5[1m]'); undefined when it is not on the list */
export const currentChoice = (choices: readonly ModelChoice[], current: string): ModelChoice | undefined =>
  choices.find((c) => c.value === current) ?? choices.find((c) => ui.modelMark.same(c.value, current));

export function modelEntries(choices: readonly ModelChoice[], o: { current: string; governed: boolean }): SelectEntry[] {
  const list = [...choices];
  /* the model answering now is always on the list, even when the engine did not offer it */
  if (o.current && !currentChoice(list, o.current)) {
    const s = ui.modelMark.split(o.current);
    list.push({ value: o.current, provider: s.host, model: s.model, providerName: ui.modelMark.provider(s.host) });
  }
  const tiers = list.filter((c) => c.tier !== undefined).length;
  const groups = new Map<string, { name: string; first: string; options: SelectOption[] }>();
  for (const c of list) {
    const key = c.provider || c.providerName;
    let g = groups.get(key);
    if (!g) { g = { name: c.providerName || 'Models', first: c.value, options: [] }; groups.set(key, g); }
    const onLadder = c.tier !== undefined;
    g.options.push({
      value: c.value, label: ui.modelMark.called(c.model) || c.model, model: c.value,
      ...(onLadder ? { desc: 'Tier ' + ((c.tier as number) + 1) + ' of ' + tiers + (c.tier === 0 ? ', the cheapest' : '') } : o.governed ? { desc: 'Not on the ladder' } : {}),
      ...(o.governed && !onLadder ? { disabled: true } : {})
    });
  }
  return [
    { value: SMART_VALUE, label: 'Automatic (Smart)', desc: SMART_DESC, icon: 'spark' },
    ...[...groups.values()].map((g) => ({ label: g.name, model: g.first, options: g.options }))
  ];
}

/** what Smart would pick for the text being typed, among the ladder's tiers; null when there is no ladder to choose from */
export function smartPreview(choices: readonly ModelChoice[], input: SmartInput): { choice: ModelChoice; reason: string } | null {
  const tiers = choices.filter((c) => c.tier !== undefined).sort((a, b) => (a.tier as number) - (b.tier as number));
  const p = smartPick(input, tiers.length);
  const choice = p ? tiers[p.index] : undefined;
  return p && choice ? { choice, reason: p.reason } : null;
}

/* The "@" menu: the same models as "who answers next", without Smart (a mention is an explicit pick, and Smart never overrides it).
   A mention answers one message only; in a governed session every model can be mentioned, and that message runs outside governed mode. */
export const REMOVE_MENTION = '__remove-mention';
export const FOOT_MENTION = 'This message only goes to the model you pick. The session keeps answering with its own.';
export const FOOT_MENTION_GOVERNED = 'This message runs without governance: no cascade, no gate. The next message is governed again.';
export const MENTION_GOVERNED_DESC = 'Runs without governance';

export function mentionEntries(choices: readonly ModelChoice[], o: { current: string; governed: boolean; removable?: boolean }): SelectEntry[] {
  const groups = modelEntries(choices, { current: o.current, governed: false }).filter((e): e is Extract<SelectEntry, { options: readonly SelectOption[] }> => 'options' in e);
  const tiers = choices.filter((c) => c.tier !== undefined).length;
  const withDesc = (opt: SelectOption): SelectOption => {
    const { disabled: _off, ...rest } = opt;
    const c = choices.find((x) => x.value === opt.value);
    const onLadder = c?.tier !== undefined;
    return { ...rest, ...(o.governed ? { desc: (onLadder ? 'Tier ' + ((c?.tier as number) + 1) + ' of ' + tiers + '. ' : '') + MENTION_GOVERNED_DESC } : {}) };
  };
  return [
    ...(o.removable ? [{ value: REMOVE_MENTION, label: 'Remove the mention', icon: 'close' } as SelectOption] : []),
    ...groups.map((g) => ({ ...g, options: g.options.map(withDesc) }))
  ];
}
