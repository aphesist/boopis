/* boopis session tab. Registers `session` (#hx-view-session), `session-list` (#hx-list-session) and
   `session-right` (#hx-right).
   Emits: hx:attention {source:'session', count, tab}, hx:session-select {id, from:'list'}, hx:title, hx:governance.
   Provides: stop and find (the shell's mod+. and mod+F). Listens: hx:state, hx:open-panel, hx:new-session,
   hx:session-select, hx:nav. Every colour, family, radius and size is a token. */
import { register } from '../../core/registry';
import { mountView, newSession, selectSession } from './conversation';
import { mountList } from './list';
import { mountRight, openPanel } from './right';
import { ui } from '@boopis/ui';
/* drawn corners (DESIGN-SYSTEM.md section 8): the session's own surfaces take the library's continuous corner */
ui.squircle.auto('.ss-diff, .ssr-file, .ssr-term');

register('session', { mount: (root) => mountView(root) });
register('session-list', { mount: (root) => mountList(root) });
register('session-right', { mount: (root) => mountRight(root) });

export const session = { select: selectSession, newSession, openPanel };
