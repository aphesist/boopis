/* The branded sign-in button (the owner's decision of 21 November 2026: brand marks are allowed on sign-in buttons; ADR-0040).
   One shell for all four labs, from the research in the ADR: "Continue with <lab>", the lab's own logo, the same size and weight
   for every button so no lab looks more prominent (OpenAI, Google, Apple and X ask for equal prominence).

   Two styles, one component, and the owner's choice is one line (`SIGNIN_STYLE`):
   - `themed`: the shell drawn from the preset's tokens (a light button in the light presets, a dark one in the dark ones);
   - `brand`: each button coloured the way its lab makes it (OpenAI's black and white formats, Anthropic's sample colours).
   Marks are never recoloured: the labs' own files, unmodified in vendor/signin-marks (with their notes). ChatGPT, GitHub and xAI
   are flat black or white (the button shows the one that reads); Claude keeps #D97757. The xAI mark is a faithful vector of the
   slashed X, not an xAI file (their page answered 403): replace the file when xAI supplies one. `markOf` is the one place that
   names the files.

   Gemini has no sign-in in boopis (a key only) and is never drawn here: no Google "G", no "Sign in with Google" styling. */
import chatgptBlack from '../vendor/signin-marks/chatgpt-logo-black.svg?raw';
import chatgptWhite from '../vendor/signin-marks/chatgpt-logo-white.svg?raw';
import githubBlack from '../vendor/signin-marks/github-invertocat-black.svg?raw';
import githubWhite from '../vendor/signin-marks/github-invertocat-white.svg?raw';
import claudeLogo from '../vendor/signin-marks/claude-logo.svg?raw';
import xaiLogo from '../vendor/signin-marks/xai-logo.svg?raw';
import { esc } from '../core/dom';

export type SigninBrand = 'chatgpt' | 'github' | 'claude' | 'xai';
export const SIGNIN_BRANDS: readonly SigninBrand[] = ['chatgpt', 'github', 'claude', 'xai'];
export type SigninStyle = 'themed' | 'brand';
export const SIGNIN_STYLES: readonly SigninStyle[] = ['themed', 'brand'];
/** THE ONE LINE: which style every sign-in button is drawn in. */
export const SIGNIN_STYLE: SigninStyle = 'themed';

/** a flat file as the lab published it: only the ids (which two buttons would share), a clip to the file's own whole frame and the
    size are left out; no path, colour or proportion is touched. `crop` is the mark's own box when the file has a margin. */
const plain = (svg: string, crop?: string): string => {
  let out = svg.replace(/<\?xml[^>]*\?>|<!--[\s\S]*?-->/g, '').replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/\s(clip-path|id|style|x|y|preserveAspectRatio|overflow|xml:space|enable-background)="[^"]*"/g, '')
    .replace(/\swidth="[\d.]+(px)?"/, '').replace(/\sheight="[\d.]+(px)?"/, '').replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
  if (crop) out = out.replace(/viewBox="[^"]*"/, `viewBox="${crop}"`);
  return out;
};
const XAI_CROP = '201.61 56.91 438.67 481.45';
const xai = (colour: 'black' | 'white'): string => plain(xaiLogo, XAI_CROP).replace('<svg ', `<svg fill="${colour}" `);

type Mark = { black: string; white: string } | { colour: string };
/** The one swap point: the marks, by key. `copilot` is the GitHub Copilot icon (the hub's Copilot tile); the others are the sign-in
    buttons'. A lab's file changes here and nowhere else. */
const MARKS: Readonly<Record<SigninBrand, Mark>> = {
  chatgpt: { black: plain(chatgptBlack), white: plain(chatgptWhite) },
  github: { black: plain(githubBlack), white: plain(githubWhite) },
  claude: { colour: plain(claudeLogo) },
  xai: { black: xai('black'), white: xai('white') }
};
const NAMES: Readonly<Record<SigninBrand, string>> = { chatgpt: 'ChatGPT', github: 'GitHub', claude: 'Claude', xai: 'xAI' };
export const markOf = (key: SigninBrand): Mark => MARKS[key];


export interface SigninButtonOpts {
  brand: SigninBrand;
  /** the verb; "Continue" by default (OpenAI's own preferred string, allowed by Google and Apple) */
  verb?: string | undefined;
  /** the style; `SIGNIN_STYLE` by default */
  style?: SigninStyle | undefined;
  disabled?: boolean | undefined;
  attrs?: Record<string, string | null | undefined> | undefined;
}

/** the words on the button, which also name it (label in name, R-a11y) */
export const signinLabel = (brand: SigninBrand, verb = 'Continue'): string => `${verb} with ${NAMES[brand]}`;

/** a lab's logo as markup: both inks for a black-or-white file (the preset shows the one that reads), or the mark's own colour */
export function signinMark(key: SigninBrand): string {
  const m = MARKS[key];
  if ('colour' in m) return `<span class="ui-sso__ink" data-ink="colour">${m.colour}</span>`;
  return `<span class="ui-sso__ink" data-ink="black">${m.black}</span><span class="ui-sso__ink" data-ink="white">${m.white}</span>`;
}

export function signinButton(o: SigninButtonOpts): string {
  const label = signinLabel(o.brand, o.verb);
  const extra = Object.entries(o.attrs ?? {}).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
  return `<button type="button" class="ui-sso" data-sq data-sq-mode="clip" data-brand="${o.brand}" data-style="${o.style ?? SIGNIN_STYLE}"${o.disabled ? ' disabled' : ''}${extra}>` +
    `<span class="ui-sso__logo" aria-hidden="true">${signinMark(o.brand)}</span><span class="ui-sso__label">${esc(label)}</span></button>`;
}

export const signinVariants = { brand: SIGNIN_BRANDS, style: SIGNIN_STYLES, disabled: [false, true] } as const;
