/* The film page: index.html?scene=<name>[&variant=vertical][&t=<seconds>][&render=1][&nograin]

   Builds the scene on a stage, then exposes `window.__film` for the renderer and the checker. Without `render=1` it
   shows the preview HUD: a scrubber, play/pause (space), frame steps (arrows, shift = 1 s). Playback in the HUD is the
   only place a clock exists on this page, and it only calls the same `seek(t)` a render calls. */
import { textFloorWarnings } from './engine/kit';
import './film.css';
import { Film, type Variant } from './engine/film';
import { createStage } from './engine/stage';
import { expose } from './engine/expose';
import { SCENES } from './scenes';

const q = new URLSearchParams(location.search);
const name = q.get('scene') ?? 'test';
const variant: Variant = q.get('variant') === 'vertical' ? 'vertical' : 'landscape';
const rendering = q.has('render');

async function start(): Promise<void> {
  const load = SCENES[name];
  if (!load) throw new Error('no scene "' + name + '"; scenes: ' + Object.keys(SCENES).join(', '));
  const scene = (await load()).default;
  const film = new Film(scene.config, variant);
  const host = document.createElement('div');
  host.className = 'film-host';
  document.body.appendChild(host);
  const stage = createStage(film, host);
  await film.load(document);      /* fonts first: scenes measure text while they build */
  await scene.build(film, stage);
  await film.load(document);
  /* a mounted component whose text would land under 28 px: said now, listed by the checker */
  for (const w of textFloorWarnings(stage.root.getBoundingClientRect().width / film.width)) { film.warnings.push(w); console.warn('[film] ' + w); }
  film.finalize();
  expose(film, stage);
  await film.seek(Number(q.get('t') ?? 0));
  document.documentElement.dataset['filmReady'] = '1';
  if (!rendering) (await import('./engine/hud')).hud(film, host);
}

start().catch((e: unknown) => {
  const msg = e instanceof Error ? e.stack ?? e.message : String(e);
  (window as unknown as Record<string, unknown>)['__filmError'] = msg;
  document.documentElement.dataset['filmReady'] = 'error';
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f88;font:14px monospace;padding:24px;white-space:pre-wrap';
  pre.textContent = msg;
  document.body.appendChild(pre);
});
