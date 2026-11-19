/* The UI lab's entry (lab.html; docs/UI-LAB.md). Never part of the desktop app's build (vite.config.ts).
   `?frame=1&story=..&state=..` draws one state alone (frame.ts); anything else is the gallery (gallery.ts).
   Before the app's modules load: a frame starts from a clean store (no saved theme, sidebar or dock), and
   `reduced=1` makes the frame report reduced motion to the app (the gallery cannot emulate the media query in a cell;
   Playwright emulates it for real). */
const q = new URLSearchParams(location.search);
if (q.get('manifest')) {
  /* the checker asks which stories and states exist */
  void import('./registry').then((m) => { (window as unknown as Record<string, unknown>)['__labManifest'] = m.manifest(); document.documentElement.dataset['labReady'] = '1'; });
} else if (q.get('frame')) {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('hx.')) localStorage.removeItem(k); } catch { /* storage blocked */ }
  if (q.get('reduced') === '1') {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (m: string): MediaQueryList => (/prefers-reduced-motion:\s*reduce/.test(m) ? { ...real(m), matches: true, media: m } as MediaQueryList : real(m));
    document.documentElement.dataset['labReduced'] = '1';
  }
  void import('./frame').then((m) => m.startFrame());
} else {
  void import('./gallery').then((m) => m.startGallery());
}
