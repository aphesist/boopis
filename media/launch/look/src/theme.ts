/* The film's theme: the product's own light theme, applied by the product's own theme module
   (apps/desktop/ui/src/styles/theme.ts, `themeApi.preset('bone')`): the Bone preset ("Light" in the presets list), which
   sets `data-hx-preset="bone"`, its case, corners and density, and, because its ground is light, `data-hx-theme="light"`
   on <html>, which the kit's light-only rules read (the sign-in buttons' black marks, the dock's inks and brass). Nothing
   is invented: the film adds only `data-film-theme`, which only the film's own CSS reads (the ground, the lamp, shadows,
   grain, haze). The app's theme module applies its saved theme when it is first imported; importing it here, first,
   and choosing the preset right after means no later import can apply another one.

   The owner moved the film to the light theme on 23 November 2026 (SC/decisions.md, 6). `?theme=dark` renders the old
   dark look (the Card catalog preset) for comparison; nothing else may pick it. */
import { themeApi } from '@ui/src/styles/theme';

export type FilmTheme = 'light' | 'dark';
const asked = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('theme') : null;
export const FILM_THEME: FilmTheme = asked === 'dark' ? 'dark' : 'light';
/** the product preset each film theme is */
export const PRESET: Record<FilmTheme, string> = { light: 'bone', dark: 'catalog' };
/** the grain the renderer adds to every finished frame, and the look's preview canvas draws: mid-grey noise in
    soft-light. Soft-light barely moves values near white, so the light frame takes a wider noise for the same visible
    texture and a dither of two to three code values on the ground (enough to break the 8-bit steps of its gradients). */
export const GRAIN: Record<FilmTheme, { opacity: number; amp: number }> = { light: { opacity: 0.55, amp: 60 }, dark: { opacity: 0.55, amp: 46 } };

/** put the theme on the document through the app's own theme module (idempotent) */
export function applyTheme(t: FilmTheme = FILM_THEME): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  if (r.getAttribute('data-hx-preset') !== PRESET[t] || r.getAttribute('data-film-theme') !== t) themeApi.preset(PRESET[t]);
  r.setAttribute('data-film-theme', t);
}
applyTheme();
