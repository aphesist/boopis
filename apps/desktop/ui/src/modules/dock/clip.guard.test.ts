/* The WebKitGTK guard for the dock (dock.css; tests/e2e/dock_webkit.py watches the result in a real WebKitGTK).
   1. `clip-path` inside which WebKitGTK drew nothing (the owner's recording: the dock's content gone, the black slab left) and the
      legacy `clip`, under which WebKitGTK 2.52 (accelerated) repainted a transformed child with the clip taken before its
      transform (0.1.9: the dock's pages lost the half right of the centre line), are written nowhere in the app: the v7 dock's
      open panel clips by its own overflow;
   2. nothing in the dock is centred with a -50% transform: the Dock is centred on its anchor by layout;
   3. a bot's orb in the row is never hidden with `hidden` or `display: none`: an orb with no box is not drawn, and WebKitGTK showed
      the bots that join the row (when the asks open and the pill makes room) as empty circles until their worker's next commit.
      A bot past what fits is `data-out`: out of the flow, not seen, inert, and still drawn. */
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

describe('the legacy clip property and clip-path in the dock', () => {
  it('the legacy clip is written nowhere', () => {
    const users = SOURCES.filter((p) => read(p).split('\n').some((l) => writesClip(p, l) && !/^\s*(\/\/|\*|\/\*)/.test(l)));
    expect(users.sort()).toEqual([]);
  });
  it('the dock has no clip-path', () => {
    const DOCK = SOURCES.filter((p) => p.startsWith('src/modules/dock/') || p.startsWith('src/components/v7/dock/'));
    const bad = DOCK.filter((p) => read(p).split('\n').some((l) => /clip-path|clipPath/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^\s{3}\S/.test(l)));
    expect(bad).toEqual([]);
  });
});

describe('nothing in the dock is centred with a transform', () => {
  const DOCK = SOURCES.filter((p) => p.startsWith('src/modules/dock/'));
  it('no -50% translation in the dock styles or scripts', () => {
    const bad = DOCK.flatMap((p) => read(p).split('\n').map((l, i) => [l, i + 1] as const).filter(([l]) => HALF.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^\s{3}\S/.test(l)).map(([, n]) => p + ':' + n));
    expect(bad).toEqual([]);
  });
  it('the Dock is centred on the anchor by layout', () => {
    const css = read('src/modules/dock/dock.css');
    const rule = /^\.dk > \.k7-dock \{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/margin-inline:\s*auto/);
    expect(rule).toMatch(/left:\s*-100vw/);
    expect(rule).toMatch(/right:\s*-100vw/);
    expect(rule).not.toMatch(/transform|translate\s*:\s*-50%/);
  });
});

describe('a bot past what fits stays drawn', () => {
  it('the row never hides an orb with `hidden` or `display: none`', () => {
    const ts = read('src/modules/dock/index.ts'), css = read('src/modules/dock/dock.css') + read('src/components/v7/dock/dock.css');
    expect(ts).not.toMatch(/\.hidden\s*=/);
    expect(css.split('\n').filter((l) => /k7-dock__orb[^{]*\{[^}]*display:\s*none/.test(l))).toEqual([]);
    const out = /^\.dk \.k7-dock__orb\[data-out\] \{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(out).toMatch(/position:\s*absolute/);
    expect(out).toMatch(/opacity:\s*0/);
    expect(out).not.toMatch(/display|visibility/);
  });
});
