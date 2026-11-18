/* Fonts are bundled, never fetched from a CDN: the app runs under a strict CSP (no remote styles or fonts).
   The two fonts the default theme needs load with the app; every other family the customizer offers loads on demand,
   the first time a theme or the picker asks for it. Latin subsets only. */
import '@fontsource/libre-franklin/latin-400.css';
import '@fontsource/libre-franklin/latin-500.css';
import '@fontsource/libre-franklin/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';

type Loader = () => Promise<unknown>;
const all = (...l: Loader[]): Loader => () => Promise.all(l.map((f) => f()));

const LOADERS: Record<string, Loader> = {
  Geist: all(() => import('@fontsource/geist/latin-400.css'), () => import('@fontsource/geist/latin-500.css'), () => import('@fontsource/geist/latin-600.css')),
  'Geist Mono': all(() => import('@fontsource/geist-mono/latin-400.css'), () => import('@fontsource/geist-mono/latin-500.css'), () => import('@fontsource/geist-mono/latin-600.css')),
  'IBM Plex Sans': all(() => import('@fontsource/ibm-plex-sans/latin-400.css'), () => import('@fontsource/ibm-plex-sans/latin-500.css'), () => import('@fontsource/ibm-plex-sans/latin-600.css')),
  'Instrument Sans': all(() => import('@fontsource/instrument-sans/latin-400.css'), () => import('@fontsource/instrument-sans/latin-500.css'), () => import('@fontsource/instrument-sans/latin-600.css')),
  'Public Sans': all(() => import('@fontsource/public-sans/latin-400.css'), () => import('@fontsource/public-sans/latin-500.css'), () => import('@fontsource/public-sans/latin-600.css')),
  'JetBrains Mono': all(() => import('@fontsource/jetbrains-mono/latin-400.css'), () => import('@fontsource/jetbrains-mono/latin-500.css')),
  'Source Code Pro': all(() => import('@fontsource/source-code-pro/latin-400.css'), () => import('@fontsource/source-code-pro/latin-500.css'))
};

const loaded = new Set<string>(['Libre Franklin', 'IBM Plex Mono', 'System']);

/** load a family once; the browser applies it when the stylesheet lands (fonts are swap-loaded) */
export function ensureFont(name: string | null | undefined): void {
  if (!name || loaded.has(name)) return;
  loaded.add(name);
  const load = LOADERS[name];
  if (load) void load().catch(() => loaded.delete(name));
}
