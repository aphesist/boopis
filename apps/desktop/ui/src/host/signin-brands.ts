/* Which ways of the catalogue get a branded sign-in button (ADR-0040): ChatGPT (`openai.signin`), GitHub for Copilot
   (`github-copilot.signin`), xAI's SuperGrok (`xai.signin`) and Claude Code's own login (`anthropic.signin`). Everything else
   keeps the plain button: a key row says "Add key", Gemini is a key and never gets the Google mark, and the grok program
   (`xai.cli`) is not a sign-in of xAI's but a program the person runs. The buttons themselves are the kit's (`ui.signinButton`). */
import type { SigninBrand } from '@boopis/ui';

const BRAND_OF: Readonly<Record<string, SigninBrand>> = {
  'openai.signin': 'chatgpt',
  'github-copilot.signin': 'github',
  'xai.signin': 'xai',
  'anthropic.signin': 'claude'
};

/** the brand a way's sign-in button carries, or null */
export const brandOf = (wayId: string): SigninBrand | null => BRAND_OF[wayId] ?? null;
