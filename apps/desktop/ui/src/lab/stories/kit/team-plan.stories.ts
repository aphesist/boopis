/* TeamPlan (6e, derived from O-B06's team-plan block): what a proposed change to the team does, one row per action led by its mark
   (+ added, ~ changed, − removed); problems as error lines; notes quiet; a permanent action's quiet note. It is what an AskCard asks
   about (a bot's proposed change in its thread; the first run's O-B06 at step 8). */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, MOSS, IRIS } from './_bots';

const orb = (b: { id: string; name: string; shape: string; color: string }): string => kit.html.avatar({ bot: { ...b, state: 'idle' }, size: 16, still: true });
const ACTIONS = [
  { mark: '+', target: 'kai', what: 'reviews pull requests', leadHTML: orb(KAI) },
  { mark: '+', target: 'moss', what: 'runs the tests at night, proposes fixes', leadHTML: orb(MOSS) },
  { mark: '~', target: 'iris', what: 'release notes and the changelog, now weekly', leadHTML: orb(IRIS) },
  { mark: '-', target: 'room “old crew”', what: 'disbanded; its messages are kept' }
];
const typical = stage(['typical'], ({ root }) => { fill(root, kit.teamPlan({ actions: ACTIONS.slice(0, 3), notes: ['Room “crew”, kai leads. Routine: moss’s test sweep, weekdays at 02:00, paused.'] })); }, { width: 608 });
export default {
  id: 'kit/team-plan', title: 'TeamPlan', area: 'components', kind: 'component', covers: ['kit.teamPlan'],
  states: {
    typical,
    'a permanent action': stage(['variant'], ({ root }) => { fill(root, kit.teamPlan({ actions: ACTIONS, permanent: 'Disbanding a room cannot be undone.' })); }, { width: 608 }),
    problems: stage(['error'], ({ root }) => { fill(root, kit.teamPlan({ actions: ACTIONS.slice(0, 2), problems: ['moss needs a model, and none is signed in.', 'A room named “crew” already exists.'] })); }, { width: 608 }),
    empty: stage(['empty'], ({ root }) => { fill(root, kit.teamPlan({ actions: [] , notes: ['Nothing would change.'] })); }, { width: 608 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.teamPlan({ actions: [{ mark: '+', target: 'cassiopeia-staging-deploy-guardian', what: 'deploys to staging after the nightly sweep, and writes the release notes for every room it is in', leadHTML: orb(KAI) }], notes: ['A note long enough to wrap at the card’s width, as a plan’s notes sometimes are when the bot explains itself.'] })); }, { width: 360 })
  }
} satisfies Story;
