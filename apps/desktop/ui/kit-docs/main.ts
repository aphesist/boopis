/* The kit's article (`pnpm kit:docs`): one page that teaches the v7 kit in the order it is built, written from the component folders.
   Every live example is a component's own lab story drawn by the real kit (its functions, its CSS, its behaviour); every "Show code"
   is the folder's own files; every fact under a component is its contract. Nothing here is a copy that can drift: change a folder and
   run `pnpm kit:docs` again. The page itself is a v7 root and draws with the kit's tokens and fonts. */
import '../src/components/kit.css';
import '../src/components/v7/kit-v7.css';
import '../src/lab/lab.css';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import './docs.css';
import { kit, setupOrbs, startGlance, ui } from '@boopis/ui';
import type { Contract, Layer } from '../src/components/v7/contract';
import { UI_EVENTS } from '../src/components/v7/events';
import { color, font, motion as motionTokens, radius, space as spaceTokens } from '../src/styles/tokens.v7.json';
import TERMS from '../../../../docs/kit/TERMS.md?raw';
import STATE from '../../../../docs/kit/STATE.md?raw';
import RULES from '../../../../docs/kit/RULES.md?raw';
import type { State, Story } from '../src/lab/types';
import { HEX, IRIS, KAI, MOSS, NINA } from '../src/lab/stories/kit/_bots';
import { CHAPTERS, PROMPTS } from './content';
import type { Prompt } from './content';

/* ───────── what the folders hold ───────── */
const views = import.meta.glob<{ contract?: Contract }>(['../src/components/v7/*/*.ts', '!../src/components/v7/*/*.test.ts', '!../src/components/v7/*/*.stories.ts', '!../src/components/v7/*/behaviour.ts', '!../src/components/v7/*/editing.ts', '!../src/components/v7/*/notify.ts'], { eager: true });
const sources = import.meta.glob<string>(['../src/components/v7/*/*.ts', '../src/components/v7/*/*.css'], { query: '?raw', import: 'default', eager: true });
const storyMods = import.meta.glob<{ default: Story | readonly Story[] }>('../src/components/v7/*/*.stories.ts', { eager: true });
const CONTRACTS: Contract[] = Object.values(views).map((m) => m.contract).filter((c): c is Contract => !!c);
const LAYER_ORDER: readonly Layer[] = ['control', 'inline', 'row', 'block', 'surface', 'thread', 'compose', 'dock', 'notify'];
const ofLayer = (l: Layer): Contract[] => CONTRACTS.filter((c) => c.layer === l).sort((a, b) => a.name.localeCompare(b.name));
const storyOf = (folder: string): Story | undefined => { const m = storyMods['../src/components/v7/' + folder + '/' + folder + '.stories.ts']?.default; return Array.isArray(m) ? m[0] : m as Story | undefined; };
const fileOf = (folder: string, file: string): string | undefined => sources['../src/components/v7/' + folder + '/' + file];

/* ───────── small helpers ───────── */
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
}
const html = (markup: string): HTMLElement => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstElementChild as HTMLElement; };
const div = (cls: string, inner = ''): HTMLElement => { const d = document.createElement('div'); d.className = cls; d.innerHTML = inner; return d; };
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** a line of the docs' markdown: inline code and bold */
const inline = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
/** the first markdown table after `after` (a heading's words), as a table element */
function mdTable(md: string, after = ''): HTMLElement {
  const from = after ? md.indexOf(after) : 0;
  const lines = md.slice(Math.max(0, from)).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|'));
  const rows: string[][] = [];
  for (const l of lines.slice(start)) { if (!l.startsWith('|')) break; rows.push(l.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))); }
  const [head, , ...body] = rows;
  return html('<table><thead><tr>' + (head ?? []).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
}
/** the bullets of a markdown section, as a list */
function mdBullets(md: string, after: string): HTMLElement {
  const lines = md.slice(md.indexOf(after)).split('\n').slice(1);
  const items: string[] = [];
  for (const l of lines) { if (l.startsWith('## ')) break; if (l.startsWith('- ')) items.push(l.slice(2)); else if (/^ {2}\S/.test(l) && items.length) items[items.length - 1] += ' ' + l.trim(); }
  return html('<ul>' + items.map((i) => '<li>' + inline(i) + '</li>').join('') + '</ul>');
}
/** a component's lab state drawn by the real kit into a stage */
async function drawState(st: State | undefined, into: HTMLElement): Promise<void> {
  const cell = div('lab-cell');
  if (st?.width) cell.style.width = st.width + 'px';
  into.append(cell);
  if (st?.ground) into.dataset['ground'] = st.ground;
  try { await st?.render?.({ root: cell, ui, wait } as Parameters<NonNullable<State['render']>>[0]); } catch (e) { cell.textContent = 'This example failed to draw: ' + String((e as Error).message ?? e); }
}
const typicalOf = (folder: string): State | undefined => { const s = storyOf(folder); return s ? s.states['typical'] ?? Object.values(s.states)[0] : undefined; };
function stage(): HTMLElement { const s = div('kd-stage ui-root'); return s; }
/** a Disclosure of the kit holding `content` once open */
function disclose(summary: string, content: HTMLElement, open = false): HTMLElement {
  const d = kit.disclosure({ summary, after: '<div class="kd-slot"></div>', ...(open ? { open: true } : {}) });
  d.querySelector('.kd-slot')?.replaceWith(content);
  return d;
}

/* ───────── the parts of the page ───────── */
const main = document.getElementById('kd') as HTMLElement;
const nav = h('nav', { class: 'kd-nav', 'aria-label': 'Contents' });
const body = div('kd-body');
const navList = h('ol');
const addNav = (id: string, title: string, sub = false): void => { navList.append(h('li', sub ? { class: 'kd-nav__sub' } : {}, h('a', { href: '#' + id }, title))); };
function section(id: string, title: string, level: 2 | 3 = 2, navSub = false): HTMLElement {
  const s = h('section', { id, 'aria-labelledby': id + '-h' });
  s.append(h(level === 2 ? 'h2' : 'h3', { id: id + '-h' }, title));
  addNav(id, title, navSub || level === 3);
  body.append(s);
  return s;
}
function rule(markup: string): HTMLElement { return html('<div class="kd-rule">' + markup + '</div>'); }
function p(markup: string, cls = ''): HTMLElement { return html('<p' + (cls ? ' class="' + cls + '"' : '') + '>' + markup + '</p>'); }

function promptBox(pr: Prompt): HTMLElement {
  const box = div('kd-prompt');
  const bar = div('kd-prompt__bar');
  bar.append(h('span', {}, 'Prompt for a coding agent: ' + pr.title));
  const btn = kit.button({ label: 'Copy prompt', icon: 'copy', size: 28, variant: 'tint' });
  btn.addEventListener('click', () => {
    const done = (): void => { const l = btn.querySelector('.k7-btn__label'); if (l) { l.textContent = 'Copied'; setTimeout(() => { l.textContent = 'Copy prompt'; }, 1600); } };
    void navigator.clipboard?.writeText(pr.text).then(done, () => { const r = document.createRange(); r.selectNodeContents(box.querySelector('pre') as Node); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); });
  });
  bar.append(btn);
  box.append(bar, kit.well({ text: pr.text, label: 'Prompt: ' + pr.title }));
  box.id = pr.id;
  return box;
}

/* the files of a folder as tabs: view, behaviour, styles, test, stories */
const FILES: readonly (readonly [string, (f: string) => string])[] = [['view', (f) => f + '.ts'], ['behaviour', () => 'behaviour.ts'], ['editing', () => 'editing.ts'], ['styles', (f) => f + '.css'], ['test', (f) => f + '.test.ts'], ['stories', (f) => f + '.stories.ts']];
function codeTabs(c: Contract): HTMLElement {
  const wrap = div('kd-code');
  const files = FILES.map(([label, name]) => [label, name(c.folder)] as const).filter(([, n]) => fileOf(c.folder, n) != null);
  const ids = files.map(([label]) => 'kd-' + c.folder + '-' + label);
  const tabs = kit.segmented({ label: c.name + "'s files", variant: 'tabs', value: files[0]?.[0] ?? '', items: files.map(([label, n], i) => ({ value: label, label: label === 'view' ? n : label === 'styles' ? n : n, controls: ids[i], id: ids[i] + '-t' })) });
  wrap.append(tabs);
  files.forEach(([label, n], i) => {
    const panel = div('kd-code__panel');
    panel.id = ids[i] as string; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', (ids[i] as string) + '-t'); panel.dataset['file'] = label;
    if (i > 0) panel.hidden = true;
    panel.append(kit.well({ text: (fileOf(c.folder, n) ?? '').replace(/\n$/, ''), label: 'components/v7/' + c.folder + '/' + n }));
    wrap.append(panel);
  });
  tabs.addEventListener('ui:change', (e) => { const v = (e as CustomEvent<{ value: string }>).detail.value; for (const pnl of wrap.querySelectorAll<HTMLElement>('.kd-code__panel')) pnl.hidden = pnl.dataset['file'] !== v; });
  return wrap;
}
const codes = (xs: readonly string[]): string => (xs.length ? xs.map((x) => '<code>' + esc(x) + '</code>').join(' ') : '<span class="kd-dim">none</span>');
async function component(c: Contract, into: HTMLElement): Promise<void> {
  const s = h('section', { class: 'kd-comp', id: 'c-' + c.folder, 'aria-labelledby': 'c-' + c.folder + '-h' });
  s.append(html('<h3 id="c-' + c.folder + '-h">' + esc(c.name) + ' <small>kit.' + esc(c.exports.join(', kit.html.')) + '</small></h3>'));
  s.append(p(esc(c.summary)));
  const st = stage();
  s.append(st);
  await drawState(typicalOf(c.folder), st);
  s.append(html('<dl class="kd-facts"><dt>Events up</dt><dd>' + codes(c.events) + '</dd><dt>State on the element</dt><dd>' + codes(c.states) + '</dd>' +
    '<dt>Parts</dt><dd>' + codes(c.parts) + '</dd><dt>Keyboard and reader</dt><dd>' + esc(c.a11y) + '</dd>' +
    (c.boards.length ? '<dt>Boards</dt><dd>' + codes(c.boards) + '</dd>' : '') + '<dt>Tokens</dt><dd>' + c.tokens.length + ' from the v7 sheet</dd></dl>'));
  const props = html('<dl class="kd-props">' + Object.entries(c.props).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(String(v)) + '</dd>').join('') + '</dl>');
  s.append(disclose('Props down: ' + Object.keys(c.props).length + ' props', props));
  s.append(disclose('Show code', codeTabs(c)));
  into.append(s);
}

/* ───────── step-through diagrams, drawn with the real components at each step ───────── */
interface Step { label: string; say: string; draw(stage: HTMLElement, next: () => void): void }
function stepThrough(id: string, title: string, steps: readonly Step[]): HTMLElement {
  const wrap = div('kd-steps');
  wrap.id = id;
  const bar = div('kd-bar');
  let at = 0;
  const pick = kit.segmented({ label: title + ': steps', value: '0', items: steps.map((s, i) => ({ value: String(i), label: i + 1 + ' ' + s.label })) });
  const back = kit.button({ label: 'Back', icon: 'back', size: 28, variant: 'ghost' }), fwd = kit.button({ label: 'Next', size: 28, variant: 'tint' });
  bar.append(pick, back, fwd);
  const st = stage(); st.classList.add('kd-steps__stage');
  const say = div('kd-steps__say');
  say.setAttribute('aria-live', 'polite');
  const show = (i: number): void => {
    at = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[at] as Step;
    st.replaceChildren();
    const cell = div('lab-cell');
    st.append(cell);
    s.draw(cell, () => { show(at + 1); });
    say.innerHTML = '<strong>' + (at + 1) + '. ' + esc(s.label) + '.</strong> ' + s.say;
    for (const b of pick.querySelectorAll<HTMLElement>('[data-kit-part~="SegmentedItem"]')) { const on = b.dataset['value'] === String(at); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    pick.style.setProperty('--i', String(at));
    (back as HTMLButtonElement).disabled = at === 0; (fwd as HTMLButtonElement).disabled = at === steps.length - 1;
  };
  pick.addEventListener('ui:change', (e) => { e.preventDefault(); show(Number((e as CustomEvent<{ value: string }>).detail.value)); });
  back.addEventListener('click', () => { show(at - 1); });
  fwd.addEventListener('click', () => { show(at + 1); });
  wrap.append(bar, st, say);
  show(0);
  return wrap;
}
const BOTS = [{ ...NINA, needs: true }, { ...KAI, working: true }, { ...MOSS }, { ...IRIS }, { ...HEX, resting: true }];
const ASK = { bot: NINA, ask: 'Deploy 0.2.0 to staging?', command: 'boopis deploy staging --tag 0.2.0', answers: [{ label: 'Hold to allow once', primary: true, hold: true }, { label: 'Deny', outline: true, end: true }] };
const dockAt = (d: HTMLElement): HTMLElement => { const w = div('k7-lab-dock'); w.append(d); return w; };
function holdSteps(): HTMLElement {
  const commitMovesOn = (cell: HTMLElement, next: () => void): void => { cell.addEventListener('ui:commit', () => { setTimeout(next, 250); }, { once: true }); };
  return stepThrough('steps-hold', 'Hold to approve in the dock', [
    { label: 'Needs you', say: 'nina asks before she deploys. The dock is drawn from what the Source reports: her orb carries the flag, and the row ends in the amber ask pill. <code>kit.dock({ bots })</code>, props down.', draw: (c) => { c.append(dockAt(kit.dock({ bots: BOTS }))); } },
    { label: 'The asks open', say: 'The pill opens the stack: the same Dock, now <code>kind: \'open\'</code>, holding the kit\'s AskCard. Its first answer is a Chip that holds. The hold is live: press and hold it for a second and the walk moves on.', draw: (c, next) => { c.append(dockAt(kit.dock({ kind: 'open', bots: BOTS, open: { kind: 'stack', asks: [ASK] } }))); commitMovesOn(c, next); } },
    { label: 'Holding', say: 'While it is held the fill sweeps over <code>--dur-hold</code> (1 s) and the chip carries <code>data-holding</code>; let go early and it drains. From the keyboard, Space held, or Enter twice. Drawn here at half way.', draw: (c, next) => { c.append(dockAt(kit.dock({ kind: 'open', bots: BOTS, open: { kind: 'stack', asks: [ASK] } }))); const chip = c.querySelector<HTMLElement>('[data-hold]'); chip?.style.setProperty('--hold', '.5'); commitMovesOn(c, next); } },
    { label: 'Allowed once', say: 'The chip dispatched <code>ui:commit</code>, events up. The dock\'s module turned it into a command on the Source, and the card is drawn again from the answer that came back: one row that says what was chosen.', draw: (c) => { c.append(dockAt(kit.dock({ kind: 'open', bots: BOTS, open: { kind: 'stack', asks: [{ ...ASK, state: 'answered', word: { text: 'allowed once', tone: 'ok' } }] } }))); } },
    { label: 'Back at rest', say: 'Nothing waits: the row is drawn at rest, nina\'s flag is gone, and so is the pill.', draw: (c) => { c.append(dockAt(kit.dock({ bots: BOTS.map((b) => ({ ...b, needs: false })) }))); } }
  ]);
}
function formSteps(): HTMLElement {
  const fields = (path: string, len: string): string => kit.html.field({ id: 'kd-f-path', label: 'File', value: path, placeholder: 'docs/releases/0.2.0.md', mono: true }) +
    kit.html.field({ id: 'kd-f-len', label: 'Length', control: kit.html.segmented({ label: 'Length', value: len, items: [{ value: 'short', label: 'Short' }, { value: 'full', label: 'Full' }], attrs: { 'aria-labelledby': 'kd-f-len-label' } }) });
  const base = { variant: 'form' as const, bot: KAI, ask: 'Where should the release notes go?', sub: 'kai is writing the notes for 0.2.0.', effect: 'kai writes the file there and opens a pull request.', countdown: 'expires in 9 min', answers: [{ label: 'Send', primary: true, action: 'submit' }, { label: 'Later', action: 'defer' }] };
  return stepThrough('steps-form', 'A form from asked to answered', [
    { label: 'Asked', say: 'A bot\'s question is an AskCard of variant <code>form</code>: the ask, what it is for, its Fields stacked 8 apart, what sending does, and its answers. Its state is <code>needs</code>.', draw: (c) => { c.append(kit.askCard({ ...base, fields: fields('', 'short') })); } },
    { label: 'Filled', say: 'The person types the path and chooses Full. Each control keeps its own state on the element (the Field\'s value, the Segmented\'s <code>aria-checked</code>) and says so with <code>ui:change</code>.', draw: (c) => { c.append(kit.askCard({ ...base, fields: fields('docs/releases/0.2.0.md', 'full') })); } },
    { label: 'Sending', say: 'Send was pressed. While the answer goes to the Source the card is <code>busy</code>: <code>aria-busy</code> on the card, and its fields and answers are inert.', draw: (c) => { c.append(kit.askCard({ ...base, fields: fields('docs/releases/0.2.0.md', 'full'), busy: true })); } },
    { label: 'Answered', say: 'The Source answered, and the card is drawn again from it: <code>state: \'answered\'</code>, one row with what was sent and a quiet word. Nothing is kept in the card that the Source did not send.', draw: (c) => { c.append(kit.askCard({ variant: 'form', state: 'answered', bot: KAI, ask: 'Release notes: docs/releases/0.2.0.md', word: { text: 'sent', tone: 'ok' } })); } }
  ]);
}

/* ───────── the page ───────── */
async function build(t: 'dark' | 'light'): Promise<void> {
  /* the hero */
  const hero = h('header');
  hero.append(h('h1', {}, 'The boopis UI kit'));
  hero.append(p('Every piece of the desktop app is drawn by one kit of ' + CONTRACTS.length + ' components. This page teaches it in the order it is built: the terms, where state lives, the tokens, then controls, rows, surfaces, the thread, the composer, the dock and notices. Each idea is one short rule and a live example drawn by the kit\'s own code, CSS and behaviour; "Show code" opens the component\'s own files.', 'kd-lead'));
  body.append(hero);

  /* terms */
  const terms = section('terms', 'Terms');
  terms.append(p('The kit uses a few words in one sense each. Every rule below uses them this way.'));
  terms.append(mdTable(TERMS));

  /* props down, events up */
  const flow = section('flow', 'Props down, events up');
  flow.append(rule('<strong>A component is drawn from props, and what a person does comes back as an event.</strong> A view turns typed props into markup and keeps nothing. A press changes the element\'s own state at once and dispatches one event of the kit\'s map (<code>events.ts</code>): ' + UI_EVENTS.map((e) => '<code>' + e + '</code>').join(' ') + '. Events bubble, so a screen listens once on a container; where an action follows they are cancelable, and a cancelled event leaves the component as it was.'));
  const demo = stage();
  const cell = div('lab-cell');
  const row1 = div('lab-row'), row2 = div('lab-row');
  const sw = kit.switch({ label: 'Sounds' }), seg = kit.segmented({ label: 'Scope', value: 'bot', items: [{ value: 'bot', label: 'This bot' }, { value: 'all', label: 'Every bot' }] }), filt = kit.chip({ label: 'Failing only' });
  const cancel = kit.chip({ label: 'Cancel every event', variant: 'mode' });
  row1.append(sw, seg, filt); row2.append(cancel);
  const log = kit.well({ text: 'Press a control above. Its events appear here.', label: 'Events' });
  cell.append(row1, row2, log);
  demo.append(cell);
  let cancelling = false;
  cancel.addEventListener('ui:change', (e) => { e.stopPropagation(); cancelling = (e as CustomEvent<{ value: boolean }>).detail.value; });
  kit.on(cell, 'ui:change', (e) => {
    const who = (e.target as HTMLElement).closest('[data-kit]')?.getAttribute('data-kit') ?? '';
    if (cancelling) e.preventDefault();
    const pre = log.querySelector('pre') as HTMLElement;
    const lineText = 'ui:change ' + JSON.stringify(e.detail) + ' from ' + who + (cancelling ? ', cancelled: it stays as it was' : '');
    pre.textContent = (pre.textContent?.startsWith('Press') ? '' : pre.textContent + '\n') + lineText;
  });
  flow.append(demo);
  flow.append(p('The screen\'s side, in a module: <code>kit.on(root, \'ui:change\', (e) =&gt; source.set(e.detail.value))</code>. The Source answers, and the screen draws the component again with the new props.'));

  /* where state lives */
  const st = section('state', 'Where state lives');
  st.append(p('Every piece of state lives in exactly one of four places. Decide which before you add one: the place says who may change it, who hears about it, and what survives a redraw.'));
  st.append(mdTable(STATE));
  st.append(h('h4', {}, 'How they meet'));
  st.append(mdBullets(STATE, '## How they meet'));
  st.append(promptBox(PROMPTS.state));
  st.append(promptBox(PROMPTS.source));

  /* test levels */
  const tl = section('tests', 'Test levels');
  tl.append(p('Four levels, named the same everywhere: a component\'s test file has <code>describe(\'story: …\')</code> and <code>describe(\'scene: …\')</code>, the smoke is the play, and <code>pnpm lab:board</code> is the board check.'));
  tl.append(mdTable(RULES, '## 4.'));

  /* tokens */
  const tk = section('tokens', 'Tokens');
  tk.append(rule('<strong>A component\'s CSS reads tokens only.</strong> Every colour, length, radius and duration is a custom property declared on a v7 root by <code>styles/tokens.v7.css</code>, which <code>pnpm tokens</code> writes from <code>tokens.v7.json</code>. A theme is the same names with other values: switch the theme in the contents and every swatch below follows.'));
  const colours = div('kd-swatches');
  for (const [k, v] of Object.entries(color as Record<string, { css: string; use?: string }>)) colours.append(html('<div class="kd-swatch" title="' + esc(v.use ?? k) + '"><i style="background: var(' + v.css + ')"></i><span><code>' + v.css + '</code></span></div>'));
  tk.append(h('h3', {}, 'Colour'), p('One ink at alpha steps for text, lines and fills; the surfaces from the sidebar (deepest) up to the floating layer; the accent and the attention colours.', 'kd-dim'), colours);
  const type = div('kd-type');
  for (const [, s] of Object.entries((font as unknown as { scale: Record<string, { css: string; size: number; line: number }> }).scale)) type.append(html('<div><span>' + s.css + ' ' + s.size + '/' + s.line + '</span><span style="font-size: var(' + s.css + '); line-height: var(' + s.css.replace('--fs', '--lh') + ')">Ship 0.2.0 when the tests pass</span></div>'));
  tk.append(h('h3', {}, 'Type'), type);
  const radii = div('kd-scale');
  for (const [, r] of Object.entries(radius as Record<string, { css: string; value: number | string }>)) if (typeof r.value === 'number' && r.css !== '--corner-smoothing' && r.value < 100) radii.append(html('<div><b style="border-radius: var(' + r.css + ')"></b><code>' + r.css + '</code>' + r.value + '</div>'));
  tk.append(h('h3', {}, 'Corners'), p('A nested corner is the outer radius less its inset; the boards draw every corner as a continuous curve.', 'kd-dim'), radii);
  const space = div('kd-scale');
  for (const [k, v] of Object.entries((spaceTokens as unknown as { steps: Record<string, number> }).steps)) space.append(html('<div><b style="width: var(' + k + '); height: var(' + k + ')"></b><code>' + k + '</code>' + v + '</div>'));
  tk.append(h('h3', {}, 'Space'), space);
  const motion = (motionTokens as unknown as { durations: Record<string, { value: string; use?: string }> }).durations;
  tk.append(h('h3', {}, 'Motion'), html('<table><thead><tr><th>Token</th><th>Value</th><th>Use</th></tr></thead><tbody>' + Object.entries(motion).map(([k, v]) => '<tr><td><code>' + k + '</code></td><td>' + esc(v.value) + '</td><td>' + esc(v.use ?? '') + '</td></tr>').join('') + '</tbody></table>'));

  /* the chapters, in dependency order */
  for (const ch of CHAPTERS) {
    const s = section('ch-' + ch.id, ch.title);
    s.append(rule(ch.rule));
    if (ch.more) s.append(p(ch.more, 'kd-dim'));
    for (const layer of LAYER_ORDER.filter((l) => ch.layers.includes(l))) for (const c of ofLayer(layer)) { addNav('c-' + c.folder, c.name, true); await component(c, s); }
    if (ch.id === 'thread') { s.append(h('h3', { id: 'steps-form-h' }, 'A form, from asked to answered')); s.append(formSteps()); }
    if (ch.id === 'dock') { s.append(h('h3', { id: 'steps-hold-h' }, 'Hold to approve, step by step')); s.append(holdSteps()); }
  }

  /* every component, both themes */
  const all = section('all', 'Every component');
  all.append(p('Each component\'s first lab state, drawn live. Switch this grid between the themes; the rest of the page keeps the theme chosen in the contents.'));
  const gridTheme = kit.segmented({ label: 'The grid\'s theme', value: t, items: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] });
  const grid = div('kd-grid');
  grid.id = 'kd-grid';
  kit.applyTheme(grid, { theme: t });
  gridTheme.addEventListener('ui:change', (e) => { kit.applyTheme(grid, { theme: (e as CustomEvent<{ value: string }>).detail.value as 'dark' | 'light' }); });
  all.append(html('<div class="kd-bar"></div>'));
  all.lastElementChild?.append(gridTheme);
  all.append(grid);
  for (const layer of LAYER_ORDER) for (const c of ofLayer(layer)) {
    const g = div('kd-grid__cell ui-root');
    g.append(h('h4', {}, c.name));
    grid.append(g);
    await drawState(typicalOf(c.folder), g);
  }

  /* the shape of the kit */
  const shape = section('shape', 'The shape of a component');
  shape.append(p('One folder per component, under its public name in kebab-case. The barrel, <code>components/v7/index.ts</code>, is the only way in; <code>wire.ts</code> is a registry of each folder\'s behaviour; <code>kit-v7.css</code> imports each folder\'s CSS in the cascade order.'));
  shape.append(kit.well({ text: 'components/v7/<name>/\n  <name>.ts           the view (typed props to markup) and the contract\n  behaviour.ts        keys, focus and pointer, wired by wire.ts (only when it has any)\n  <name>.css          its look: tokens only\n  <name>.stories.ts   the lab\'s states of it (id kit/<name>)\n  <name>.test.ts      describe(\'story: …\') and describe(\'scene: …\')', label: 'A component\'s folder' }));
  shape.append(promptBox(PROMPTS.component));

  body.append(html('<footer class="kd-foot">Written from the component folders of <code>apps/desktop/ui/src/components/v7/</code> and <code>docs/kit/</code> by <code>pnpm kit:docs</code>. ' + CONTRACTS.length + ' components, ' + UI_EVENTS.length + ' events.</footer>'));

  /* the contents and the theme */
  nav.append(h('p', { class: 'kd-nav__title' }, 'The boopis UI kit'), navList);
  const theme = kit.segmented({ label: 'Theme', value: t, items: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] });
  theme.addEventListener('ui:change', (e) => { const t = (e as CustomEvent<{ value: string }>).detail.value as 'dark' | 'light'; kit.applyTheme(document.body, { theme: t }); });
  const tw = div('kd-nav__theme'); tw.append(theme); nav.append(tw);
}

async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const t = q.get('theme') === 'light' ? 'light' : 'dark';
  kit.applyTheme(document.body, { theme: t });
  /* one file, no worker: the orbs draw on the page's thread */
  try { Object.defineProperty(window, 'OffscreenCanvas', { value: undefined, configurable: true }); } catch { /* the engine refuses: the worker path still falls back */ }
  await setupOrbs();
  ui.squircle.start();
  ui.scrollEdges.start();
  startGlance();
  ui.tooltip.enable();
  main.append(nav, body);
  await build(t);
  main.removeAttribute('aria-busy');
  document.documentElement.dataset['kdReady'] = '1';
}
void start();
