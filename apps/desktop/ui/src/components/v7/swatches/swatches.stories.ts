/* Swatches (6d, derived from P1's accent candidates): colours as a row of circles; shown, or one to choose (a radio group). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';

const SUNSET = [{ label: 'Accent', hex: '#e0a458' }, { label: 'Ground', hex: '#1b1712' }, { label: 'Text', hex: '#f3e9da' }];
const ACCENTS = [{ label: 'Iris', hex: '#5b5bd6' }, { label: 'Indigo', hex: '#4f46e5' }, { label: 'Ultramarine', hex: '#3e4fd8' }, { label: 'Violet-indigo', hex: '#5e4ad9' }, { label: 'Soft indigo', hex: '#6366f1' }];
export default {
  id: 'kit/swatches', title: 'Swatches', area: 'components', kind: 'component', covers: ['kit.swatches', 'kit.swatchDot'],
  states: {
    typical: stage(['typical'], ({ root }) => { line(root, kit.swatches({ label: 'Colours', items: SUNSET })); }),
    /* 7a, board 14's Accent: one colour as a 12 circle beside its name, in a select and alone */
    'a colour beside its name': stage(['variant'], ({ root }) => { line(root, kit.selectorItem({ variant: 'field', label: 'Accent', value: 'Iris', swatch: '#5b5bd6' }), kit.swatchDot('#4f46e5')); }),
    'one to choose': stage(['variant'], ({ root }) => { line(root, kit.swatches({ label: 'Accent', choose: true, items: ACCENTS, value: '#4f46e5' })); }),
    'none chosen': stage(['empty'], ({ root }) => { line(root, kit.swatches({ label: 'Accent', choose: true, items: ACCENTS })); }),
    long: stage(['long'], ({ root }) => { line(root, kit.swatches({ label: 'Accent', choose: true, items: [...ACCENTS, ...ACCENTS.map((a) => ({ ...a, label: a.label + ', a long name for the second row of the same colour', value: a.hex + 'cc', hex: a.hex + 'cc' }))] })); }),
    focus: stage(['focus'], ({ root }) => { line(root, kit.swatches({ label: 'Accent', choose: true, items: ACCENTS, value: '#4f46e5' })); }, { force: [{ sel: '.k7-swatches__item:nth-child(3)', state: 'focus' }] })
  }
} satisfies Story;
