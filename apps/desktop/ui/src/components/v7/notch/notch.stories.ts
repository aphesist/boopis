/* Notch (21.2 row 42). The notch spec (notch-design/notch-spec.md) is not in this repository: this draws what section 8.2 fixes, the
   slab's shape with its composer on a 12 inset (an owner question in the kit's report). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

export default {
  id: 'kit/notch', title: 'Notch', area: 'dock', kind: 'component', covers: ['kit.notch'],
  states: {
    typical: stage(['typical'], ({ root }) => { line(root, kit.notch({})); }, { width: 560 }),
    long: stage(['long'], ({ root }) => { line(root, kit.notch({ placeholder: 'Ask boopis anything about the session you are in' })); }, { width: 560 })
  }
} satisfies Story;
