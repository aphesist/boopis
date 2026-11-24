/* Button (DESIGN-SYSTEM.md v7 21.2 row 21; LAB-v7: secondary, primary, ghost, tint, danger, split; 36, 32, 28; hover,
   pressed, focus, disabled, hold-to at 50%). */
import { kit } from '@boopis/ui';
import { forced, line, stage } from '../../story';
import type { Story } from '../../types';

const LABEL: Record<string, string> = { secondary: 'Not now', primary: 'Allow', ghost: 'Cancel', tint: 'Edit', danger: 'Delete', split: 'Commit' };
const typical = stage(['typical', 'variant', 'size'], ({ root }) => {
  for (const size of kit.variants.button.size) line(root, ...kit.variants.button.variant.map((variant) => kit.button({ label: LABEL[variant] ?? variant, variant, size, menuLabel: 'Commit options' })));
  line(root, kit.button({ label: 'New session', icon: 'plus', variant: 'tint', size: 32 }), kit.button({ label: 'Copy', icon: 'copy', size: 28 }));
});

export default {
  id: 'kit/button', title: 'Button', area: 'components', kind: 'component', covers: ['kit.button'],
  states: {
    typical,
    ...forced(typical, '[data-kit~="Button"], .k7-btn'),
    disabled: stage(['disabled', 'variant'], ({ root }) => { line(root, ...(['secondary', 'primary', 'ghost', 'tint', 'danger'] as const).map((variant) => kit.button({ label: LABEL[variant] ?? variant, variant, disabled: true }))); }),
    'hold to allow at 50%': stage(['variant', 'active'], ({ root }) => {
      const a = kit.button({ label: 'Hold to allow once', variant: 'primary', size: 28, hold: true }); a.style.setProperty('--hold', '.5');
      const b = kit.button({ label: 'Hold to delete', variant: 'secondary', hold: true }); b.style.setProperty('--hold', '.5');
      line(root, a, b);
    }),
    long: stage(['long'], ({ root }) => { line(root, kit.button({ label: 'Allow all this turn, then ask again', variant: 'primary' })); line(root, kit.button({ label: 'Open the changelog in the Bots tab', size: 28 })); })
  }
} satisfies Story;
