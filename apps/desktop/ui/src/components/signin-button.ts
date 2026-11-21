/* The branded sign-in button (the owner's decision of 21 November 2026: brand marks are allowed on sign-in buttons; ADR-0040).
   One shell for all four labs, from the research in the ADR: "Continue with <lab>", a logo of the lab's own, the same size and
   weight for every button so no lab looks more prominent (OpenAI, Google, Apple and X ask for equal prominence), a light style in
   the light presets and a dark style in the dark ones (the style is drawn by components.css from the preset's colour scheme).

   Marks are never recoloured. ChatGPT and GitHub are the labs' own files, pure black or white, kept unmodified in
   vendor/signin-marks (with their notes); the button shows the one that reads on the preset. Claude and xAI have no official
   button, and Anthropic's policy needs permission while xAI's page could not be read, so they draw the marks the app already
   ships for model names (vendor/model-icons, LobeHub, MIT). BRANDS is the one swap point: when the owner decides, a lab's
   mark changes here and nowhere else.

   Gemini has no sign-in in boopis (a key only) and is never drawn here: no Google "G", no "Sign in with Google" styling. */
import chatgptBlack from '../vendor/signin-marks/chatgpt-logo-black.svg?raw';
import chatgptWhite from '../vendor/signin-marks/chatgpt-logo-white.svg?raw';
import githubBlack from '../vendor/signin-marks/github-invertocat-black.svg?raw';
import githubWhite from '../vendor/signin-marks/github-invertocat-white.svg?raw';
import { esc } from '../core/dom';
import { markHTML } from './model-mark';

export type SigninBrand = 'chatgpt' | 'github' | 'claude' | 'xai';
export const SIGNIN_BRANDS: readonly SigninBrand[] = ['chatgpt', 'github', 'claude', 'xai'];

/** a flat black or white file as the lab published it: only the ids (which two buttons would share) and GitHub's clip to its own
    whole frame are left out; no path, colour or proportion is touched */
const plain = (svg: string): string => svg
  .replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/\sclip-path="[^"]*"/g, '').replace(/\sid="[^"]*"/g, '')
  .replace(/\spreserveAspectRatio="none"|\soverflow="visible"|\sstyle="[^"]*"/g, '').replace(/\swidth="\d+"/, '').replace(/\sheight="\d+"/, '').replace('<svg ', '<svg aria-hidden="true" focusable="false" ');

type Mark = { ink: 'file'; black: string; white: string } | { ink: 'family'; ref: string };
interface Def {
  /** the lab's name as the button says it ("Continue with ChatGPT") */
  name: string;
  mark: Mark;
}
/** The one swap point. `file` marks are the lab's own black and white files; `family` marks are the app's model marks. */
export const BRANDS: Readonly<Record<SigninBrand, Def>> = {
  chatgpt: { name: 'ChatGPT', mark: { ink: 'file', black: plain(chatgptBlack), white: plain(chatgptWhite) } },
  github: { name: 'GitHub', mark: { ink: 'file', black: plain(githubBlack), white: plain(githubWhite) } },
  claude: { name: 'Claude', mark: { ink: 'family', ref: 'claude' } },
  xai: { name: 'xAI', mark: { ink: 'family', ref: 'grok' } }
};

export interface SigninButtonOpts {
  brand: SigninBrand;
  /** the verb; "Continue" by default (OpenAI's own preferred string, allowed by Google and Apple) */
  verb?: string | undefined;
  disabled?: boolean | undefined;
  attrs?: Record<string, string | null | undefined> | undefined;
}

/** the words on the button, which also name it (label in name, R-a11y) */
export const signinLabel = (brand: SigninBrand, verb = 'Continue'): string => `${verb} with ${BRANDS[brand].name}`;

function logo(brand: SigninBrand): string {
  const m = BRANDS[brand].mark;
  if (m.ink === 'family') return markHTML(m.ref, { size: 20, color: 'brand', label: false });
  return `<span class="ui-sso__ink" data-ink="black">${m.black}</span><span class="ui-sso__ink" data-ink="white">${m.white}</span>`;
}

export function signinButton(o: SigninButtonOpts): string {
  const label = signinLabel(o.brand, o.verb);
  const extra = Object.entries(o.attrs ?? {}).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
  return `<button type="button" class="ui-sso" data-brand="${o.brand}"${o.disabled ? ' disabled' : ''}${extra}>` +
    `<span class="ui-sso__logo" aria-hidden="true">${logo(o.brand)}</span><span class="ui-sso__label">${esc(label)}</span></button>`;
}

export const signinVariants = { brand: SIGNIN_BRANDS, disabled: [false, true] } as const;
