/* The trailer's entry: the desktop UI's styles, fonts and card layer, the vendored orb and logo elements, then the
   scenes on the stage. window.__trailer is what render.mjs drives: `ready`, `duration`, `frame(t)`. */
import '@ui/styles/index';
import './trailer.css';
/* the Graphite and Typewriter presets' families, for the theme montage (the app loads them on demand) */
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import '@vendor/orb-avatar.min.js';
import '@vendor/boopis-logo.js';
import { setProvider } from '@ui/data';
import { createMockProvider } from '@ui/data/mock-provider';
setProvider(createMockProvider({ simulate: false }));
import '@ui/modules/cards';
import { createStage } from './engine/stage';
import { SCENES, DURATION } from './scenes';

const host = document.getElementById('stage') as HTMLElement;
const stage = createStage(host, SCENES);
const ready = (async () => {
  await document.fonts.ready;
  await Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 40px "Libre Franklin"`)));
  await Promise.all(['400', '500'].map((w) => document.fonts.load(`${w} 40px "IBM Plex Mono"`)));
  await Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 40px "Geist"`)));
  await Promise.all(['400', '500'].map((w) => document.fonts.load(`${w} 40px "Geist Mono"`)));
  await customElements.whenDefined('orb-avatar');
  await customElements.whenDefined('boopis-logo');
  return true;
})();
(window as unknown as Record<string, unknown>)['__trailer'] = { ready, duration: DURATION, frame: (t: number) => stage.frame(t) };
