/* The engines the kit draws with, in specimens (2b: the v6 gallery went with the v6 library): a model's mark and name, a bot's orb, the
   avatar stack. Each is the kit's own: InlineChip, Avatar, the dock and the rail draw them. */
import { modelEl, modelMark, orb, routeEl, stackOf, STATES } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';
import { BOT_LIKE, BOT_LONG, LONG_NAME, LONG_TITLE, TEAM_SIX, manyBots } from '../../fixtures';
import type { Bot } from '../../../data/types';

const MANY = manyBots(120, TEAM_SIX.map((b) => ({ ...b }) as unknown as Bot));
const stackTypical = stage(['typical', 'size'], ({ root }) => { for (const size of [16, 20, 32]) line(root, stackOf({ members: TEAM_SIX.slice(0, 3), size, still: true })); }, { note: 'one step (a third of an orb), the first member underneath and each next one on top' });
const stackFocus = stage(['focus'], ({ root }) => { line(root, stackOf({ members: TEAM_SIX, size: 20, max: 4, focusable: true, still: true })); }, { force: [{ sel: '.ui-stack[tabindex]', state: 'focus' }], note: 'with names folded into "+N" the stack takes a tab stop, so every name is reachable in its tooltip' });
const cmp = (id: string, title: string, covers: string[], states: Story['states']): Story => ({ id: 'components/' + id, title, area: 'components', kind: 'component', covers, states });

export default [
  cmp('model-mark', 'Model marks', ['engine:model-mark'], {
    typical: stage(['typical', 'variant'], ({ root }) => {
      line(root, ...['sonnet 5.5', 'opus 5.5', 'haiku 4.5', 'qwen3-coder', 'gpt-5', 'gemini-3-pro', 'llama-4', 'mistral-large'].map((m) => modelEl(m)));
      line(root, ...['sonnet 5.5', 'gpt-5', 'gemini-3-pro'].map((m) => modelEl(m, { color: 'brand' })));
      line(root, routeEl('qwen3-coder → sonnet 5.5'), modelMark('opus 5.5', { size: 24 }));
    }, { width: 720 }),
    'unknown family': stage(['error'], ({ root }) => { line(root, modelEl('mystery-model-9'), modelMark('???')); }),
    long: stage(['long'], ({ root }) => { line(root, modelEl('claude-sonnet-5-5-20261101-extended-context-preview'), routeEl('qwen3-coder-480b → haiku 4.5 → sonnet 5.5 → opus 5.5')); }, { width: 360 })
  }),
  cmp('orb', 'Orb', ['engine:orb'], {
    typical: stage(['typical', 'size'], ({ root }) => { line(root, ...[16, 20, 28, 40, 64].map((size) => orb(BOT_LIKE, { size, still: true }))); }, { allow: { visual: 'orbs are drawn still; their idle motion is random by design' } }),
    states: stage(['variant'], ({ root }) => { line(root, ...Object.keys(STATES).map((state) => orb({ ...BOT_LIKE, state }, { size: 40, still: true }))); }, { width: 720 }),
    'with a flag': stage(['variant'], ({ root }) => { line(root, orb(BOT_LIKE, { size: 40, flag: true, still: true }), orb(BOT_LONG, { size: 40, flag: true, still: true })); }),
    long: stage(['long'], ({ root }) => { line(root, orb(BOT_LONG, { size: 28, still: true })); }, { note: 'an orb shows no name' }),
    'on the dock': stage(['variant'], ({ root }) => { line(root, ...[28, 40].map((size) => orb(BOT_LIKE, { size, still: true }))); }, { ground: 'dock' })
  }),
  cmp('stack', 'Stack', ['engine:stack'], {
    typical: stackTypical,
    'focused, with +N': stackFocus,
    'four places and +N': stage(['variant', 'many'], ({ root }) => { for (const size of [16, 20, 32]) line(root, stackOf({ members: TEAM_SIX, size, max: 4, still: true })); }, { note: 'six members in four places: three orbs and "+3", the chip overlapped by the same step as an orb' }),
    'one and two': stage(['single'], ({ root }) => { line(root, stackOf({ members: TEAM_SIX.slice(0, 1), size: 16, still: true }), stackOf({ members: TEAM_SIX.slice(0, 2), size: 16, still: true }), stackOf({ members: TEAM_SIX.slice(0, 2), size: 32, still: true })); }),
    'a hundred and twenty': stage(['many'], ({ root }) => { line(root, stackOf({ members: MANY, size: 16, max: 4, still: true }), stackOf({ members: MANY, size: 32, max: 4, still: true })); }, { note: 'a "+N" too wide for a disc becomes a capsule, overlapped the same way' }),
    long: stage(['long'], ({ root }) => { line(root, stackOf({ members: [BOT_LONG, ...TEAM_SIX.slice(0, 2)], size: 20, still: true }), stackOf({ members: [BOT_LONG, ...TEAM_SIX], size: 20, max: 4, label: LONG_NAME + ', ' + LONG_TITLE, still: true })); }, { note: 'a stack shows no names: they are its accessible name and its tooltip' }),
    'on the dock': stage(['variant'], ({ root }) => { line(root, stackOf({ members: TEAM_SIX, size: 20, max: 4, still: true })); }, { ground: 'dock' }),
    'cluster: two to six members': stage(['variant', 'many'], ({ root }) => { for (const max of [4, 6]) line(root, ...[2, 3, 4, 5, 6].map((n) => stackOf({ members: TEAM_SIX.slice(0, n), size: 16, max, shape: 'cluster', still: true }))); }, { note: 'the same stack around a circle (the rail\'s group avatar): the first at the top, each next one clockwise and on top, a third of an orb\'s overlap; in four places (the rail\'s), five and six are three orbs and "+N"; in six, five and six overlap more to stay two orbs wide' }),
    'cluster: one left, and none': stage(['single'], ({ root }) => { line(root, stackOf({ members: TEAM_SIX.slice(0, 1), size: 16, shape: 'cluster', extra: 2, still: true }), stackOf({ members: [], size: 16, shape: 'cluster', extra: 3, label: 'gone, left and away', still: true })); }, { note: 'members that are no longer bots of the user count in "+N"; a group with none left is "+N" alone, never nothing' }),
    'cluster: larger and on the dock': stage(['size', 'variant'], ({ root }) => { line(root, ...[3, 4].map((n) => stackOf({ members: TEAM_SIX.slice(0, n), size: 32, shape: 'cluster', still: true }))); }, { ground: 'dock' })
  })
];
