/* The v7 look a person chooses in Settings › Appearance (board 14: Theme, Accent, Corners). The accent's shades are derived per theme
   (kit theme.ts `deriveAccent`, DESIGN-SYSTEM.md v7 18) and the rounder corners are the tokens' own `data-radii="c"` values, read once
   from the tokens; both are written as one stylesheet after the tokens, over every v7 root (the app's surfaces, its menus and
   dialogs, the dock), with the tokens' own selectors. Iris and the standard corners are the tokens themselves: nothing is written.
   "Follow system" follows the system's light or dark through the theme's own switch (`setState({ theme })`). */
import { ACCENTS, loadLook, saveLook } from '../core/settings';
import type { LookPrefs } from '../core/settings';
import { kit } from '@boopis/ui';

const RADII = ['--r-bubble', '--r-dialog', '--r-menu', '--r-card', '--r-tile', '--r-field', '--r-nav', '--r-tip', '--r-composer'] as const;
const DARK = '[data-ui="v7"], [data-ui="v7"][data-theme="dark"], [data-ui="v7"] [data-theme="dark"]';
const LIGHT = '[data-ui="v7"][data-theme="light"], [data-ui="v7"] [data-theme="light"]';

/** the rounder corners as the tokens set them (`[data-radii="c"]`), read from a probe; empty where no stylesheet is loaded */
function rounder(): string {
  if (typeof document === 'undefined' || !document.body) return '';
  const probe = document.createElement('div');
  probe.setAttribute('data-ui', 'v7'); probe.setAttribute('data-radii', 'c'); probe.hidden = true;
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const decl = RADII.map((k) => [k, cs.getPropertyValue(k).trim()] as const).filter(([, v]) => v).map(([k, v]) => k + ':' + v).join(';');
  probe.remove();
  return decl;
}

/** the stylesheet for a look; '' for the tokens' own (Iris, standard corners) */
export function lookCSS(p: Pick<LookPrefs, 'accent' | 'corners'>, radii = rounder): string {
  const out: string[] = [];
  const a = ACCENTS.find((x) => x.id === p.accent);
  if (a && a.id !== 'iris') {
    const decl = (m: 'dark' | 'light'): string => Object.entries(kit.deriveAccent(a.hex, m)).map(([k, v]) => k + ':' + v).join(';');
    out.push(DARK + '{' + decl('dark') + '}', LIGHT + '{' + decl('light') + '}');
  }
  if (p.corners === 'rounder') { const d = radii(); if (d) out.push('[data-ui="v7"], [data-ui="v7"] [data-theme]{' + d + '}'); }
  return out.join('\n');
}

let mq: MediaQueryList | null = null;
let follow: ((scheme: 'dark' | 'light') => void) | null = null;
const onSystem = (): void => { if (mq && follow) follow(mq.matches ? 'light' : 'dark'); };
/** write the look (the stylesheet, and following the system or not); `setScheme` is the theme's switch */
export function applyLook(p: LookPrefs = loadLook(), setScheme?: (scheme: 'dark' | 'light') => void): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('hx-v7-look') as HTMLStyleElement | null;
  const css = lookCSS(p);
  if (!css) el?.remove();
  else { if (!el) { el = document.createElement('style'); el.id = 'hx-v7-look'; } document.head.appendChild(el); el.textContent = css; }
  if (setScheme) follow = setScheme;
  if (typeof matchMedia !== 'function') return;
  mq ??= matchMedia('(prefers-color-scheme: light)');
  mq.removeEventListener('change', onSystem);
  if (p.followSystem) { mq.addEventListener('change', onSystem); onSystem(); }
}
/** keep a change and write it */
export function setLook(patch: Partial<LookPrefs>): LookPrefs {
  const next = { ...loadLook(), ...patch };
  saveLook(next);
  applyLook(next);
  return next;
}
