/* Marks and small pieces: code chips, keys, inline prose, the stamp, dots, capacity, ladder, measures, legend, pages,
   model marks, orbs, the empty state (14.7, 14.26 to 14.28, 10.1, 13). */
import { html, ui } from '@boopis/ui';
import { line, put, stage } from '../../story';
import type { Story } from '../../types';
import { BOT_LIKE, BOT_LONG, LONG_TITLE, RTL, UNBROKEN } from '../../fixtures';
import { GOVERNANCE, CONTEXT } from '../../../data/mock-data';

const MARKS = { url: '/v6/design-system/index.html#c-marks', crop: '#c-marks' };
const MEASURES = { url: '/v6/design-system/index.html#c-measures', crop: '#c-measures' };
const cmp = (id: string, title: string, covers: string[], mock: Story['mock'], states: Story['states']): Story => ({ id: 'components/' + id, title, area: 'components', kind: 'component', covers, ...(mock ? { mock } : {}), states });

export default [
  cmp('code', 'Code chip and inline prose', ['ui.code', 'ui.inline'], MARKS, {
    typical: stage(['typical'], ({ root }) => { line(root, ui.code('prorateCents')); put(root, ui.inline('Everything under `src/billing` now works as integer cents; `prorateCents` rounds once.')); }, { width: 608 }),
    long: stage(['long'], ({ root }) => { line(root, ui.code(UNBROKEN)); put(root, ui.inline('A path `' + UNBROKEN + '` inside prose that has to wrap.')); }, { width: 608 }),
    empty: stage(['empty'], ({ root }) => { line(root, ui.code('')); })
  }),
  cmp('keys', 'Keys', ['ui.keys'], MARKS, {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, ui.keys('mod+K'), ui.keys('alt+shift+O'), ui.keys('esc'), ui.keys('mod+period')); }),
    long: stage(['long'], ({ root }) => { line(root, ui.keys('mod+shift+alt+ctrl+enter')); })
  }),
  cmp('stamp', 'Stamp', ['ui.stamp'], MARKS, {
    typical: stage(['typical'], ({ root }) => { line(root, ui.stamp('waiting for you'), ui.stamp('needs you'), ui.stamp('failed')); }),
    long: stage(['long'], ({ root }) => { line(root, ui.stamp(LONG_TITLE)); }, { width: 300 })
  }),
  cmp('dot', 'Status dots', ['ui.dot'], MARKS, {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, ui.dot({ kind: 'run' }), ui.dot({ kind: 'attention' }), ui.dot({ kind: 'here' }), ui.dot({})); }),
    long: stage(['long'], ({ root }) => { line(root, ui.dot({ kind: 'attention' })); }, { note: 'no text' })
  }),
  cmp('capacity', 'Capacity', ['ui.capacity'], MEASURES, {
    typical: stage(['typical'], ({ root }) => { line(root, ui.capacity({ spent: '$0.37', cap: '$0.60' })); }),
    long: stage(['long'], ({ root }) => { line(root, ui.capacity({ spent: '$123,456.78', cap: '$999,999.00' })); }),
    error: stage(['error'], ({ root }) => { line(root, ui.capacity({ spent: '$0.71', cap: '$0.60' })); }, { note: 'over the cap' })
  }),
  cmp('ladder', 'Ladder', ['ui.ladder'], MEASURES, {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, ui.ladder({ stations: GOVERNANCE.ladder, current: GOVERNANCE.current })); put(root, ui.ladder({ stations: GOVERNANCE.ladder, current: GOVERNANCE.current, variant: 'list' })); }, { width: 320 }),
    empty: stage(['empty'], ({ root }) => { line(root, ui.ladder({ stations: [] })); }),
    off: stage(['disabled'], ({ root }) => { put(root, ui.ladder({ stations: GOVERNANCE.ladder, current: 1, variant: 'list', off: true })); }, { width: 320 }),
    long: stage(['long'], ({ root }) => { put(root, ui.ladder({ variant: 'list', current: 0, stations: [['claude-sonnet-5-5-20261101-extended-context-preview', LONG_TITLE], ['qwen3-coder-480b', 'after 1 fail']] })); }, { width: 320 }),
    many: stage(['many'], ({ root }) => { line(root, ui.ladder({ current: 9, stations: Array.from({ length: 16 }, (_, i) => ['model ' + i] as const) })); })
  }),
  cmp('measure', 'Measure and legend', ['ui.measure', 'ui.legend'], MEASURES, {
    typical: stage(['typical', 'variant'], ({ root }) => {
      line(root, ui.measure({ used: 76000, total: 200000 }));
      line(root, ui.measure({ total: CONTEXT.total, parts: CONTEXT.parts, variant: 'row' }));
      line(root, ui.measure({ total: CONTEXT.total, parts: CONTEXT.parts, variant: 'grid', cols: 10 }));
      put(root, ui.legend(CONTEXT.parts, (n) => Math.round(n / 1000) + 'k'));
    }, { width: 320 }),
    empty: stage(['empty'], ({ root }) => { line(root, ui.measure({ used: 0, total: 200000 })); put(root, ui.legend([])); }),
    full: stage(['error'], ({ root }) => { line(root, ui.measure({ used: 200000, total: 200000 })); }),
    long: stage(['long'], ({ root }) => { put(root, ui.legend([[LONG_TITLE, 120000], [UNBROKEN, 9000]])); }, { width: 320 })
  }),
  cmp('pages', 'Page dots', ['ui.pages'], { url: '/v6/design-system/index.html#c-dock', crop: '#c-dock' }, {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, ui.pages({ pages: [{ id: 'a', label: 'Bots' }, { id: 'b', label: 'Runs', attention: true }, { id: 'c', label: 'Schedules' }], current: 'a', interactive: true })); line(root, ui.pages({ pages: [{ id: 'a' }, { id: 'b' }], current: 'b' })); }, { ground: 'dock' }),
    single: stage(['single'], ({ root }) => { line(root, ui.pages({ pages: [{ id: 'a', label: 'Bots' }], current: 'a', interactive: true })); }, { ground: 'dock' }),
    many: stage(['many'], ({ root }) => { line(root, ui.pages({ pages: Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, label: 'Page ' + i })), current: 'p5', interactive: true })); }, { ground: 'dock' }),
    long: stage(['long'], ({ root }) => { line(root, ui.pages({ pages: [{ id: 'a', label: LONG_TITLE }], current: 'a', interactive: true })); }, { ground: 'dock' })
  }),
  cmp('model-mark', 'Model marks', ['ui.modelMark', 'ui.model', 'ui.modelRoute'], { url: '/v6/design-system/index.html#icons', crop: '#icons' }, {
    typical: stage(['typical', 'variant'], ({ root }) => {
      line(root, ...['sonnet 5.5', 'opus 5.5', 'haiku 4.5', 'qwen3-coder', 'gpt-5', 'gemini-3-pro', 'llama-4', 'mistral-large'].map((m) => ui.model(m)));
      line(root, ...['sonnet 5.5', 'gpt-5', 'gemini-3-pro'].map((m) => ui.model(m, { color: 'brand' })));
      line(root, ui.modelRoute('qwen3-coder → sonnet 5.5'), ui.modelMark('opus 5.5', { size: 24 }));
    }, { width: 720 }),
    'unknown family': stage(['error'], ({ root }) => { line(root, ui.model('mystery-model-9'), ui.modelMark('???')); }),
    long: stage(['long'], ({ root }) => { line(root, ui.model('claude-sonnet-5-5-20261101-extended-context-preview'), ui.modelRoute('qwen3-coder-480b → haiku 4.5 → sonnet 5.5 → opus 5.5')); }, { width: 360 })
  }),
  cmp('orb', 'Orb', ['ui.orb'], { url: '/v6/design-system/index.html#orbs', crop: '#orbs' }, {
    typical: stage(['typical', 'size'], ({ root }) => { line(root, ...[16, 20, 28, 40, 64].map((size) => ui.orb(BOT_LIKE, { size, still: true }))); }, { allow: { visual: 'orbs are drawn still; their idle motion is random by design' } }),
    states: stage(['variant'], ({ root }) => { line(root, ...Object.keys(ui.states).map((state) => ui.orb({ ...BOT_LIKE, state }, { size: 40, still: true }))); }, { width: 720 }),
    'with a flag': stage(['variant'], ({ root }) => { line(root, ui.orb(BOT_LIKE, { size: 40, flag: true, still: true }), ui.orb(BOT_LONG, { size: 40, flag: true, still: true })); }),
    long: stage(['long'], ({ root }) => { line(root, ui.orb(BOT_LONG, { size: 28, still: true })); }, { note: 'an orb shows no name' }),
    'on the dock': stage(['variant'], ({ root }) => { line(root, ...[28, 40].map((size) => ui.orb(BOT_LIKE, { size, still: true }))); }, { ground: 'dock' })
  }),
  cmp('empty', 'Empty state', ['ui.empty'], { url: '/v6/design-system/index.html#c-shell', crop: '#c-shell' }, {
    typical: stage(['typical'], ({ root }) => { put(root, ui.empty({ title: 'No sessions yet', text: 'Start one with New session, or press mod+shift+O.', mark: true })); }, { width: 480 }),
    'with an action': stage(['variant'], ({ root }) => { put(root, ui.empty({ title: 'No bots yet', text: 'A bot is a teammate with its own profile.', mark: true, action: html.button({ label: 'New bot', variant: 'primary' }) })); }, { width: 480 }),
    long: stage(['long'], ({ root }) => { put(root, ui.empty({ title: LONG_TITLE, text: UNBROKEN, mark: true })); }, { width: 480 }),
    rtl: stage(['rtl'], ({ root }) => { put(root, ui.empty({ title: RTL, text: RTL, mark: true })); }, { width: 480, dir: 'rtl' })
  })
];
