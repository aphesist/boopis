/* hypotaxis session tab. Registers `session` (#hx-view-session), `session-list` (#hx-list-session) and
   `session-right` (#hx-right).
   Emits: hx:attention {source:'session', count, tab}, hx:session-select {id, from:'list'}, hx:title, hx:governance.
   Provides: stop and find (the shell's mod+. and mod+F). Listens: hx:state, hx:open-panel, hx:new-session,
   hx:session-select, hx:nav. Every colour, family, radius and size is a token. */
import './session.css';
import { register } from '../../core/registry';
import { mountView, newSession, selectSession } from './conversation';
import { mountList } from './list';
import { mountRight, openPanel } from './right';

register('session', { mount: (root) => mountView(root) });
register('session-list', { mount: (root) => mountList(root) });
register('session-right', { mount: (root) => mountRight(root) });

export const session = { select: selectSession, newSession, openPanel };
