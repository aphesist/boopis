/* The v7 lab's definitions (docs/design/v7/LAB-v7.md on w31/design-system-v7, DESIGN-SYSTEM.md section 21): the kit's 42
   components, the names section 21 merged away, which elements each v7 check looks at, and the matrix values the kit adds.
   One table, read by the in-page checks (probe-v7.js, through check.mjs), the static checks (static-v7.mjs), the orb checks
   (orbs.mjs) and the gate (gate.mjs).

   ROLES is the lab's story interface for the v7 checks. A check never names a class: it names a component, and ROLES says
   which elements are that component. Every component matches `[data-kit~="<Name>"]`, the attribute the v7 kit puts on each
   component's root (a part, such as a Segmented item, is `[data-kit-part~="<Name>"]`). Until the kit is built the list also
   carries today's v6 class for the same job, so the checks run now on the v6 stories; kit-v7 deletes each v6 selector with the
   component it retires. */

/** section 21.2, in its order: the one kit. A story file per component in its folder, src/components/v7/<kebab>/ (kit.single) */
export const KIT_V7 = [
  'WindowChrome', 'Page', 'Pane', 'Dialog', 'Menu', 'Card', 'Block', 'ToolRow', 'AskCard', 'FilesCard', 'Queue', 'Notice',
  'SystemLine', 'Bubble', 'DiffView', 'Well', 'ListRow', 'SectionHead', 'MenuRow', 'OptionRow', 'Button', 'IconButton',
  'Segmented', 'SelectorItem', 'Switch', 'Field', 'Kbd', 'Chip', 'Tooltip', 'InlineChip', 'Mark', 'StatusWord', 'Badge',
  'StatusLine', 'Avatar', 'Disclosure', 'TurnFoot', 'TimeSeparator', 'Composer', 'Rail', 'Dock', 'Notch'
];
/** counted in Page (21.2's last row), with its own story */
export const KIT_V7_EXTRA = ['EmptyState'];
/** a component's folder and the name of its files: src/components/v7/<kebab>/<kebab>.stories.ts */
export const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** names section 21 merged into another component (LAB-v7 section 4, kit.single): any use in the UI's source fails */
export const RETIRED = {
  QueueStrip: 'Queue', LimitNotice: 'Notice', Toast: 'Notice', Banner: 'Notice', ScopePicker: 'Segmented', SettingsLine: 'SystemLine',
  SteerLine: 'SystemLine', CheckpointBar: 'TurnFoot', ChoiceCards: 'AskCard', LaunchCard: 'the setup pattern', ReferenceChip: 'InlineChip'
};
/** a retired name as it is spelled in source: QueueStrip, queueStrip, queue-strip, queue_strip, QUEUE_STRIP (word-bounded) */
export function retiredPattern(name) {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');
  return new RegExp('(?<![A-Za-z0-9])' + parts.map((p) => '[' + p[0].toLowerCase() + p[0].toUpperCase() + ']' + p.slice(1).toLowerCase().split('').map((c) => '[' + c + c.toUpperCase() + ']').join('')).join('[-_]?') + '(?![a-z])', 'g');
}

const kit = (n) => `[data-kit~="${n}"]`;
const part = (n) => `[data-kit-part~="${n}"]`;
/** component -> the elements that are it. v6 selectors after the kit's own; each v6 selector goes when kit-v7 retires its class */
export const ROLES = {
  WindowChrome: [kit('WindowChrome'), '.hx-bar'],
  Page: [kit('Page')],
  Pane: [kit('Pane'), '.hx-right'],
  Dialog: [kit('Dialog'), '[role="dialog"]'],
  Menu: [kit('Menu'), '.ui-menu', '.ui-listbox'],
  Card: [kit('Card'), '.ui-set'],
  Block: [kit('Block')],
  ToolRow: [kit('ToolRow'), '.ui-step'],
  AskCard: [kit('AskCard'), '.ui-request'],
  FilesCard: [kit('FilesCard')],
  Queue: [kit('Queue')],
  Notice: [kit('Notice'), '.ui-toast'],
  SystemLine: [kit('SystemLine')],
  Bubble: [kit('Bubble'), '.ui-entry__body'],
  /* the agent side of a thread (what shares the 30 px gutter's edge): your bubbles sit at the other edge */
  AgentBubble: [kit('Bubble') + ':not([data-kind="user"])', '.ui-entry__body'],
  DiffView: [kit('DiffView')],
  Well: [kit('Well'), '.ui-codeblock'],
  ListRow: [kit('ListRow'), '.ui-row'],
  SectionHead: [kit('SectionHead'), '.ui-group__head', '.ui-sec__head'],
  MenuRow: [kit('MenuRow'), '.ui-menu__item'],
  OptionRow: [kit('OptionRow'), '.ui-option'],
  Row: [part('Row'), '.ui-set__row'],
  Button: [kit('Button'), '.ui-btn'],
  IconButton: [kit('IconButton'), '.ui-ib'],
  Segmented: [kit('Segmented'), '.ui-seg'],
  SegmentedItem: [part('SegmentedItem'), '.ui-seg__opt'],
  SegmentedThumb: [part('SegmentedThumb'), '.ui-seg__thumb'],
  SelectorItem: [kit('SelectorItem'), '.ui-select'],
  Switch: [kit('Switch'), '.ui-switch'],
  Field: [kit('Field'), '.ui-input'],
  Kbd: [kit('Kbd'), '.ui-kbd'],
  Chip: [kit('Chip'), '.ui-chip'],
  Tooltip: [kit('Tooltip'), '.ui-tip'],
  TitlePill: [part('TitlePill')],
  InlineChip: [kit('InlineChip'), '.ui-mention', '.ui-path', '.ui-md .ui-code', '.ui-md .ui-file'],
  Countdown: [part('Countdown')],
  Mark: [kit('Mark')],
  StatusWord: [kit('StatusWord'), '.ui-stamp'],
  Badge: [kit('Badge'), '.ui-badge'],
  StatusLine: [kit('StatusLine')],
  Avatar: [kit('Avatar'), '.ui-orb'],
  Disclosure: [kit('Disclosure'), '.ui-disclosure'],
  TurnFoot: [kit('TurnFoot')],
  Composer: [kit('Composer')],
  Rail: [kit('Rail'), '.hx-rail'],
  Dock: [kit('Dock')],   /* `#hx-dock` is the app's slot for it since the dock is the kit's (boards K01 to K08): not a dock of its own */
  QueueRow: [part('QueueRow')],
  FileRow: [part('FileRow')],
  DiffRow: [part('DiffRow')],
  DiffComment: [part('DiffComment')],
  DiffCode: [part('DiffCode')],
  Steps: [part('Steps'), '.ui-steps'],
  Sidebar: [part('Sidebar'), '.hx-list'],
  Thread: [part('Thread')],
  /* where a mark may show at rest (section 17): feedforward (the composer's text, a reply's guess), an AskCard, a blank */
  MarkContext: ['[data-mark-context]', kit('Composer'), kit('AskCard'), '.ui-request'],
  /* a mark that shows only on hover or focus (an info label) */
  InfoMark: ['[data-kit~="Mark"][data-mark-kind="info"]'],
  /* live things a still must show at rest (section 9.2, P4): a status phrase's shimmer, a breath; [data-motion] strips are exempt */
  Live: ['[data-live]', '.ui-dot--run', '.ui-presence__shimmer'],
  /* the shells a corner control is never concentric with: they are the window's own regions */
  Region: [kit('Page'), kit('Pane'), kit('Dialog'), '.hx-ground', '.hx-side', '.hx-right', '.lab-stage', '.lab-cell', '#hx-app', '[role="dialog"]']
};
export const sel = (...names) => names.flatMap((n) => ROLES[n] ?? []).join(', ');

/** what each ported check looks at (LAB-v7 section 4), by component */
export const V7_TARGETS = {
  /* geometry.wrap: single-line controls render on one line; their text is not wider than their box unless it ends in an ellipsis */
  wrap: sel('SegmentedItem', 'Chip', 'Button', 'Badge', 'Kbd', 'SelectorItem', 'TitlePill', 'InlineChip', 'StatusWord', 'Tooltip', 'MenuRow', 'Countdown'),
  /* geometry.row: every text run in a row on one line, nothing past the row's padding edge */
  row: sel('MenuRow', 'ListRow', 'OptionRow', 'Row', 'QueueRow', 'FileRow'),
  /* geometry.padding: left = right and top = bottom */
  padding: sel('Card', 'Block', 'ToolRow', 'FilesCard', 'AskCard', 'Queue', 'Notice', 'Menu', 'Tooltip', 'Chip', 'Button', 'Badge', 'Bubble', 'ListRow', 'OptionRow', 'Row'),
  /* geometry.align: [container, its children that share a left edge] */
  align: [
    [sel('Card'), sel('Row')], [sel('Steps'), sel('ToolRow')], [sel('Queue'), sel('QueueRow')], [sel('Menu'), sel('MenuRow')],
    [sel('FilesCard'), sel('FileRow')], [sel('DiffView'), sel('DiffRow')], [sel('Sidebar'), sel('ListRow')],
    [sel('Thread'), sel('AgentBubble', 'Disclosure', 'ToolRow', 'FilesCard', 'TurnFoot', 'AskCard', 'StatusLine')]
  ],
  /* concentric (tightened): the controls set into a container's corner */
  corner: sel('Button', 'IconButton', 'Chip', 'SegmentedThumb', 'MenuRow', 'Kbd', 'SelectorItem', 'Badge', 'Switch', 'Field'),
  region: sel('Region'),
  /* inline-baseline: InlineChip and Badge in running text (probe.js's own list, plus these) */
  inline: sel('InlineChip', 'Badge', 'Countdown', 'Mark'),
  mark: sel('Mark'),
  menu: sel('Menu'),
  diffView: sel('DiffView'), diffCode: sel('DiffCode'), diffComment: sel('DiffComment'),
  markContext: sel('MarkContext'),
  infoMark: sel('InfoMark'),
  live: sel('Live'),
  /* same-component: one geometry per component and state class across every render */
  same: { dock: sel('Dock'), composer: sel('Composer'), titlePill: sel('TitlePill'), askCard: sel('AskCard') },
  /* the dock's slab may reach past the cell (its flares): the escape check leaves it to same-component */
  escapeOk: sel('Dock') + ', .ui-dot--flag, .ui-orb .ui-dot, .ui-concave, .ui-slab'
};

/** the accents the contrast check walks (LAB-v7 section 3): Iris now; kit-v7 adds the light and the dark accent the owner names */
export const ACCENTS = [{ id: 'iris', hex: '#5b5bd6' }];
/** derived accent tokens and the surfaces each must hold 4.5:1 on (DESIGN-SYSTEM.md section 18) */
export const ACCENT_PAIRS = [['--accent-text', '--bg-1'], ['--accent-text', '--bg-3'], ['--focus', '--bg-1'], ['--focus', '--bg-3'], ['--on-accent', '--accent']];

/** the surfaces where a bot is at rest (21.4, ORBS.md section 23): the dock's row, the Bots sidebar, the rail. A rest orb changes 0
    pixels. The head of a bot's card in the open dock is not one: board K04 (dock/K04-bot-card, dockv7.js `card`) draws that orb as a
    chat's bot, alive, like the header of the bot's own chat */
export const ORB_REST_SURFACES = '[data-kit-part~="DockRow"], ' + sel('Rail', 'Sidebar') + ', #hx-list-bots, [data-orb-rest]';
/** reactions that are rest: orb3's home pose; v6 has none, so its idle bot on a rest surface is held to rest too */
export const ORB_REST_REACTIONS = ['pose', 'k06', 'idle'];
