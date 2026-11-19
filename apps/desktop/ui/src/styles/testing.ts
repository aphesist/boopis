/* For the unit tests: jsdom has no stylesheet, so a token resolves to nothing. This reads a preset's own colours out of tokens.css
   (the one source) and puts them on the page as a stylesheet, so the contrast guard reads what a browser would. */
import { readFileSync } from 'node:fs';

/* the tests run from the ui folder (vitest's root) */
const tokens = readFileSync('src/styles/tokens.css', 'utf8');

const HEX = /^#[0-9a-f]{6}$/i;
/** the solid #rrggbb tokens of one preset block of tokens.css */
export function presetTokens(id: 'catalog' | 'graphite' | 'bone' | 'typewriter'): Record<string, string> {
  const head = id === 'catalog' ? ':root, [data-hx-preset="catalog"] {' : '[data-hx-preset="' + id + '"] {';
  const at = tokens.indexOf(head);
  if (at < 0) throw new Error('tokens.css has no block for the ' + id + ' preset');
  const body = tokens.slice(at + head.length, tokens.indexOf('\n}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;/]+?)\s*;/gim)) if (HEX.test(m[2] ?? '')) out[m[1] ?? ''] = (m[2] ?? '').toLowerCase();
  return out;
}
/** lays a preset's colours on the page as `:root { ... }`; returns the way to take them off again */
export function installPreset(id: 'catalog' | 'graphite' | 'bone' | 'typewriter' = 'catalog'): () => void {
  const style = document.createElement('style');
  style.textContent = ':root { ' + Object.entries(presetTokens(id)).map(([k, v]) => k + ': ' + v + ';').join(' ') + ' }';
  document.head.append(style);
  return () => { style.remove(); };
}
