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
  'overlay':           { title: 'Overlays are placed as the system says', ds: '14.18, 14.19, 14.23', rule: 'R-float-1', severity: 'fail', how: 'outside the anchor, 8px gap (10 to the right), inside the window, aligned, flipped near the bottom, never over the anchor\'s text field' },
  'tokens.computed':   { title: 'Colours, type sizes and radii are tokens', ds: '3, 4, 6, 8', rule: 'R-colour-1', severity: 'fail', how: 'computed colour, background, border, outline, fill, shadow colour, font size and radius against the active preset\'s tokens' },
  'tokens.spacing':    { title: 'Spacing is on the scale', ds: '7', rule: 'R-space-1', severity: 'fail', how: 'computed padding and gap against --sp-*, --pad-*, --gutter, --composer-* and the values of R-space-2\'s named exceptions' },
  'tokens.static':     { title: 'No hard-coded values in the source', ds: '3 ("tokens, never literals")', rule: 'R-colour-1', severity: 'fail', how: 'literal colours, font sizes and radii in CSS and TS outside the token files' },
  'native':            { title: 'No unthemed native controls', ds: '14.25, 14.21', rule: 'R-native-1', severity: 'fail', how: 'select, date, colour, range, file and number inputs, engine-drawn checkboxes and radios, progress, meter' },
  'scrollbar':         { title: 'Scrollers use the system\'s scrollbar', ds: '4.1 (--bg-4 is the thumb), components.css', rule: 'R-scroll-1', severity: 'fail', how: 'a ::-webkit-scrollbar rule no wider than 8px and a --bg-4 thumb on every scroller (WebKitGTK ignores scrollbar-width)' },
  'brand':             { title: 'The app never names its engine', ds: 'owner rule (19 November 2026), ADR-0031', rule: 'R-copy-8', severity: 'fail', how: 'rendered text, aria-label, aria-description, title, placeholder and tooltips name the engine (any case), outside a plugin store item (BRAND_ALLOW)' },
  'copy':              { title: 'No engine values in the interface', ds: '2', rule: 'R-copy-9', severity: 'fail', how: 'rendered text with undefined, NaN, [object Object], a stack trace, an hx.* code or JSON (code and output wells excluded)' },
  'roles':             { title: 'Colour roles', ds: '4.3, 9.1', rule: 'R-colour-3', severity: 'fail', how: 'no text in --brass; no --bg-0 on --bg-0 and no --bg-3 on --bg-3' },
  'axe':               { title: 'Accessibility (axe)', ds: '15', rule: 'R-a11y-1', severity: 'fail', how: 'axe-core, every rule but page landmarks' },
  'stability.render':  { title: 'Renders the same twice', ds: 'STANDARDS 6', rule: null, severity: 'fail', how: 'the DOM structure of two renders of the same state' },
  'stability.interact':{ title: 'No flicker, replacement or jump', ds: '11, STANDARDS 6', rule: 'R-motion-5', severity: 'fail', how: 'frames sampled during an interaction: nothing replaced, nothing invisible and back, no box that jumps away and back' },
  'visual':            { title: 'Matches its golden screenshot', ds: '—', rule: null, severity: 'fail', how: 'pixel difference against tests/lab-golden at 1440, per preset' }
};
/** every rule a check covers, beyond its main one */
export const ALSO = {
  'geometry.contain': ['R-corner-4', 'R-corner-8'], concentric: ['R-corner-3', 'R-corner-5', 'R-corner-9', 'R-kbd-2'], overlay: ['R-float-1', 'R-float-3', 'R-elev-6', 'R-copy-7', 'R-tip-2', 'R-tip-4'],
  'tokens.computed': ['R-colour-1', 'R-type-1', 'R-type-2', 'R-type-4', 'R-corner-1', 'R-copy-1'], copy: ['R-copy-9', 'R-copy-6'], roles: ['R-colour-3', 'R-colour-4'], scrollbar: ['R-scroll-1', 'R-scroll-2', 'R-scroll-3', 'R-scroll-6', 'R-scroll-8'], 'geometry.hscroll': ['R-overflow-4', 'R-scroll-7', 'R-a11y-6'],
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
