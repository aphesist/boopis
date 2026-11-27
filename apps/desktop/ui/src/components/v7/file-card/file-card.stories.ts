/* FileCard (boards 11 and 17, botscreens.js `file`): one file a bot wrote or handed over, its name and one mono line. */
import { kit } from '@boopis/ui';
import type { State, Story } from '../../../lab/types';

const stage = (tags: State['tags'], html: string, extra: Partial<State> = {}): State => ({ tags, render: ({ root }) => { root.innerHTML = html; kit.wire(root); }, width: 640, ...extra });

const story: Story = {
  id: 'kit/file-card', title: 'FileCard', area: 'components', kind: 'component', covers: ['kit.fileCard'],
  states: {
    'a file': stage(['typical', 'owner'], kit.html.fileCard({ name: 'CHANGELOG.md', meta: '41 lines, 2.1 KB' }), { note: 'board 11: 260 wide, radius 18, the 32 x 40 tile, the name 14/20, the line in mono 12' }),
    'no line': stage(['variant'], kit.html.fileCard({ name: 'notes.txt' })),
    'a long name': stage(['long'], kit.html.fileCard({ name: 'the-release-notes-for-version-0.2.0-with-every-merged-pull-request.md', meta: '1,204 lines, 86 KB' })),
    'in a narrow column': stage(['size'], kit.html.fileCard({ name: 'CHANGELOG.md', meta: '41 lines, 2.1 KB' }), { width: 220 })
  }
};
export default story;
