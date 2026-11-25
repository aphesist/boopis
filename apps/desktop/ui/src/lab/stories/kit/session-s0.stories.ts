/* The Session tab's wave S0 on the kit (ADR-0057, ADR-0058; SESSION-TAB.md 1, 2, 6, 12; boards S41 A, S01 B, S02 B, S08, S10):
   the new session's canvas with its launch row, the "How careful" menu of four rows (with steps that cannot be honoured), the
   lines the thread says about itself, the rewind on a finished turn and its dry-run sheet. Compositions of kit components
   (modules/session/s0.ts), drawn from fixtures: every value here is a story's, never the app's. */
import { kit } from '@boopis/ui';
import { fill, forced, frames, stage } from '../../story';
import type { Story } from '../../types';
import { carefulEntries, launchCanvas, lineEl, rewindBody, rewindFoot, rewindSheet } from '../../../modules/session/s0';
import type { LaunchView } from '../../../modules/session/s0';
import type { Avail, CarefulStep, RewindResult, ThreadLine } from '../../../data/session-s0';

const OK: Avail = { ok: true };
const ALL: Record<CarefulStep, Avail> = { supervised: OK, auto_edits: OK, auto: OK, full: OK };
const NO_GATE = 'Needs a gate command in this project.';
const GATELESS: Record<CarefulStep, Avail> = { supervised: OK, auto_edits: { ok: false, why: NO_GATE }, auto: { ok: false, why: NO_GATE }, full: OK };
const noop = (): void => undefined;
const ACT = { folder: noop, model: noop, effort: noop, careful: noop };
const VIEW: LaunchView = { folder: 'boopis', model: 'Claude Sonnet 4.5', effort: 'Default', careful: 'auto_edits', fellBack: false, waiting: [] };
const canvas = (v: Partial<LaunchView>): HTMLElement => launchCanvas({ ...VIEW, ...v }, ACT);
const menu = (avail: Record<CarefulStep, Avail>, current: CarefulStep): HTMLElement => kit.menu({ label: 'How careful', variant: 'options', entries: carefulEntries({ current, avail }) });

const launchTypical = stage(['typical', 'variant'], ({ root }) => { fill(root, canvas({})); }, { width: 760 });
const PLAN: RewindResult = { status: 'planned', isolation: 'shared_unchanged', files: [{ path: 'src/billing/invoice.ts', action: 'restore' }, { path: 'src/billing/legacy.bin', action: 'recreate' }, { path: 'src/billing/cents.ts', action: 'delete' }] };
const REFUSED: RewindResult = { status: 'refused', isolation: 'refused', why: 'Rewinding files needs this session\'s own worktree, or no other changes in this folder. Changed since this session\'s last change: notes.md.', files: [] };
const sheet = (r: RewindResult, title: string): HTMLElement => {
  const s = rewindSheet(r, title, { onConfirm: noop });
  /* drawn in its cell, not over the page: the sheet without its scrim */
  return (s.el.querySelector('[data-kit="Dialog"]') ?? s.el) as HTMLElement;
};
const LINES: ThreadLine[] = [
  { kind: 'settings', id: 'l1', afterTurn: 't1', text: 'Permissions changed to Auto', cost: null },
  { kind: 'settings', id: 'l2', afterTurn: 't1', text: 'Settings changed: continued with Full access', cost: 'The next reply reads about 18,000 tokens without the cache (cost unknown)' },
  { kind: 'checkpoint', id: 'l3', afterTurn: 't2', at: '14:02', action: 'rewound', to: { shipId: 's1', label: 'after turn 3' }, files: 4, rewindShipId: 'r1', undoShipId: 's3' },
  { kind: 'checkpoint', id: 'l4', afterTurn: 't2', at: '14:03', action: 'undone', to: { shipId: 's3', label: 'after turn 4' }, files: 4, rewindShipId: 'r2', undoShipId: null }
];
const footTypical = stage(['typical', 'variant'], ({ root }) => { fill(root, rewindFoot({ first: false, avail: OK, onRewind: noop }), rewindFoot({ first: true, avail: OK, onRewind: noop })); }, { width: 640 });

export default [
  {
    id: 'kit/session-launch', title: 'Session: the launch row', area: 'composer', kind: 'component', covers: ['pattern:session-launch'],
    states: {
      typical: launchTypical,
      ...forced(launchTypical, '.ss-s0-launch [data-step]'),
      'how careful, open': stage(['variant'], async ({ root }) => {
        const c = canvas({});
        fill(root, c);
        await frames(2);
        const anchor = c.querySelector<HTMLElement>('[data-step]');
        if (anchor) kit.openMenu(anchor, { label: 'How careful', variant: 'options', entries: carefulEntries({ current: 'auto_edits', avail: ALL }), place: 'below', align: 'center' });
      }, { width: 760, overlay: { anchor: '.ss-s0-launch [data-step]', layer: '.k7-menu[data-floating]' } }),
      'the four rows': stage(['variant'], ({ root }) => { fill(root, menu(ALL, 'auto_edits')); }, { width: 420 }),
      'no trusted gate': stage(['variant', 'error'], ({ root }) => { fill(root, canvas({ careful: 'supervised', fellBack: true }), menu(GATELESS, 'supervised')); }, { width: 760 }),
      'no model': stage(['variant', 'empty'], ({ root }) => { fill(root, canvas({ model: null })); }, { width: 760 }),
      'no folder': stage(['empty'], ({ root }) => { fill(root, canvas({ folder: null })); }, { width: 760 }),
      'waiting on you': stage(['variant'], ({ root }) => { fill(root, canvas({ waiting: [{ title: 'Fix the dock\'s half paint', sub: 'Approval' }, { title: 'Store: de-duplicate items', sub: 'Question' }] })); }, { width: 760 }),
      'full access': stage(['variant'], ({ root }) => { fill(root, canvas({ careful: 'full', effort: 'High' })); }, { width: 760 }),
      long: stage(['long'], ({ root }) => { fill(root, canvas({ folder: 'a-project-folder-with-a-very-long-name-indeed', model: 'Claude Sonnet 4.5 (extended context preview)' })); }, { width: 420 })
    }
  },
  {
    id: 'kit/session-rewind', title: 'Session: rewind', area: 'composer', kind: 'component', covers: ['pattern:session-rewind'],
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { fill(root, sheet(PLAN, 'Rewind files to after turn 3')); }, { width: 640 }),
      refused: stage(['error'], ({ root }) => { fill(root, sheet(REFUSED, 'Rewind files to after turn 3')); }, { width: 640 }),
      'nothing to do': stage(['empty'], ({ root }) => { fill(root, sheet({ status: 'nothing_to_do', isolation: 'shared_unchanged', files: [] }, 'Rewind to before this session')); }, { width: 640 }),
      'on a finished turn': footTypical,
      ...forced(footTypical, '.k7-foot__btn'),
      'not now': stage(['variant'], ({ root }) => { fill(root, rewindFoot({ first: false, avail: { ok: false, why: 'Rewind when this turn has finished.' }, onRewind: noop })); }, { width: 640 }),
      long: stage(['long'], ({ root }) => {
        const many: RewindResult = { ...PLAN, files: Array.from({ length: 30 }, (_, i) => ({ path: 'src/a/deeply/nested/folder/with/a/long/name/file-' + i + '.ts', action: 'restore' as const })) };
        fill(root, sheet(many, 'Rewind files to after turn 12'));
      }, { width: 640 }),
      body: stage(['variant'], ({ root }) => { root.insertAdjacentHTML('beforeend', '<div class="lab-fill">' + rewindBody(PLAN) + '</div>'); }, { width: 520 })
    }
  },
  {
    id: 'kit/session-lines', title: 'Session: the thread\'s own lines', area: 'composer', kind: 'component', covers: ['pattern:session-lines'],
    states: {
      typical: stage(['typical', 'variant'], ({ root }) => { fill(root, ...LINES.map((l) => lineEl(l, noop))); }, { width: 760 }),
      ...forced(stage(['variant'], ({ root }) => { fill(root, lineEl(LINES[2] as ThreadLine, noop)); }, { width: 760 }), '[data-line]'),
      long: stage(['long'], ({ root }) => { fill(root, lineEl({ kind: 'settings', id: 'x', afterTurn: null, text: 'Settings changed: continued with Full access and ~/code/a-project-folder-with-a-very-long-name', cost: 'The next reply reads about 64,000 tokens without the cache (cost unknown)' }, noop)); }, { width: 520 })
    }
  }
] satisfies Story[];
