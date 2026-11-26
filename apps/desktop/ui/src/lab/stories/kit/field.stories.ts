/* Field (21.2 row 26; LAB-v7: text, search pill, multi-line; focus, error, disabled, placeholder). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';

const typical = stage(['typical', 'variant'], ({ root }) => {
  fill(root, kit.field({ id: 'f-name', label: 'Name', value: 'kai' }));
  fill(root, kit.field({ id: 'f-role', label: 'Role', optional: true, placeholder: 'What this bot does' }));
  fill(root, kit.field({ id: 'f-search', kind: 'search', placeholder: 'Search', keys: 'mod+K' }));
  fill(root, kit.field({ id: 'f-note', kind: 'multiline', label: 'Instructions', value: 'Write the changelog every Friday.\nKeep it short.' }));
}, { width: 440 });
export default {
  id: 'kit/field', title: 'Field', area: 'components', kind: 'component', covers: ['kit.field'],
  states: {
    typical,
    ...forced(typical, '.k7-field__box'),
    empty: stage(['empty'], ({ root }) => { fill(root, kit.field({ id: 'f-e', label: 'Name', placeholder: 'A name, or roll one' })); }, { width: 440 }),
    error: stage(['error'], ({ root }) => { fill(root, kit.field({ id: 'f-err', label: 'Name', value: 'kai', error: 'There is a bot called kai already' })); }, { width: 440 }),
    disabled: stage(['disabled'], ({ root }) => { fill(root, kit.field({ id: 'f-d', label: 'Workspace', value: '~/code/boopis', disabled: true, mono: true })); }, { width: 440 }),
    'secret, with a hint (6d)': stage(['variant'], ({ root }) => { fill(root, kit.field({ id: 'f-key', label: 'OpenAI API key', secret: true, placeholder: 'sk-…', hint: 'From platform.openai.com, API keys.' })); }, { width: 440 }),
    'round another control (6d)': stage(['variant'], ({ root }) => {
      fill(root, kit.field({ id: 'f-v', label: 'The result was', control: kit.html.segmented({ label: 'The result was', value: 'right', items: [{ value: 'right', label: 'Right' }, { value: 'partly', label: 'Partly right' }, { value: 'wrong', label: 'Wrong' }] }) }));
      fill(root, kit.field({ id: 'f-n', label: 'Allow network during the gate', inline: true, control: kit.html.switch({ labelledby: 'f-n-label' }), hint: 'Off keeps the gate hermetic.' }));
    }, { width: 440 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.field({ id: 'f-l', label: 'Folder', value: '/home/someone/code/a-project-with-a-very-long-name/apps/desktop/ui/src', mono: true })); }, { width: 440 })
  }
} satisfies Story;
