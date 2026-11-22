/* The product's tokens (apps/desktop/ui/src/styles/tokens.css, the one source), injected first so every later stylesheet
   reads them. tokens.css @imports Google Fonts; that line is dropped here, because a frame loads its fonts from
   @fontsource and never reaches the network (vite's CSS @import inlining does not pass through plugins, so the
   stylesheet is read raw and stripped in place). */
import raw from '@ui/src/styles/tokens.css?raw';

const REMOTE_FONTS = /@import\s+url\(\s*["']?https:\/\/fonts\.googleapis\.com[^)]*\)[^;]*;?/g;
const style = document.createElement('style');
style.dataset['source'] = 'apps/desktop/ui/src/styles/tokens.css';
style.textContent = raw.replace(REMOTE_FONTS, '');
document.head.prepend(style);
