/* One state, alone in the window: what the gallery shows in each cell and what `pnpm lab:check` loads.
   lab.html?frame=1&story=<id>&state=<name>[&preset=catalog][&force=hover|focus|active][&zoom=1.6][&dir=rtl]
   A stage state draws into a cell on the stage; an app state boots the whole app (index.html's markup, the modules,
   a provider from `provider.ts`) and runs its setup. When it is drawn the frame sets `data-lab-ready` on <html> and
   exposes `window.__lab` for the checker. */
import '../styles';
import '../../vendor/boopis-logo.js';
import { kit, setupOrbs, startGlance, ui } from '@boopis/ui';
import { emit, on } from '../core/bus';
import { getDockApi } from '../core/registry';
import { getLayout, setState, state } from '../core/state';
import { setProvider } from '../data';
import { themeApi } from '../styles/theme';
import { loadFont } from '../styles/fonts';
import '../modules/cards';
import '../modules/session';
import '../modules/bots';
import '../modules/dock';
import '../modules/mods';
import { boot } from '../modules/shell';
import indexHtml from '../../index.html?raw';
import { clearForced, force, installForcing } from './force';
import { labProvider } from './provider';
import { storyById } from './registry';
import type { AppCtx, Forced, LabHx, State, Story } from './types';
import './lab.css';

const q = new URLSearchParams(location.search);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const frames = (n: number): Promise<void> => new Promise((r) => { const f = (): void => { if (--n <= 0) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });

function fail(msg: string): void {
  document.body.innerHTML = '<pre class="lab-fail" role="alert"></pre>';
  (document.querySelector('.lab-fail') as HTMLElement).textContent = msg;
  document.documentElement.dataset['labReady'] = 'error';
  (window as unknown as Record<string, unknown>)['__labError'] = msg;
}

const hx = (): LabHx => ({ state: state as unknown as Record<string, unknown>, setState: setState as unknown as LabHx['setState'], emit: emit as unknown as LabHx['emit'], ui, theme: themeApi, data: () => (window as unknown as { __labProvider: ReturnType<LabHx['data']> }).__labProvider, dock: getDockApi });

/** the physical key a character comes from on a US layout: the shell's keymap reads `code` */
const CODES: Record<string, string> = { ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', '[': 'BracketLeft', ']': 'BracketRight', '-': 'Minus', '=': 'Equal', ' ': 'Space', '`': 'Backquote', "'": 'Quote', '\\': 'Backslash' };
function codeOf(key: string): string {
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^\d$/.test(key)) return 'Digit' + key;
  return CODES[key] ?? key;
}
function appCtx(app: HTMLElement): AppCtx {
  const $ = (sel: string): HTMLElement => { const n = document.querySelector<HTMLElement>(sel); if (!n) throw new Error('lab: nothing matches ' + sel); return n; };
  return {
    hx: hx(), app, wait, $,
    async click(sel) { const n = $(sel); n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); n.click(); await wait(60); },
    async key(key, init = {}) { const t = document.activeElement ?? document.body; const code = codeOf(key); t.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init })); t.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, ...init })); await wait(60); }
  };
}

async function drawApp(st: State): Promise<void> {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(indexHtml)?.[1] ?? '';
  document.body.insertAdjacentHTML('afterbegin', body.replace(/<script[\s\S]*?<\/script>/g, ''));
  const provider = await labProvider(st.app?.provider);
  (window as unknown as Record<string, unknown>)['__labProvider'] = provider;
  setProvider(provider);
  await provider.ready;
  startGlance();
  ui.tooltip.enable();
  boot();
  const app = document.getElementById('hx-app') as HTMLElement;
  for (let i = 0; i < 100 && app.classList.contains('is-booting'); i++) await wait(20);
  await wait(250);
  if (st.app?.setup) await st.app.setup(appCtx(app));
}

async function drawStage(st: State): Promise<void> {
  const provider = await labProvider({});
  (window as unknown as Record<string, unknown>)['__labProvider'] = provider;
  setProvider(provider);
  await provider.ready;
  startGlance();
  ui.tooltip.enable();
  const stage = document.createElement('div');
  stage.id = 'hx-app';
  stage.className = 'ui-root lab-stage';
  stage.dataset['ground'] = st.ground === 'dock' ? 'dock' : st.ground ?? 'ground';
  document.body.appendChild(stage);
  await renderCell(st, stage);
}
async function renderCell(st: State, stage: HTMLElement): Promise<void> {
  stage.querySelector('.lab-cell')?.remove();
  const cell = document.createElement('div');
  cell.className = 'lab-cell';
  if (st.width) cell.style.width = st.width + 'px';
  stage.appendChild(cell);
  await st.render?.({ root: cell, ui, wait });
}

function applyForces(st: State): void {
  clearForced(document);
  for (const f of st.force ?? []) force(document, f.sel, f.state);
  const g = q.get('force') as Forced | null;
  if (g) force(scopeOf(currentStory as Story, st) ?? document, null, g);
}
let currentStory: Story | null = null;
/** a story of the v7 kit (src/lab/stories/kit/) */
const isKitStory = (s: Story): boolean => s.id.startsWith('kit/') || !!s.v7;
/** a preset id as a v7 theme: dark and light, or a v6 preset's scheme (bone is the light one) */
const v7Theme = (id: string | null): 'dark' | 'light' => (id === 'light' || id === 'bone' ? 'light' : 'dark');
function scopeOf(s: Story, st: State): Element | null {
  if (!st.app) return document.querySelector(st.scope ?? '.lab-stage');
  const sel = st.scope ?? s.scope ?? '#hx-app';
  return document.querySelector(sel);
}

export async function startFrame(): Promise<void> {
  const s = storyById(q.get('story') ?? '');
  const name = q.get('state') ?? '';
  const st = s?.states[name];
  if (!s || !st) { fail('No story "' + q.get('story') + '" with a state "' + name + '"'); return; }
  currentStory = s;
  document.title = s.title + ' · ' + name;
  const preset = q.get('preset');
  /* the v7 kit's stories (stories/kit/) draw on a v7 root: the body, so the v6 theme's inline colours on <html> stay
     underneath; their presets are v7's two themes (a v6 preset id maps to its scheme), with the accent and corners of
     section 18 settable by the checker */
  const v7 = isKitStory(s);
  /* a screen on the v7 kit (`v7: true`) that boots the app also puts the v6 theme in the same scheme, for the parts still on v6 */
  const v6Too = (id: string | null): void => { if (v7 && !s.id.startsWith('kit/')) themeApi.preset(v7Theme(id) === 'light' ? 'bone' : 'catalog'); };
  if (v7) { v6Too(preset); kit.applyTheme(document.body, { theme: v7Theme(preset) }); await Promise.all([loadFont('Geist'), loadFont('Geist Mono')]); }
  else if (preset) themeApi.preset(preset);
  const dir = q.get('dir') ?? st.dir;
  if (dir) document.documentElement.dir = dir;
  const zoom = Number(q.get('zoom') || '1');
  if (zoom !== 1) (document.documentElement.style as unknown as Record<string, string>)['zoom'] = String(zoom);
  await setupOrbs();
  ui.squircle.start();
  ui.scrollEdges.start();
  try {
    if (st.app) await drawApp(st); else await drawStage(st);
  } catch (e) { fail('The state failed to draw: ' + String((e as Error).stack ?? e)); return; }
  await document.fonts.ready;
  installForcing();
  applyForces(st);
  await frames(3);
  (window as unknown as Record<string, unknown>)['__lab'] = {
    story: s.id, state: name, area: s.area, kind: s.kind, app: !!st.app, tags: st.tags, overlay: st.overlay ?? null,
    interact: st.interact ?? [], allow: st.allow ?? {},
    scope: () => scopeOf(s, st),
    /** draws a stage state again into a fresh cell (the stability check); an app state is reloaded by the checker */
    async rerender(): Promise<void> { if (st.app) return; await renderCell(st, document.querySelector('.lab-stage') as HTMLElement); applyForces(st); await frames(3); },
    force: (sel: string | null, which: Forced, onOff = true) => force(scopeOf(s, st) ?? document, sel, which, onOff),
    clearForced: () => { clearForced(document); for (const f of st.force ?? []) force(document, f.sel, f.state); },
    preset: (id: string) => { if (v7) { v6Too(id); kit.applyTheme(document.body, { theme: v7Theme(id) }); } else themeApi.preset(id); },
    /** v7 only: a custom accent (section 18; null for the default Iris), corners B or C, light shadows A, B or C */
    ...(v7 ? {
      accent: (hex: string | null) => kit.applyTheme(document.body, { accent: hex }),
      corners: (c: 'b' | 'c') => kit.applyTheme(document.body, { radii: c }),
      shadow: (x: 'a' | 'b' | 'c') => kit.applyTheme(document.body, { shadow: x })
    } : {}),
    hx: { state, setState, on, emit, ui, theme: themeApi, dock: getDockApi, layout: getLayout }
  };
  document.documentElement.dataset['labReady'] = '1';
}
