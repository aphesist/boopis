// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markOf, SIGNIN_BRANDS, signinButton, signinLabel } from './signin-marks';
import { brandOf } from '../host/signin-brands';
import { entries } from '../data/providers';

const VENDOR = join(__dirname, '..', 'vendor', 'signin-marks');
const pathsOf = (svg: string): string[] => [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1] ?? '');

const el = (o: Parameters<typeof signinButton>[0]): HTMLButtonElement => { const t = document.createElement('template'); t.innerHTML = signinButton(o); return t.content.firstElementChild as HTMLButtonElement; };

describe('the branded sign-in buttons (ADR-0040; 2b: the kit\'s Button led by the lab\'s mark)', () => {
  it('has one for each of the four labs, "Continue with <lab>", and the words are its accessible name', () => {
    expect(SIGNIN_BRANDS).toEqual(['chatgpt', 'github', 'claude', 'xai']);
    const names = SIGNIN_BRANDS.map((b) => {
      const e = el({ brand: b });
      expect(e.getAttribute('data-kit')).toBe('Button');
      expect(e.querySelector('.hx-sso__logo')?.getAttribute('aria-hidden'), 'the logo is hidden from screen readers: the words name the button').toBe('true');
      expect(e.querySelector('svg')).toBeTruthy();
      return e.textContent?.replace(/\s+/g, ' ').trim();
    });
    expect(names).toEqual(['Sign in with ChatGPT', 'Sign in with GitHub', 'Sign in with Claude', 'Sign in with xAI']);
    expect(signinLabel('chatgpt')).toBe('Sign in with ChatGPT');
  });
  it('is one shell: the same markup and class for every lab, so none is more prominent', () => {
    const shapes = new Set(SIGNIN_BRANDS.map((b) => el({ brand: b }).outerHTML.replace(/data-brand="\w+"/, '').replace(/<span class="hx-sso__logo"[\s\S]*?<\/span><span class="k7-btn__label">[^<]*<\/span>/, '')));
    expect(shapes.size).toBe(1);
  });
  it('draws ChatGPT, GitHub and Copilot from the labs\' own files, unmodified in their paths, in pure black and pure white', () => {
    for (const [key, black, white] of [['chatgpt', 'chatgpt-logo-black.svg', 'chatgpt-logo-white.svg'], ['github', 'github-invertocat-black.svg', 'github-invertocat-white.svg'], ['copilot', 'github-copilot-icon-black.svg', 'github-copilot-icon-white.svg']] as const) {
      const b = readFileSync(join(VENDOR, black), 'utf8');
      const w = readFileSync(join(VENDOR, white), 'utf8');
      const m = markOf(key) as { black: string; white: string };
      expect(pathsOf(m.black), key).toEqual(pathsOf(b));
      expect(pathsOf(m.white), key).toEqual(pathsOf(w));
      expect(m.black + m.white, 'never recoloured: no colour is added to the lab\'s file').not.toMatch(/#D97757/i);
    }
    const html = el({ brand: 'chatgpt' }).outerHTML;
    expect(html.match(/data-ink="/g)?.length, 'both inks are there; the preset shows the one that reads').toBe(2);
  });
  it('draws Claude from Anthropic\'s own file at its own colour, and xAI from its mark in flat black or white', () => {
    const claude = readFileSync(join(VENDOR, 'claude-logo.svg'), 'utf8');
    const m = markOf('claude') as { colour: string };
    expect(pathsOf(m.colour)).toEqual(pathsOf(claude));
    expect(m.colour).toMatch(/#D97757/i);
    const x = markOf('xai') as { black: string; white: string };
    expect(x.black).toContain('fill="black"');
    expect(x.white).toContain('fill="white"');
    expect(x.black.replace('fill="black"', '')).toBe(x.white.replace('fill="white"', ''));
  });
  it('says which ways carry one: the four sign-ins, never a key, never Gemini, never the grok program', () => {
    const ways = entries().flatMap((e) => e.ways);
    const branded = ways.filter((w) => brandOf(w.id)).map((w) => w.id);
    expect(branded.sort()).toEqual(['anthropic.signin', 'github-copilot.signin', 'openai.signin', 'xai.signin']);
    expect(brandOf('google.key')).toBeNull();
    expect(brandOf('xai.cli')).toBeNull();
    expect(brandOf('openai.key')).toBeNull();
  });
  it('is disabled with its words and no click', () => {
    const b = el({ brand: 'github', disabled: true });
    expect(b.disabled).toBe(true);
  });
});
