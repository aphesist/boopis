/* The legacy `clip` guard (dock.css, the stage's note; engine.ts paint). WebKitGTK 2.52, accelerated as the app and CI run it,
   repaints a transformed child of an element clipped with `clip: rect()` that has no compositing layer of its own with the clip
   taken in the child's own space, before its transform, while the clip changes: the dock's pages, centred with translateX(-50%)
   under the stage's clip, lost the half right of the centre line (0.1.9, the owner's recordings: "Dock pages", "Nothing needs
   you", "Nothing scheduled", Run). An `overflow` clip does not do it (measured: a box resized every frame with a translated
   child paints whole), nor does a box placed by layout. So:
   1. `clip` is written in two places only: the dock's stage (the slab's hold while it moves) and the orb points (a roster's
      scroller), whose only transformed children are animations, which have layers of their own. A new `clip` fails here;
   2. nothing in the dock is centred with a -50% transform: its pages and its foot are centred on the anchor by layout.
   tests/e2e/dock_webkit.py watches the result in a real WebKitGTK (the pages and arrange phases). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const SOURCES = walk(SRC).map(rel).filter((p) => /\.(ts|css)$/.test(p) && !/\.test\.ts$/.test(p) && !p.startsWith('src/lab/') && !p.startsWith('src/vendor/'));
/** a stylesheet's `clip` declaration (`clip-path` and `clip-rule` are other properties), or a script writing it */
const CLIP_CSS = /(?:^|[{;\s])clip\s*:/;
const CLIP_TS = /\.style\.clip\s*=|setProperty\(\s*['"]clip['"]|\[\s*['"]clip['"]\s*\]\s*=/;
const writesClip = (p: string, l: string): boolean => (p.endsWith('.css') ? CLIP_CSS : CLIP_TS).test(l);
/** a -50% translation, written as CSS or as a string a script writes */
const HALF = /translate(?:X|3d)?\(\s*(?:calc\()?\s*-50%|translate\s*:\s*-50%/;

describe('the legacy clip property', () => {
  it('is written only by the dock stage and the orb points', () => {
    const users = SOURCES.filter((p) => read(p).split('\n').some((l) => writesClip(p, l) && !/^\s*(\/\/|\*|\/\*)/.test(l)));
    expect(users.sort()).toEqual(['src/modules/dock/engine.ts', 'src/modules/dock/layer.ts']);
  });
});

describe('nothing in the dock is centred with a transform', () => {
  const DOCK = SOURCES.filter((p) => p.startsWith('src/modules/dock/'));
  it('no -50% translation in the dock styles or scripts', () => {
    const bad = DOCK.flatMap((p) => read(p).split('\n').map((l, i) => [l, i + 1] as const).filter(([l]) => HALF.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^\s{3}\S/.test(l)).map(([, n]) => p + ':' + n));
    expect(bad).toEqual([]);
  });
  it('the pages and the foot are centred on the anchor by layout', () => {
    const css = read('src/modules/dock/dock.css');
    for (const sel of ['.dk-page', '.dk-foot']) {
      const rule = new RegExp('^\\' + sel + ' \\{([^}]*)\\}', 'm').exec(css)?.[1] ?? '';
      expect(rule, sel).toMatch(/margin-inline:\s*auto/);
      expect(rule, sel).toMatch(/left:\s*-100vw/);
      expect(rule, sel).toMatch(/right:\s*-100vw/);
      expect(rule, sel).not.toMatch(/transform|translate/);
    }
  });
});
