/* Notice (21.2 row 12; LAB-v7: above the composer, in a page, floating; neutral, amber, accent, red; 0, 1, 2 actions; with x; long
   text (truncate); enter, rest, dismiss focus). */
import { kit } from '@boopis/ui';
import { fill, forced, line, stage } from '../../story';
import type { Story } from '../../types';

const tones = stage(['typical', 'variant'], ({ root }) => {
  fill(root, kit.notice({ text: 'Copied the link', place: 'page' }));
  fill(root, kit.notice({ text: 'Approaching the weekly limit, 81% used, resets Wed 09:00', tone: 'owe', place: 'composer', actions: [{ label: 'Get more usage' }], dismiss: true }));
  fill(root, kit.notice({ text: 'boopis 0.2.0 is ready', tone: 'accent', icon: 'spark', actions: [{ label: 'Later' }, { label: 'Restart', primary: true }] }));
  fill(root, kit.notice({ text: 'The engine stopped', tone: 'red', actions: [{ label: 'Start it again' }] }));
}, { width: 640 });
export default {
  id: 'kit/notice', title: 'Notice', area: 'components', kind: 'component', covers: ['kit.notice'],
  states: {
    typical: tones,
    floating: stage(['variant'], ({ root }) => { line(root, kit.notice({ text: 'Copied the link', place: 'floating', actions: [{ label: 'Undo' }] })); }),
    enter: stage(['variant'], ({ root }) => { line(root, kit.notice({ text: 'Saved', place: 'floating', attrs: { 'data-enter': '' } })); }),
    ...forced(stage(['typical'], ({ root }) => { fill(root, kit.notice({ text: 'Approaching the weekly limit', tone: 'owe', dismiss: true })); }, { width: 640 }), '[data-kit~="IconButton"]'),
    error: stage(['error'], ({ root }) => { fill(root, kit.notice({ text: 'Could not reach the provider', tone: 'red', actions: [{ label: 'Try again' }], dismiss: true })); }, { width: 640 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.notice({ text: 'Approaching the weekly limit of every model you use across every session and bot, 81% used, resets Wednesday at 09:00', tone: 'owe', actions: [{ label: 'Get more usage' }], dismiss: true })); }, { width: 480 })
  }
} satisfies Story;
