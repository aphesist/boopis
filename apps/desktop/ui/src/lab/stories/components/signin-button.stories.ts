/* The branded sign-in button (ADR-0040): one shell for the four labs, in every preset (the light style on the light presets, the dark
   style on the dark ones, drawn from the preset's tokens), at rest, hovered, focused, pressed, disabled and with a name too long for
   the width. */
import { ui } from '@boopis/ui';
import type { SigninBrand } from '@boopis/ui';
import { forced, put, stage } from '../../story';
import type { Story } from '../../types';

const BRANDS: readonly SigninBrand[] = ['chatgpt', 'github', 'claude', 'xai'];
const column = (root: HTMLElement, mk: (b: SigninBrand) => HTMLElement): void => {
  const col = document.createElement('div');
  col.style.cssText = 'display:grid;gap:var(--sp-3);width:100%';
  for (const b of BRANDS) col.append(mk(b));
  put(root, col);
};
const typical = stage(['typical', 'variant'], ({ root }) => { column(root, (b) => ui.signinButton({ brand: b })); }, { width: 320, ground: 'frame' });

export default {
  id: 'components/signin-button', title: 'Sign-in button', area: 'components', kind: 'component', covers: ['ui.signinButton', 'html.signinButton'], mock: { url: '/v6/design-system/index.html#c-buttons', note: 'the mock has no sign-in button; the research is in ADR-0040' },
  states: {
    typical, ...forced(typical, '.ui-sso'),
    disabled: stage(['disabled'], ({ root }) => { column(root, (b) => ui.signinButton({ brand: b, disabled: true })); }, { width: 320, ground: 'frame' }),
    'a custom verb': stage(['variant'], ({ root }) => { column(root, (b) => ui.signinButton({ brand: b, verb: 'Sign in' })); }, { width: 320, ground: 'frame' }),
    long: stage(['long'], ({ root }) => { column(root, (b) => ui.signinButton({ brand: b, verb: 'Continue and keep me signed in' })); }, { width: 220, ground: 'frame' })
  }
} satisfies Story;
