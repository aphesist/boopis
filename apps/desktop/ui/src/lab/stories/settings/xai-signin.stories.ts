/* The SuperGrok sign-in card (ADR-0039, host/xai-signin.ts), in every state it has: its button, the wait for a code, the code and
   xAI's page, signed in, cancelled, a code that lapsed, a declined page, a refused account (xAI's tier gate), a rate limit, a long
   message, and a view drawn again while a code waits. It is drawn by the card's own code against a scripted bridge (the host is
   not in the lab); it is built from the kit's buttons only, as the ChatGPT card is. */
import { mountXaiSignin } from '../../../host/xai-signin';
import type { ProviderSigninEvent, SigninBridge, SigninCode } from '../../../host/xai-signin';
import { fill, frames } from '../../story';
import type { Render, State, Story } from '../../types';

const NOW = Date.UTC(2026, 10, 21, 9, 0, 0);
const CODE: SigninCode = { verification_url: 'https://accounts.x.ai/oauth2/device?user_code=QMJM-H3XJ', user_code: 'QMJM-H3XJ', expires_at: NOW + 30 * 60_000 };
const LONG_CODE: SigninCode = { verification_url: 'https://accounts.x.ai/oauth2/device/with/a/page/path/that/is/much/longer/than/the/card/is/wide?user_code=QMJM-H3XJ-QMJM-H3XJ', user_code: 'QMJM-H3XJ-QMJM-H3XJ', expires_at: NOW + 30 * 60_000 };

interface Script { code?: SigninCode | Error | 'never'; waiting?: SigninCode; end?: ProviderSigninEvent; cancel?: boolean }

/** a scripted host: `send` is the event the host pushes when the sign-in ends */
function bridge(s: Script): SigninBridge & { send(e: ProviderSigninEvent): void } {
  let listener: ((e: ProviderSigninEvent) => void) | null = null;
  return {
    send: (e) => { listener?.(e); },
    waiting: () => Promise.resolve(s.waiting ?? null),
    start: () => (s.code instanceof Error ? Promise.reject(s.code) : s.code === 'never' ? new Promise<SigninCode>(() => undefined) : Promise.resolve(s.code ?? CODE)),
    cancel: () => { listener?.({ way: 'xai.signin', outcome: 'cancelled', message: 'The sign-in was cancelled.' }); return Promise.resolve(); },
    signOut: () => Promise.reject(new Error('not drawn')),
    onEnd: (cb) => { listener = cb; return Promise.resolve(() => { listener = null; }); },
    open: () => Promise.resolve(),
    copy: () => Promise.resolve(),
  };
}
const ev = (outcome: string, message = ''): ProviderSigninEvent => ({ way: 'xai.signin', outcome, message });
const click = (host: HTMLElement, act: string): void => { host.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)?.click(); };

/** draw the card, press its button, and then end the sign-in the way the script says */
const draw = (s: Script, o: { press?: boolean } = {}): Render => async ({ root }) => {
  const b = bridge(s);
  const host = document.createElement('div');
  fill(root, host);
  mountXaiSignin(host, b, { now: () => NOW });
  await frames(3);
  if (o.press ?? true) { click(host, 'start'); await frames(4); }
  if (s.end) { b.send(s.end); await frames(3); }
  if (s.cancel) { click(host, 'cancel'); await frames(3); }
};

const WIDTH = 480;
const state = (tags: State['tags'], render: Render, extra: Partial<State> = {}): State => ({ tags, render, width: WIDTH, ...extra });

const story: Story = {
  id: 'settings/xai-signin', title: 'Sign-in card: SuperGrok', area: 'settings', kind: 'card', covers: [], mock: { url: '/v6/__index.html', note: 'the mock has no sign-in card; it is the ChatGPT card with xAI\'s words' },
  states: {
    'its button': state(['typical', 'empty'], draw({}, { press: false })),
    'getting a code': state(['loading'], draw({ code: 'never' })),
    'the code and the page': state(['typical'], draw({})),
    'a long page and code': state(['long'], draw({ code: LONG_CODE })),
    'drawn again while a code waits': state(['variant'], draw({ waiting: CODE })),
    'cancelled': state(['disabled'], draw({ cancel: true })),
    'the code lapsed': state(['expired'], draw({ end: ev('timed_out', 'The code expired before the sign-in finished. Start again for a new code.') })),
    'declined on xAI\'s page': state(['error'], draw({ end: ev('failed', 'The sign-in was declined on xAI’s page.') })),
    'refused: xAI\'s tier gate': state(['error'], draw({ end: ev('failed', 'xAI did not allow this account to use the SuperGrok sign-in. It does this for some plans whatever the subscription says; an xAI API key works instead') })),
    'no code: rate limited': state(['error'], draw({ code: new Error('xAI is limiting sign-in requests right now. Wait a minute and try again.') })),
    'long message': state(['long', 'error'], draw({ code: new Error('could not reach xAI’s sign-in service (connection refused); check your internet connection. ' + 'Nothing was saved and nothing was sent. '.repeat(4)) })),
    'signed in': state(['success'], draw({ end: ev('signed_in') })),
  }
};
export default story;
