/* The sign-in card every host-run sign-in shares (host/signin-card.ts, ADR-0030 and ADR-0039): ChatGPT's (the browser opens
   OpenAI's page and comes back, nothing to type) and GitHub Copilot's (a page and a one-time code), in every state a person
   sees: at its button, while the host starts, waiting, cancelled, expired, refused with a reason, signed in, and with a long
   reason. Drawn by the card itself against a scripted host (the host is not in the lab); the card is built from the kit's
   button and the design system's spacing and type tokens only. Settings > Models and first-run setup place it. */
import { CHATGPT_COPY } from '../../../host/chatgpt-signin';
import { COPILOT_COPY } from '../../../host/copilot-signin';
import { mountSigninCard } from '../../../host/signin-card';
import type { SigninBridge, SigninCopy, SigninEnd, SigninPage } from '../../../host/signin-card';
import { fill, frames } from '../../story';
import type { Force, Render, State, Story } from '../../types';

const OPENAI_PAGE = 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&state=lab';
const GITHUB_PAGE = 'https://example.com/login/device';
const LONG_PAGE = 'https://auth.openai.com/api/accounts/authorize/with/a/path/long/enough/to/wrap/on/a/phone/width/screen?client_id=x';
const FAR = (): number => Date.now() + 15 * 60000;

/** a host that does what the story says: start gives `page` (or never answers), and `end` is the event that follows */
function host(page: SigninPage | 'never'): SigninBridge & { end: (e: SigninEnd) => void } {
  let listener: ((e: SigninEnd) => void) | null = null;
  return {
    end: (e) => { listener?.(e); },
    waiting: () => Promise.resolve(null),
    start: () => (page === 'never' ? new Promise<SigninPage>(() => undefined) : Promise.resolve(page)),
    cancel: () => Promise.resolve(),
    onEnd: (cb) => { listener = cb; return Promise.resolve(() => { listener = null; }); },
    open: () => Promise.resolve(),
    copy: () => Promise.resolve()
  };
}

interface Plan {
  copy: SigninCopy;
  /** what the host gives when the person starts; `none` leaves the card at its button */
  page: SigninPage | 'never' | 'none';
  /** the event that ends the wait, if any */
  end?: SigninEnd;
  /** presses Copy after the page is up */
  copied?: boolean;
  /** the button to press after the page is up (cancel goes to the host, which answers with `end`) */
  rejects?: string;
}

const draw = (p: Plan): Render => async ({ root }) => {
  const bridge = host(p.page === 'none' || p.page === 'never' ? 'never' : p.page);
  if (p.rejects) bridge.start = () => Promise.reject(new Error(p.rejects));
  const cell = fill(root);
  cell.style.maxWidth = '608px';
  mountSigninCard(cell, bridge, p.copy);
  await frames(2);
  if (p.page === 'none' && !p.rejects) return;
  cell.querySelector<HTMLButtonElement>('[data-act="start"]')?.click();
  await frames(3);
  if (p.copied) { cell.querySelector<HTMLButtonElement>('[data-act="copy"]')?.click(); await frames(3); }
  if (p.end) { bridge.end(p.end); await frames(3); }
};

const chatgpt = (o: Partial<Plan> = {}): Plan => ({ copy: CHATGPT_COPY, page: { url: OPENAI_PAGE, code: '', expiresAt: FAR() }, ...o });
const copilot = (o: Partial<Plan> = {}): Plan => ({ copy: COPILOT_COPY, page: { url: GITHUB_PAGE, code: 'WDJB-MJHT', expiresAt: FAR() }, ...o });
const force = (sel: string, state: Force['state']): readonly Force[] => [{ sel, state }];
const S = (tags: State['tags'], plan: Plan, extra: Partial<State> = {}): State => ({ tags, render: draw(plan), ...extra });

const LONG_REASON = 'You are signed in to GitHub, but this account has no GitHub Copilot plan. Nothing was saved. Sign in with an account that has one, or ask whoever manages your organization’s Copilot seats to add you to it.';

const story: Story = {
  id: 'settings/signin-card', title: 'Sign-in card (ChatGPT, GitHub Copilot)', area: 'settings', kind: 'component', covers: [],
  states: {
    'chatgpt, at its button': S(['typical'], chatgpt({ page: 'none' })),
    'chatgpt, opening the page': S(['loading'], chatgpt({ page: 'never' })),
    'chatgpt, waiting on OpenAI’s page': S(['typical', 'variant'], chatgpt()),
    'chatgpt, a long address': S(['long'], chatgpt({ page: { url: LONG_PAGE, code: '', expiresAt: FAR() } })),
    'chatgpt, cancelled': S(['disabled'], chatgpt({ end: { outcome: 'cancelled', message: 'The sign-in was cancelled.' } })),
    'chatgpt, declined plan use': S(['error'], chatgpt({ end: { outcome: 'failed', message: 'You did not allow boopis to use your ChatGPT plan, so nothing was signed in.' } })),
    'chatgpt, timed out': S(['expired'], chatgpt({ end: { outcome: 'timed_out', message: 'Your browser did not come back to boopis in time, so nothing was signed in. Start again, and finish signing in on OpenAI’s page.' } })),
    'chatgpt, could not start': S(['error'], chatgpt({ page: 'none', rejects: 'boopis could not open the page your browser comes back to after signing in. Restart boopis and try again.' })),
    /* the host's plain words for a failure (wave 24): a network that does not reach OpenAI, and a failure inside boopis (the panic
       the owner saw on Windows, now one sentence; its text is in Settings, General, Diagnostics) */
    'chatgpt, could not reach OpenAI': S(['error'], chatgpt({ end: { outcome: 'failed', message: 'boopis could not reach OpenAI to sign you in. Check your internet connection or proxy, then try again. Nothing was saved.' } })),
    'chatgpt, a failure inside boopis': S(['error'], chatgpt({ end: { outcome: 'failed', message: 'Something went wrong inside boopis, and nothing was changed. Try again; if it happens again, the details are in Settings, General, Diagnostics.' } })),
    'chatgpt, the computer’s clock is wrong': S(['error', 'long'], chatgpt({ end: { outcome: 'failed', message: 'Your computer’s clock looks wrong, so boopis could not check OpenAI’s answer. Set the date and time to update automatically, then try again. Nothing was saved.' } })),
    'chatgpt, signed in': S(['success'], chatgpt({ end: { outcome: 'signed_in', message: '' } })),
    'chatgpt, open button hover': S(['hover'], chatgpt(), { force: force('[data-act="open"]', 'hover') }),
    'chatgpt, cancel focus': S(['focus'], chatgpt(), { force: force('[data-act="cancel"]', 'focus') }),
    'chatgpt, start pressed': S(['active'], chatgpt({ page: 'none' }), { force: force('[data-act="start"]', 'active') }),
    'copilot, at its button': S(['typical'], copilot({ page: 'none' })),
    'copilot, getting a code': S(['loading'], copilot({ page: 'never' })),
    'copilot, waiting with the code': S(['typical', 'variant'], copilot()),
    'copilot, code copied': S(['success', 'variant'], copilot({ copied: true })),
    'copilot, copy hover': S(['hover'], copilot(), { force: force('[data-act="copy"]', 'hover') }),
    'copilot, open focus': S(['focus'], copilot(), { force: force('[data-act="open"]', 'focus') }),
    'copilot, code expired': S(['expired'], copilot({ end: { outcome: 'timed_out', message: 'The code expired before the sign-in finished. Start again for a new code.' } })),
    'copilot, declined on GitHub': S(['disabled'], copilot({ end: { outcome: 'cancelled', message: 'You declined the sign-in on GitHub.' } })),
    'copilot, rate limited': S(['error'], copilot({ page: 'none', rejects: 'GitHub is limiting sign-in requests right now. Wait a minute and try again.' })),
    'copilot, no Copilot plan (a long reason)': S(['error', 'long'], copilot({ end: { outcome: 'failed', message: LONG_REASON } })),
    'copilot, the network answered instead': S(['error'], copilot({ page: 'none', rejects: 'Something on your network answered in place of the sign-in service (a firewall, a proxy or a security check). Check your proxy settings, or try again on another network. Nothing was saved.' })),
    'copilot, signed in': S(['success'], copilot({ end: { outcome: 'signed_in', message: '' } }))
  }
};

export default story;
