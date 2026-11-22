/* What several scenes share: the bar grid, boopis's own bot roster (the app's mock roster: names, roles, shapes and
   colours), orbs, the pointer, sound cues, and small layout helpers. */
import { el, frag } from './stage';
import { SPRING, EASE, clamp, lerp } from './motion';

export const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4;
/** the start of bar n (1-based) */
export const bar = (n: number): number => (n - 1) * BAR;

export interface BotSpec { id: string; name: string; role: string; shape: string; color: string; state: string }
/* the eleven bots of the owner's dock (src/data/mock-data.ts BOT_SEEDS) */
export const BOTS: Record<string, BotSpec> = Object.fromEntries(([
  ['atlas', 'reviewer', 'circle', '#efece6', 'idle'],
  ['nina', 'deploys', 'triangle', '#f23b5a', 'needs'],
  ['kai', 'docs and changelog', 'circle', '#4fc9a8', 'working'],
  ['iris', 'design QA', 'flower', '#3b82f6', 'idle'],
  ['hex', 'security review', 'hexagon', '#a6a6ab', 'sleeping'],
  ['sol', 'night shift', 'circle', '#f5a337', 'idle'],
  ['noct', 'on-call', 'circle', '#1c1c24', 'happy'],
  ['terra', 'data migrations', 'drop', '#c4834a', 'thinking'],
  ['nimbus', 'inbox triage', 'cloud', '#9b5cf6', 'idle'],
  ['vox', 'release notes', 'circle', '#6d5cf0', 'compute'],
  ['moss', 'flaky test hunter', 'squircle', '#2fd26a', 'speaking']
] as const).map(([id, role, shape, color, state]) => [id, { id, name: id, role, shape, color, state }]));
export const ROSTER = ['atlas', 'nina', 'kai', 'iris', 'hex', 'sol', 'noct', 'terra', 'nimbus', 'vox', 'moss'];

export interface Orb extends HTMLElement { react(s: string): void; poke(f?: number): void; blink(): void; lookAt(x?: number, y?: number): void; emote(n: string): void }
const dark = (hex: string): boolean => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! < 0.05; };
/** an orb as the app draws it (<orb-avatar>, calm idle, eyes from the state), rendered at `size` px; a wrapper to move */
export function orb(id: string, size: number, o: { state?: string; motion?: string; mode?: string } = {}): { wrap: HTMLElement; orb: Orb } {
  const b = BOTS[id]!;
  const wrap = el('div', 'orbw');
  wrap.style.width = wrap.style.height = size + 'px';
  wrap.innerHTML = `<orb-avatar size="${size}" shape="${b.shape}" color="${b.color}"${dark(b.color) ? ' eye-color="var(--ink-on-dock)"' : ''} reaction="${o.state ?? b.state}" idle-motion="${o.motion ?? 'calm'}" mode="${o.mode ?? 'drift'}" label="${b.name}" aria-hidden="true"></orb-avatar>`;
  const orbEl = wrap.firstElementChild as Orb;
  return { wrap, orb: orbEl };
}
/** call an orb method once it is upgraded */
export const call = (o: Orb, m: keyof Orb, ...a: unknown[]): void => { const f = (o as unknown as Record<string, unknown>)[m as string]; if (typeof f === 'function') { try { (f as (...x: unknown[]) => unknown).apply(o, a); } catch (e) { console.error(e); } } };

/* ───────── sound cues: every scene says what should sound when, the score reads them (render.mjs --cues) ───────── */
export interface Cue { at: number; kind: string; [k: string]: unknown }
const W = window as unknown as { __sfx?: Cue[] };
W.__sfx = W.__sfx ?? [];
const seen = new Set<string>();
export function sfx(at: number, kind: string, p: Record<string, unknown> = {}): void {
  const key = at.toFixed(4) + kind + JSON.stringify(p);
  if (seen.has(key)) return; seen.add(key);
  W.__sfx!.push({ at: +at.toFixed(4), kind, ...p });
}

/* ───────── the pointer: a hand the film moves along keyed points, with a press and a brass ring on each click ───────── */
export interface Key { t: number; x: number; y: number }
export function pointer(parent: HTMLElement): { el: HTMLElement; update(t: number, keys: Key[], clicks: number[], show?: [number, number]): void } {
  const p = el('div', 'pointer', parent, '<div class="pointer__ring"></div><svg width="34" height="34" viewBox="0 0 34 34"><path d="M6 3 L6 27 L12.5 21 L17 31 L21 29.2 L16.6 19.6 L25 19.6 Z" fill="var(--text-strong)" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  const ring = p.querySelector('.pointer__ring') as HTMLElement, svg = p.querySelector('svg') as SVGElement;
  return {
    el: p,
    update(t, keys, clicks, show) {
      let x = keys[0]!.x, y = keys[0]!.y;
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1]!, b = keys[i]!;
        if (t >= a.t && t <= b.t) { const q = SPRING(clamp((t - a.t) / Math.max(0.001, b.t - a.t))); x = lerp(a.x, b.x, q); y = lerp(a.y, b.y, q); break; }
        if (t > b.t) { x = b.x; y = b.y; }
      }
      let press = 0, ringP = -1;
      for (const c of clicks) { const d = t - c; if (d >= 0 && d < 0.18) press = Math.sin((d / 0.18) * Math.PI); if (d >= 0 && d < 0.5) ringP = d / 0.5; }
      const vis = show ? t >= show[0] && t < show[1] : true;
      const fade = show ? Math.min(clamp((t - show[0]) / 0.2), 1 - clamp((t - (show[1] - 0.2)) / 0.2)) : 1;
      p.style.visibility = vis ? 'visible' : 'hidden';
      p.style.opacity = String(fade);
      p.style.transform = `translate(${x - 6}px, ${y - 3}px)`;
      svg.style.transform = `scale(${1 - press * 0.12})`;
      svg.style.transformOrigin = '6px 3px';
      if (ringP >= 0) { ring.style.opacity = String(1 - EASE(ringP)); ring.style.transform = `translate(6px, 3px) scale(${0.5 + EASE(ringP) * 0.9})`; } else ring.style.opacity = '0';
    }
  };
}

/** a plate (a piece of the app on its ground) of a given width, holding `child` */
export function plate(parent: HTMLElement, w: number, cls = '', pad = 24): HTMLElement {
  const p = el('div', 'plate ' + cls, parent);
  p.style.width = w + 'px'; p.style.padding = pad + 'px'; p.style.boxSizing = 'border-box';
  return p;
}
export { frag };

/** orbs inside a plate that is scaled by `k`: draw each at its final size and scale it back, so it stays sharp */
export function crispOrbs(root: Element, k: number): void {
  root.querySelectorAll('orb-avatar').forEach((o) => {
    const e = o as HTMLElement;
    if (e.dataset['crisp']) return;
    const s = +(e.getAttribute('size') ?? 20);
    e.dataset['crisp'] = String(s);
    e.setAttribute('size', String(Math.round(s * k)));
    e.style.transformOrigin = '0 0';
    e.style.transform = `scale(${1 / k})`;
    e.style.width = e.style.height = Math.round(s * k) + 'px';
  });
}
/** an orb as the conversation's call number draws it (20px) next to a name, as an HTML string */
export function whoHTML(id: string, size = 20): string {
  const b = BOTS[id]!;
  return `<span class="ui-orb" style="--o:${size}"><orb-avatar size="${size}" shape="${b.shape}" color="${b.color}"${dark(b.color) ? ' eye-color="var(--ink-on-dock)"' : ''} reaction="idle" idle-motion="calm" mode="drift" aria-hidden="true"></orb-avatar></span><span class="bt-who-name">${b.name}</span>`;
}
