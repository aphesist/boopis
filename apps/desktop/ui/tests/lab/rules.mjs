/* The lab's checks, what each one enforces and where the design system says so. `rule` is the main rule ID in
   design/v6/design-system/RULES.md; `rules` lists every rule a check also covers (ALSO, below). To add a check for a rule: add a row here, implement it in probe.js (in-page) or
   check.mjs (needs the browser), and name the row's `rule`. */
export const CHECKS = {
  'errors':            { title: 'Draws without errors', ds: 'STANDARDS 10', rule: null, severity: 'fail', how: 'the state draws, with no console error or page error' },
  'geometry.contain':  { title: 'Children stay inside their container', ds: '8.2, 14.10', rule: 'R-corner-4', severity: 'fail', how: 'a shaped child (and its rounded corners, hover fill and focus ring) inside its shaped container\'s rounded rect or squircle path' },
  'geometry.center':   { title: 'Row items are vertically centred', ds: '7, 14.4', rule: 'R-type-11', severity: 'fail', how: 'items of a flex row up to 64px tall centred within 1px' },
  'geometry.clip':     { title: 'Text is not clipped', ds: '14.4 (long names)', rule: 'R-overflow-1', severity: 'fail', how: 'text cut without an ellipsis' },
  'geometry.hscroll':  { title: 'No horizontal scroll', ds: '7', rule: 'R-overflow-4', severity: 'fail', how: 'the window or a scroller (not code) scrolls sideways' },
  'geometry.overlap':  { title: 'Text is not painted over other text', ds: '7, 14.4', rule: null, severity: 'fail', how: 'two visible text runs in different subtrees whose boxes meet, with nothing opaque above the lower one and neither clipped away; tooltips, menus, popovers, toasts and the declared overlay are left out' },
  'geometry.target':   { title: 'Hit targets are 24px or spaced', ds: '15 (A8), WCAG 2.5.8', rule: 'R-a11y-2', severity: 'fail', how: 'targets under 24 x 24 whose 24px circle meets another target' },
  'concentric':        { title: 'Corners are concentric', ds: '8, 8.1, 8.2, 14.10', rule: 'R-corner-3', severity: 'fail', how: 'a shape in a container\'s corner: equal insets, radius = outer - inset (floor 8) or a pill, in rest, hover, focus and pressed' },
  'overlay':           { title: 'Overlays are placed as the system says', ds: '14.18, 14.19, 14.23', rule: 'R-float-1', severity: 'fail', how: 'outside the anchor, 8px gap on every side, inside the window, aligned, flipped near the bottom, never over the anchor\'s text field' },
  'tokens.computed':   { title: 'Colours, type sizes and radii are tokens', ds: '3, 4, 6, 8', rule: 'R-colour-1', severity: 'fail', how: 'computed colour, background, border, outline, fill, shadow colour, font size and radius against the active preset\'s tokens' },
  'tokens.spacing':    { title: 'Spacing is on the scale', ds: '7', rule: 'R-space-1', severity: 'fail', how: 'computed padding and gap against --sp-*, --pad-*, --gutter, --composer-* and the values of R-space-2\'s named exceptions' },
  'tokens.static':     { title: 'No hard-coded values in the source', ds: '3 ("tokens, never literals")', rule: 'R-colour-1', severity: 'fail', how: 'literal colours, font sizes and radii in CSS and TS outside the token files' },
  'inline-baseline':   { title: 'Inline chips sit on the text\'s line', ds: '7, 14.4', rule: null, severity: 'fail', how: 'a chip in running text (mention, "you", model mention, feedforward mark, inline code, path, blank, attachment): its text baseline on the line\'s within 0.5 device px, its box centred on the line\'s cap band within 1 device px, no taller line, even room left/right and above the cap height/below the baseline within 0.5 device px (zero-width 1cap probes, no pixel reading)' },
  'native':            { title: 'No unthemed native controls', ds: '14.25, 14.21', rule: 'R-native-1', severity: 'fail', how: 'select, date, colour, range, file and number inputs, engine-drawn checkboxes and radios, progress, meter' },
  'scrollbar':         { title: 'Scrollers use the system\'s scrollbar', ds: '4.1 (--bg-4 is the thumb), components.css', rule: 'R-scroll-1', severity: 'fail', how: 'a ::-webkit-scrollbar rule no wider than 8px and a --bg-4 thumb on every scroller (WebKitGTK ignores scrollbar-width), and a fade on every edge it is scrolled off' },
  'brand':             { title: 'The app never names its engine', ds: 'owner rule (19 November 2026), ADR-0031', rule: 'R-copy-8', severity: 'fail', how: 'rendered text, aria-label, aria-description, title, placeholder and tooltips name the engine (any case), outside a plugin store item (BRAND_ALLOW)' },
  'copy':              { title: 'No engine values in the interface', ds: '2', rule: 'R-copy-9', severity: 'fail', how: 'rendered text with undefined, NaN, [object Object], a stack trace, an hx.* code or JSON (code and output wells excluded)' },
  'roles':             { title: 'Colour roles', ds: '4.3, 9.1', rule: 'R-colour-3', severity: 'fail', how: 'no text in --brass; no --bg-0 on --bg-0 and no --bg-3 on --bg-3' },
  'axe':               { title: 'Accessibility (axe)', ds: '15', rule: 'R-a11y-1', severity: 'fail', how: 'axe-core, every rule but page landmarks' },
  'stability.render':  { title: 'Renders the same twice', ds: 'STANDARDS 6', rule: null, severity: 'fail', how: 'the DOM structure of two renders of the same state' },
  'stability.interact':{ title: 'No flicker, replacement or jump', ds: '11, STANDARDS 6', rule: 'R-motion-5', severity: 'fail', how: 'frames sampled during an interaction: nothing replaced, nothing invisible and back, no box that jumps away and back' },
  'visual':            { title: 'Matches its golden screenshot', ds: '—', rule: null, severity: 'fail', how: 'pixel difference against tests/lab-golden at 1440, per preset' },
  /* v7 (docs/design/v7/LAB-v7.md section 4, DESIGN-SYSTEM.md v7 rule IDs): probe-v7.js, static-v7.mjs, orbs.mjs. Blocking; a v6 story that
     fails one is listed in v7-allowlist.json, which kit-v7 empties (gate.mjs) */
  'geometry.wrap':     { title: 'Single-line controls stay on one line', ds: 'v7 21.1, LAB-v7 4', rule: 'R-row-1', v7: true, severity: 'fail', how: 'a Segmented item, Chip, Button, Badge, Kbd, SelectorItem, title pill, InlineChip, StatusWord, Tooltip, MenuRow or countdown on more than one line, or its text wider than its box with no ellipsis' },
  'geometry.row':      { title: 'Rows are single-line', ds: 'v7 21.1, LAB-v7 4', rule: 'R-row-1', v7: true, severity: 'fail', how: 'in a MenuRow, ListRow, OptionRow, Row, queue or file row: a text run on two lines, cut without an ellipsis, or past the row\'s padding edge' },
  'geometry.escape':   { title: 'Nothing escapes its cell (geometry.contain, extended)', ds: 'v7 8.2, LAB-v7 4', rule: 'R-overflow-1', v7: true, severity: 'fail', how: 'the visible part of an element, after its clipping ancestors, outside its story cell or the window' },
  'geometry.padding':  { title: 'Padding is symmetric', ds: 'v7 7, LAB-v7 4', rule: 'R-space-3', v7: true, severity: 'fail', how: 'Card, Block, ToolRow, FilesCard, AskCard, Queue, Notice, Menu, Tooltip, Chip, Button, Badge, Bubble, ListRow, OptionRow, Row: left = right and top = bottom within 0.5px' },
  'geometry.align':    { title: 'Siblings share their edge', ds: 'v7 7, LAB-v7 4', rule: 'R-space-4', v7: true, severity: 'fail', how: 'rows of a Card, steps, queue, menu, file and diff rows, sidebar rows and the thread\'s agent-side blocks share a left edge within 0.5px; a DiffView comment starts on the code column' },
  'concentric.strict': { title: 'Corner controls are concentric (tightened)', ds: 'v7 8.2, LAB-v7 4', rule: 'R-corner-10', v7: true, severity: 'fail', how: 'a control in a container\'s corner zone (after zoom): radius = outer - inset (floor 6), equal insets within 0.5px, inside the container; a pill in a pill on equal insets passes; rest (shelled controls), hover, focus, pressed' },
  'mark.rest':         { title: 'Marks rest only where section 17 allows', ds: 'v7 17, LAB-v7 4', rule: null, v7: true, severity: 'fail', how: 'a dashed underline at rest outside feedforward, an AskCard or a blank; an info label\'s mark at rest' },
  'sweep':             { title: 'Stills show live things at rest', ds: 'v7 9.2 (P4), LAB-v7 4', rule: null, v7: true, severity: 'fail', how: 'in a reduced-motion still: a gradient clipped to text (a shimmer frozen mid-sweep), or a looping animation (a breath frozen mid-cycle); [data-motion] is exempt' },
  'same-component':    { title: 'One geometry per component', ds: 'v7 21, 21.4, LAB-v7 4', rule: null, v7: true, severity: 'fail', how: 'the dock (one component: data-dk geometry, width = content + 2 x padding), the composer, the title pill and the AskCard have one geometry across every render' },
  'contrast.accent':   { title: 'Derived accent tokens hold 4.5:1', ds: 'v7 18, LAB-v7 4', rule: 'R-a11y-1', v7: true, severity: 'fail', how: '--accent-text and --focus on --bg-1 and --bg-3, --on-accent on --accent, at 4.5:1 for every accent of the matrix; the theme defines them' },
  'kit.single':        { title: 'One kit, no retired names', ds: 'v7 21, LAB-v7 4', rule: null, v7: true, severity: 'fail', how: 'a name section 21 merged away used in the source; a kit component with no story file under src/lab/stories/kit/' },
  'tokens.loose':      { title: 'No loose spacing in the source', ds: 'v7 3, 7', rule: 'R-space-1', v7: true, severity: 'fail', how: 'a literal padding, margin, gap or inset (px, rem) in the UI\'s CSS outside the token files' },
  'orb.rest':          { title: 'A bot at rest is exactly still', ds: 'v7 10, 21.4; ORBS.md G5', rule: null, v7: true, severity: 'fail', how: 'an orb at rest (the dock, the Bots sidebar, the rail; not hovered, unchanged 1.5 s) changes 0 canvas pixels between frames' },
  'orb.edges':         { title: 'Orb edges do not flicker', ds: 'ORBS.md G6, G7', rule: null, v7: true, severity: 'fail', how: 'on every orb story, canvas pixels read frame by frame on a paused clock: no shimmer (A-B-A edge pixels while the shape holds), no lone flips, no canvas that jumps or refits' }
};
/** every rule a check covers, beyond its main one */
export const ALSO = {
  'geometry.contain': ['R-corner-4', 'R-corner-8'], concentric: ['R-corner-3', 'R-corner-5', 'R-corner-9', 'R-kbd-2'], overlay: ['R-float-1', 'R-float-3', 'R-elev-6', 'R-copy-7', 'R-tip-2', 'R-tip-4'],
  'tokens.computed': ['R-colour-1', 'R-type-1', 'R-type-2', 'R-type-4', 'R-corner-1', 'R-copy-1'], copy: ['R-copy-9', 'R-copy-6'], roles: ['R-colour-3', 'R-colour-4'], scrollbar: ['R-scroll-1', 'R-scroll-2', 'R-scroll-3', 'R-scroll-6', 'R-scroll-8', 'R-scroll-9'], 'geometry.hscroll': ['R-overflow-4', 'R-scroll-7', 'R-a11y-6'],
  native: ['R-native-1', 'R-native-3', 'R-field-4', 'R-select-1'], 'geometry.target': ['R-a11y-2'], brand: ['R-copy-8'], axe: ['R-a11y-1', 'R-a11y-3', 'R-a11y-8'], 'geometry.center': ['R-type-11'], 'tokens.spacing': ['R-space-1', 'R-space-2'], 'geometry.clip': ['R-overflow-1'], 'stability.interact': ['R-motion-5', 'R-motion-8']
};
for (const [k, v] of Object.entries(ALSO)) CHECKS[k].rules = v;
export const checkIds = Object.keys(CHECKS);

/** the fix agents' areas and the words that select them */
export const AREAS = ['components', 'composer', 'shell', 'settings', 'bots', 'cards', 'dock', 'store'];
export const AREA_TITLES = { components: 'Components (the HX.ui primitives)', composer: 'Conversation and composer', shell: 'Shell (sidebar, palette, menus, toasts)', settings: 'Settings and first run', bots: 'Bots', cards: 'Cards, forms and mods', dock: 'Dock', store: 'Store', static: 'Source (static scan)' };
const ALIAS = { conversation: 'composer', session: 'composer', sidebar: 'shell', palette: 'shell', menus: 'shell', toasts: 'shell', 'first-run': 'settings', firstrun: 'settings', forms: 'cards', mods: 'cards', primitives: 'components', ui: 'components' };
export const areaOf = (word) => ALIAS[word] ?? word;

/** which area owns a source file (the static scan) */
export function areaOfPath(p) {
  if (/modules\/session|components\/composer/.test(p)) return 'composer';
  if (/modules\/shell|components\/(toast|tooltip|layer)/.test(p)) return 'shell';
  if (/modules\/bots/.test(p)) return 'bots';
  if (/modules\/(cards|mods)|components\/mod-/.test(p)) return 'cards';
  if (/modules\/dock/.test(p)) return 'dock';
  if (/modules\/store|host\/live\/store|host\/store-bridge/.test(p)) return 'store';
  if (/host\/|styles\/theme-panel/.test(p)) return 'settings';
  return 'components';
}

/** where the engine's name may show: a plugin store item, under its own name or publisher (core/engine-words.ts). Add the selector of the
    component that draws one, with the reason, when it exists. */
export const BRAND_ALLOW = [
  '[data-store-item]',        // a plugin store item (its name or publisher), as core/engine-words.ts marks it
  '[data-publisher]'          // a publisher's name as the store gives it
];

/** Allowances that hold in every state, for an element whose case the rule itself leaves out. check.mjs's skip() honours each one for any
    state of any story: `el` is matched against the finding's element description, as a story's `{ el, reason }` allowance is. */
export const STANDING_ALLOW = [
  { check: 'geometry.target', el: 'ui-pages__dot', reason: 'the dock\'s page dots: R-a11y-2 names them, each has a 24 px tall hit area around its mark, and a 24 px wide one would cover its neighbour at the 10 px pitch of the nub (14.12)' }
];

/** RULES.md's rules, and which of them a lab check verifies (the report's rule coverage) */
export function ruleCoverage(rulesMd) {
  const rows = [...rulesMd.matchAll(/^\|\s*\[(R-[a-z0-9]+-\d+)\]\([^)]*\)\s*\|(.*?)\|(.*?)\|\s*(machine|by eye|both)\s*\|/gm)].map((m) => ({ id: m[1], rule: m[2].trim(), status: m[3].trim(), how: m[4] }));
  const by = {};
  for (const [check, c] of Object.entries(CHECKS)) for (const r of [c.rule, ...(c.rules ?? [])].filter(Boolean)) (by[r] ??= new Set()).add(check);
  const covered = rows.filter((r) => by[r.id]).map((r) => ({ ...r, checks: [...by[r.id]] }));
  const open = rows.filter((r) => !by[r.id]);
  return { total: rows.length, machine: rows.filter((r) => r.how !== 'by eye').length, covered, uncovered: open, unknown: Object.keys(by).filter((id) => !rows.some((r) => r.id === id)) };
}
