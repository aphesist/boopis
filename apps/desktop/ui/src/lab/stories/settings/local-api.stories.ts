/* Settings > General > Local API (ADR-0045, docs/LOCAL-API.md): the one switch that lets other apps on this computer (a shell's
   island, a script) read the bots, answer approvals and send messages. Drawn by `renderLocalApi` from a `LocalApiStatus`
   against a scripted bridge (the host is not in the lab): off (the default), on with its address and token file, with apps
   following, a long token path, the endpoint refused to start (the reason in words), and the switch, copy and rotate
   buttons hovered, focused and pressed. The token itself is in no state: no result holds it, only the path of its file. */
import { renderLocalApi } from '../../../modules/shell/local-api';
import type { LocalApiBridge, LocalApiStatus } from '../../../host/local-api';
import { fill, frames } from '../../story';
import type { Force, Render, State, Story } from '../../types';

const OFF: LocalApiStatus = { enabled: false, running: false, url: null, token_file: null, streams: 0, version: 1, problem: null };
const ON: LocalApiStatus = { enabled: true, running: true, url: 'http://127.0.0.1:47821', token_file: '/home/you/.local/share/dev.aphesist.boopis/client-token', streams: 0, version: 1, problem: null };
const LONG_PATH = '/home/someone-with-a-long-user-name/.local/share/dev.aphesist.boopis/with/a/deep/custom/data/folder/client-token';

const bridge = (s: LocalApiStatus): LocalApiBridge => ({ status: () => Promise.resolve(s), setEnabled: () => Promise.resolve(s), rotate: () => Promise.resolve(s) });

const draw = (s: LocalApiStatus): Render => async ({ root }) => {
  const cell = fill(root);
  const sec = document.createElement('div');
  sec.className = 'k7-section';
  sec.setAttribute('role', 'group'); sec.setAttribute('aria-labelledby', 'hx-set-local-api-h');
  cell.appendChild(sec);
  renderLocalApi(sec, s, bridge(s));
  await frames(2);
};

const force = (sel: string, state: Force['state']): readonly Force[] => [{ sel, state }];
const S = (tags: State['tags'], s: LocalApiStatus, extra: Partial<State> = {}): State => ({ tags, render: draw(s), width: 680, ...extra });

const story: Story = {
  id: 'settings/local-api', title: 'Local API (Settings, General)', area: 'settings', kind: 'component', v7: true, covers: [],
  states: {
    'off, the default': S(['typical', 'empty'], OFF),
    'on, with the address and the token file': S(['typical', 'variant'], ON),
    'on, two apps following': S(['variant'], { ...ON, streams: 2 }),
    'on, one app following': S(['variant'], { ...ON, streams: 1 }),
    'on, a long token path': S(['long'], { ...ON, token_file: LONG_PATH }),
    'on, a different port': S(['variant'], { ...ON, url: 'http://127.0.0.1:53114' }),
    'switched on but not started': S(['error'], { ...OFF, enabled: true, problem: 'The token file would be readable by other users, so the endpoint stays off.' }),
    'switched on, the address could not be opened': S(['error', 'long'], { ...OFF, enabled: true, problem: 'boopis could not open the endpoint: no address on this computer could be opened. Nothing is listening, and no token file was left behind.' }),
    'switch hover': S(['hover'], ON, { force: force('#hx-set-local-api', 'hover') }),
    'switch focus': S(['focus'], ON, { force: force('#hx-set-local-api', 'focus') }),
    'copy address hover': S(['hover'], ON, { force: force('#hx-local-api-copy-url', 'hover') }),
    'copy path focus': S(['focus'], ON, { force: force('#hx-local-api-copy-file', 'focus') }),
    'rotate pressed': S(['active'], ON, { force: force('#hx-local-api-rotate', 'active') })
  }
};

export default story;
