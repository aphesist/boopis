/* SidebarFoot (board 12 and K02, kit.css `.foot-ctl` in the open sidebar): you at the start, Store and Settings at the end. */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const foot = (name = 'you', account = true): HTMLElement => kit.sidebarFoot({ name, account });
export default {
  id: 'kit/sidebar-foot', title: 'SidebarFoot', area: 'shell', kind: 'component', covers: ['kit.sidebarFoot'],
  states: {
    typical: stage(['typical', 'owner'], ({ root }) => { fill(root, foot()); }, { width: 268 }),
    'you hovered': stage(['hover'], ({ root }) => { fill(root, foot()); }, { width: 268, force: [{ sel: '.k7-sfoot__me', state: 'hover' }] }),
    'you focused': stage(['focus'], ({ root }) => { fill(root, foot()); }, { width: 268, force: [{ sel: '.k7-sfoot__me', state: 'focus' }] }),
    'Store hovered, Settings pressed': stage(['hover', 'active'], ({ root }) => { fill(root, foot()); }, { width: 268, force: [{ sel: '[data-kit~="IconButton"]:nth-of-type(2)', state: 'hover' }, { sel: '[data-kit~="IconButton"]:last-child', state: 'active' }] }),
    'the account menu open': stage(['open'], ({ root }) => { const f = foot(); f.querySelector('.k7-sfoot__me')?.setAttribute('aria-expanded', 'true'); fill(root, f); }, { width: 268 }),
    'a long name': stage(['long'], ({ root }) => { fill(root, foot('cassiopeia of the staging deploy guardians')); }, { width: 268 }),
    'the Sessions side: no account': stage(['variant'], ({ root }) => { fill(root, foot('you', false)); }, { width: 268 }),
    narrow: stage(['size'], ({ root }) => { fill(root, foot('a long name here')); }, { width: 180 })
  }
} satisfies Story;
