/* How the lab draws each component the kit lists in `variants` (src/components/variants.ts): its base props, and what an
   axis value means when it is not a prop as such. stories/components/variants.stories.ts draws one axis at a time from
   these; the coverage gate fails when a component in `variants` has no entry here or in VARIANTS_ELSEWHERE. */
import { html, ui } from '@boopis/ui';
import type { ComponentName } from '@boopis/ui';
import type { State } from './types';

type Props = Record<string, unknown>;
/** how to draw one component from props, its base props, and what an axis value means when it is not a prop as such */
export interface Drawer { draw(p: Props): string; base: Props; as?(axis: string, v: unknown): Props; width?: number; ground?: State['ground'] }
const H = html as unknown as Record<string, (p: Props) => string>;
const t = (name: string, base: Props, as?: Drawer['as'], extra: Partial<Drawer> = {}): Drawer => ({ draw: (p) => (H[name] as (p: Props) => string)(p), base, ...(as ? { as } : {}), ...extra });
/** a drawing that needs its list: a row is an `<li>`, so it is drawn inside a `<ul>` (axe: listitem) */
const wrapped = (cls: string, d: Drawer): Drawer => ({ ...d, draw: (p) => '<ul class="' + cls + '">' + d.draw(p) + '</ul>' });
const SEG = [{ value: 'rail', label: 'Rail' }, { value: 'closed', label: 'Hide' }];
const LONG_BODY = Array.from({ length: 30 }, (_, i) => '<p>Line ' + (i + 1) + '</p>').join('');

export const DRAWERS: Partial<Record<ComponentName, Drawer>> = {
  button: t('button', { label: 'Approve plan' }, (a, v) => (a === 'keys' ? (v ? { keys: 'mod+enter', showKeys: true } : {}) : { [a]: v })),
  iconButton: t('iconButton', { icon: 'gear', label: 'Settings' }),
  hold: t('hold', {}),
  switch: t('switch', { label: 'Smart' }),
  segmented: t('segmented', { label: 'When the sidebar collapses', options: SEG, value: 'rail' }),
  tabs: t('tabs', { label: 'Sections', tabs: [{ value: 'a', label: 'General' }, { value: 'b', label: 'Models' }, { value: 'c', label: 'Appearance' }], value: 'a' }, undefined, { ground: 'frame', width: 420 }),
  chip: t('chip', { label: 'src/billing' }, (a, v) => (a === 'option' ? { option: v, checked: !!v } : { [a]: v })),
  field: t('field', { label: 'Gate command', value: 'npm test' }, (a, v) => (a === 'error' ? (v ? { error: 'That command does not exist' } : {}) : { [a]: v }), { width: 420 }),
  input: t('input', { label: 'Name', value: 'nina' }),
  setRow: t('setRow', { label: 'Show the dock', control: '' }, (a, v) => (a === 'hint' ? (v ? { hint: 'Bots and widgets at the bottom edge' } : {}) : {}), { ground: 'frame', width: 560 }),
  row: wrapped('ui-rows', t('row', { title: 'proration drift in src/billing', end: 'now' }, (a, v) => (a === 'sub' ? (v ? { sub: 'billing-api' } : {}) : a === 'acts' ? (v ? { acts: html.iconButton({ icon: 'archive', label: 'Archive' }) } : {}) : { [a]: v }), { width: 280 })),
  section: t('section', { label: 'Context', meta: '38%', body: '<p>the body</p>' }, undefined, { ground: 'frame', width: 320 }),
  scroll: t('scroll', { label: 'A long body', body: LONG_BODY, attrs: { style: 'height:120px;width:240px' } }, (a, v) => (a === 'axis' && v !== 'y' ? { axis: v, body: '<div style="width:800px">' + LONG_BODY + '</div>' } : { [a]: v }), { ground: 'frame' }),
  empty: t('empty', { title: 'No sessions yet', text: 'Start one with New session.' }, (a, v) => (a === 'action' ? (v ? { action: html.button({ label: 'New session', variant: 'primary' }) } : {}) : { [a]: v }), { width: 420 }),
  ladder: t('ladder', { stations: [['qwen3-coder', 'first try'], ['sonnet 5.5', 'after 2 fails'], ['opus 5.5', 'by request']], current: 1 }, undefined, { width: 320 }),
  measure: t('measure', { used: 76000, total: 200000 }, undefined, { width: 320 }),
  disclosure: t('disclosure', { label: '6 steps' }),
  entry: t('entry', { who: 'you', callno: ['14:01'], body: '<p>A message.</p>' }, undefined, { width: 720 }),
  modelMark: { draw: (p) => ui.html.modelMark('sonnet 5.5', p as { color?: 'mono' | 'brand' }), base: {} }
};
/** components in `variants` drawn elsewhere: their own stories cover every value */
export const VARIANTS_ELSEWHERE: Readonly<Partial<Record<ComponentName, string>>> = {
  signinButton: 'components/signin-button (the four labs, disabled)', chipGroup: 'no variants', keys: 'components/keys and key-combos (fit, raised)', badge: 'no variants', dot: 'components/dot (kind, size)', code: 'no variants',
  setSection: 'no variants', tip: 'components/tooltip (keys, state)',
  progress: 'cards/mod-view (determinate and travelling dots)', orb: 'components/orb (sizes, still)'
};

