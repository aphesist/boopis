/* Writes docs/UI-LAB-FINDINGS.md from lab-report/summary.json: every failure grouped by area, then by check, the same
   failure in several states collapsed to one line (the states listed), each with a one-line guess at its cause.
   `node tests/lab/findings.mjs [summary.json] [out.md]` */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI_ROOT } from './serve.mjs';
import { AREA_TITLES, CHECKS } from './rules.mjs';

const src = process.argv[2] ?? join(UI_ROOT, 'lab-report', 'summary.json');
const out = process.argv[3] ?? join(UI_ROOT, '..', '..', '..', 'docs', 'UI-LAB-FINDINGS.md');
const s = JSON.parse(readFileSync(src, 'utf8'));

const strip = (t) => (t ?? '').replace(/#[\w-]+/g, '').replace(/\[[^\]]*\]/g, '');
const norm = (m) => strip(m).replace(/-?\d+(\.\d+)?(px| px)?/g, 'N').replace(/"[^"]*"/g, 'S').replace(/\s+/g, ' ');
const tail = (el) => strip(el).split(' > ').slice(-2).join(' > ');
const MAX_LINES = 14;
const PRESETS = ['catalog', 'graphite', 'bone', 'typewriter'];
function where(list) {
  const p = new Set(), w = new Set(), f = new Set();
  for (const x of list) { const [a, b, c] = x.split('/'); if (PRESETS.includes(a)) p.add(a); if (/^\d+$/.test(b ?? '')) w.add(b); if (c) f.add(c); }
  const ps = p.size === 4 ? 'every preset' : [...p].join(', ');
  return [ps, w.size ? [...w].sort((a, b) => a - b).join('/') : '', f.size ? 'when ' + [...f].join(', ') : 'at rest'].filter(Boolean).join(' · ');
}
function cause(check, msg, el) {
  const m = msg.toLowerCase();
  switch (check) {
    case 'geometry.contain':
      if (m.includes('cut by')) return 'an overflow: hidden ancestor cuts a shaped child; the child is larger or placed further out than its box allows';
      if (m.includes('ring')) return 'the focus ring is an outline outside the element where the system draws it inside the edge on a drawn corner (R-focus-3), or the piece sits closer to the edge than its ring';
      if (m.includes('rounded corner')) return 'the piece sits in the container\'s corner without the concentric inset: its square corner crosses the container\'s curve (R-corner-4)';
      return 'the piece is positioned or sized past its container: a negative margin, an absolute offset or a width that ignores the container\'s padding';
    case 'concentric':
      if (m.includes('not equal')) return 'placed with different offsets from the two edges of the corner; give the container `--pad` and inset the piece by it on both sides (R-corner-3, R-corner-4)';
      return 'its radius is not the container\'s `--r-in-*` (outer − inset, floor 8): a library radius used where the corner wants the concentric one';
    case 'overlay':
      if (m.includes('text field')) return 'the tooltip opens below its anchor over the composer\'s text; R-tip-2: a tooltip for a control in a text field\'s container opens away from the text';
      if (m.includes('sits')) return 'the layer is placed with its own gap instead of `--float-gap` (tooltip.ts and layer.ts hard-code 8 and 10)';
      if (m.includes('centred')) return 'the tooltip is clamped or offset instead of centred on its anchor';
      if (m.includes('margin')) return 'the layer is not clamped to `--float-margin` from the window edge, or does not flip';
      if (m.includes('did not open')) return 'the state\'s overlay never opened: the trigger did not open it in this layout';
      if (m.includes('named')) return 'the tooltip text is not the control\'s accessible name (R-copy-7)';
      if (m.includes('opens')) return 'the tooltip chose above or below against R-tip-2 (below, above only within 160px of the window bottom)';
      return 'the layer is placed against the system\'s placement rules (R-float-1, R-float-3)';
    case 'tokens.computed':
      if (m.includes('font-size')) return 'a literal font size in the component\'s CSS instead of `--fs-*`';
      if (m.includes('line-height')) return 'a literal line height instead of `--lh-*`';
      if (m.includes('font-family')) return 'a font stack set directly instead of `--sans` or `--mono`';
      if (m.includes('text-transform')) return 'uppercase set in CSS; interface labels follow `--ui-case` only (R-copy-1)';
      if (m.includes('radius')) return 'a radius computed outside the `--r-*` and `--r-in-*` tokens';
      if (m.includes('shadow')) return 'a shadow colour that is not one of the `--elev-*`/`--shadow-*` tokens';
      return 'a colour mixed or picked locally instead of a token of the active preset (or a token missing on this ground)';
    case 'tokens.spacing': return 'a padding or gap that is neither a `--sp-*` step, a `--pad-*` token nor one of R-space-2\'s named exceptions';
    case 'tokens.static': return 'a literal value in the source; replace it with its token';
    case 'native': return m.includes('resize') ? 'a native textarea grip; `resize: none` (R-field-4)' : 'a control the platform draws; the library\'s themed control replaces it (R-native-1)';
    case 'scrollbar':
      if (m.includes('webkitgtk ignores') && !el) return 'the source sets `scrollbar-width`; R-scroll-1 draws bars with `::-webkit-scrollbar` from the `--scroll-*` tokens and sets nothing else';
      if (m.includes('overscroll')) return 'the scroller lacks `overscroll-behavior: contain` (R-scroll-8)';
      return 'no `::-webkit-scrollbar` rules exist yet: one rule set in components.css from the `--scroll-*` tokens fixes every scroller at once';
    case 'geometry.target': return 'a target smaller than `--hit-min` with a neighbour inside its 24px circle; give it a 24px hit area (R-a11y-2)';
    case 'geometry.clip': return 'a fixed width or height with overflow hidden and no `text-overflow: ellipsis` (R-overflow-1)';
    case 'geometry.center': return 'aligned by padding, a baseline or a fixed line height instead of flex centring with line height 1 (R-type-11)';
    case 'geometry.hscroll': return 'content wider than its box at this width: a fixed width, a long unbroken string without `overflow-wrap: anywhere`, or a row that does not wrap';
    case 'axe': return 'axe: ' + msg.split(':')[0];
    case 'stability.render': return 'the state draws differently on a second render: timing (a feed still arriving) or a random choice';
    case 'stability.interact':
      if (m.includes('removed and drawn again')) return 'the interaction redraws the node (innerHTML) instead of updating it';
      if (m.includes('blinked')) return 'a node is hidden and shown again within a few frames during the morph: the flicker the owner saw';
      return 'a box jumps away and back during the interaction: a layout read or a style applied a frame late';
    case 'brand': return 'user-facing text names the engine; say it in boopis's words (ADR-0031, R-copy-8)';
    case 'copy': return 'an engine value reached the interface (R-copy-9)';
    case 'roles': return m.includes('brass') ? 'text drawn in the accent; brass is for marks (R-colour-3)' : 'a surface painted the same as the surface under it (R-colour-4)';
    case 'visual': return 'the screenshot changed from its golden';
    case 'errors': return 'the state failed to draw or logged an error';
    default: return '';
  }
}

const findings = s.findings.filter((f) => f.check !== 'visual');
const areas = Object.keys(AREA_TITLES).filter((a) => findings.some((f) => f.area === a));
let md = `# UI lab findings

The first full run of the lab (\`pnpm lab:check\`, docs/UI-LAB.md) on ${s.generated.slice(0, 10)}: ${s.states} states in ${s.stories} stories, in the presets ${s.presets.join(', ')} at ${s.widths.join(', ')} px, each at rest and with hover, focus and pressed forced. **${findings.length} failures** (the same failure in several states counts once per state). Screenshots were accepted as the first goldens in this run, so there are no visual failures yet.

Each area is one fix agent's. Run one area with \`pnpm lab:check --area <id>\` (add \`--quick\` while fixing), and one story with \`--story <id>\`. The report (\`lab-report/index.html\`) has a crop of every failure and the mock's counterpart. Lines below collapse the same failure across states: the element, the states (with their count), where it shows (presets, widths, forced state), and a one-line guess at the cause. The guesses are guesses: read the crop first.

| Area | id | Failures |
|---|---|---|
${areas.map((a) => `| ${AREA_TITLES[a]} | \`${a}\` | ${findings.filter((f) => f.area === a).length} |`).join('\n')}

| Check | Rule | Failures |
|---|---|---|
${Object.keys(CHECKS).filter((c) => findings.some((f) => f.check === c)).map((c) => `| \`${c}\` | ${CHECKS[c].rule ?? ''} | ${findings.filter((f) => f.check === c).length} |`).join('\n')}
`;
if (s.rules) md += `\nRule coverage: ${s.rules.covered.length} of ${s.rules.total} rules in RULES.md have a lab check (${s.rules.machine} are machine-checkable); the report lists both sets.\n`;

for (const a of areas) {
  const mine = findings.filter((f) => f.area === a);
  md += `\n## ${AREA_TITLES[a]} (\`--area ${a}\`): ${mine.length}\n`;
  const checks = [...new Set(mine.map((f) => f.check))].sort((x, y) => Object.keys(CHECKS).indexOf(x) - Object.keys(CHECKS).indexOf(y));
  for (const c of checks) {
    const list = mine.filter((f) => f.check === c);
    md += `\n### \`${c}\`${CHECKS[c]?.rule ? ' (' + CHECKS[c].rule + ')' : ''}: ${list.length}\n\n`;
    if (c === 'tokens.static' || (c === 'scrollbar' && list.every((f) => f.file))) {
      for (const f of list) md += `- \`${f.file}:${f.line}\` ${f.msg}. *Cause:* ${cause(c, f.msg, null)}\n`;
      continue;
    }
    const groups = new Map();
    for (const f of list) {
      const k = norm(f.msg) + '|' + tail(f.el);
      const g = groups.get(k) ?? { msg: f.msg, el: f.el, states: [], where: [] };
      g.states.push((f.story ?? f.file) + ' · ' + (f.state ?? f.line));
      g.where.push(...(f.where ?? []));
      groups.set(k, g);
    }
    const sorted = [...groups.values()].sort((x, y) => y.states.length - x.states.length);
    for (const g of sorted.slice(0, MAX_LINES)) {
      const st = [...new Set(g.states)];
      md += `- **${g.msg.replace(/\|/g, '/').slice(0, 200)}**${g.el ? ` \`${tail(g.el)}\`` : ''}. ${st.length} state${st.length > 1 ? 's' : ''}: ${st.slice(0, 4).join('; ')}${st.length > 4 ? '; and ' + (st.length - 4) + ' more' : ''}. ${where(g.where)}. *Cause:* ${cause(c, g.msg, g.el)}\n`;
    }
    if (sorted.length > MAX_LINES) md += `- and ${sorted.length - MAX_LINES} more patterns (${sorted.slice(MAX_LINES).reduce((n, g) => n + g.states.length, 0)} failures): the report lists them all.\n`;
  }
}
writeFileSync(out, md);
console.log('wrote ' + out + ' (' + findings.length + ' failures, ' + areas.length + ' areas)');
