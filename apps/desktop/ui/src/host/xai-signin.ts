/* The SuperGrok sign-in card (ADR-0039): boopis's own sign-in with an X or xAI account. It is the shared sign-in card
   (`signin-card.ts`, the one ChatGPT's and Copilot's use too) with xAI's words: the host asks xAI for a one-time code and
   waits; the card shows xAI's page as a button that opens the system browser (the code is already in the page's address) and the
   code in large mono with a copy button, says that it is waiting, and offers Cancel. The tokens stay in the host and its keychain:
   nothing here ever holds one. Used by first-run setup and, through `registerSigninCard`, by Settings > Models. */
import { mountSigninCard, minutesLeft, providerSigninBridge } from './signin-card';
import type { SigninBridge, SigninCopy, SigninEnd, SigninOptions, SigninPage } from './signin-card';

export type { SigninBridge, SigninEnd, SigninOptions, SigninPage };

/** the catalogue's way for this sign-in (`apps/shared/data/providers.json`) */
export const XAI_WAY = 'xai.signin';

/** xAI's words, as `SigninCopy` (the mapping `signin-card.ts` documents for a lab that wrote them as start, open, warning and done) */
export const XAI_COPY: SigninCopy = {
  provider: 'xai',
  brand: 'xai',
  button: 'Sign in with SuperGrok',
  starting: 'Getting a code…',
  explain: () => 'Open xAI’s sign-in page, sign in with your X or xAI account and approve it. The page already has the code; if it asks, type this one.',
  caution: (page, now) => {
    const left = minutesLeft(page.expiresAt, now);
    return (left === null ? '' : `The code works for ${String(left)} minutes. `) + `Approve it only on ${new URL(page.url).hostname}, and only if you started this sign-in in boopis.`;
  },
  done: 'Signed in with SuperGrok.',
  gave: 'xAI gave no code.'
};

/** the card's bridge over the host's `provider_signin_*` commands for `xai.signin` */
export const tauriXaiBridge = (): SigninBridge => providerSigninBridge(XAI_WAY);

/** Put the SuperGrok sign-in card into `host`. */
export const mountXaiSignin = (host: HTMLElement, bridge: SigninBridge, opts: SigninOptions = {}): { destroy: () => void } =>
  mountSigninCard(host, bridge, XAI_COPY, opts);
