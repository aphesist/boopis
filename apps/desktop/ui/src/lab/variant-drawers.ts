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
const LONG_BODY = Array.from({ length: 30 }, (_, i) => '<p>Line ' + (i + 1) + '</p>').join('');

export const DRAWERS: Partial<Record<ComponentName, Drawer>> = {
  button: t('button', { label: 'Approve plan' }, (a, v) => (a === 'keys' ? (v ? { keys: 'mod+enter', showKeys: true } : {}) : { [a]: v })),
  iconButton: t('iconButton', { icon: 'gear', label: 'Settings' }),
  hold: t('hold', {}),
  scroll: t('scroll', { label: 'A long body', body: LONG_BODY, attrs: { style: 'height:120px;width:240px' } }, (a, v) => (a === 'axis' && v !== 'y' ? { axis: v, body: '<div style="width:800px">' + LONG_BODY + '</div>' } : { [a]: v }), { ground: 'frame' }),
  empty: t('empty', { title: 'No sessions yet', text: 'Start one with New session.' }, (a, v) => (a === 'action' ? (v ? { action: html.button({ label: 'New session', variant: 'primary' }) } : {}) : { [a]: v }), { width: 420 }),
  measure: t('measure', { used: 76000, total: 200000 }, undefined, { width: 320 }),
  disclosure: t('disclosure', { label: '6 steps' }),
  entry: t('entry', { who: 'you', callno: ['14:01'], body: '<p>A message.</p>' }, undefined, { width: 720 }),
  modelMark: { draw: (p) => ui.html.modelMark('sonnet 5.5', p as { color?: 'mono' | 'brand' }), base: {} }
};
/** components in `variants` drawn elsewhere: their own stories cover every value */
export const VARIANTS_ELSEWHERE: Readonly<Partial<Record<ComponentName, string>>> = {
  signinButton: 'components/signin-button (the four labs, disabled)', keys: 'components/keys and key-combos (fit, raised)', badge: 'no variants', dot: 'components/dot (kind, size)', code: 'no variants',
  tip: 'components/tooltip (keys, state)',
  progress: 'cards/mod-view (determinate and travelling dots)', orb: 'components/orb (sizes, still)'
};

