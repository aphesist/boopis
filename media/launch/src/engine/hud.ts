/* The preview HUD (never in a render: index.html?render=1 leaves it out). It scales the 1080p stage to the window, and
   plays by calling the same seek(t) a render calls; the clock here exists only for watching. Keys: space plays,
   left/right step one frame, shift+left/right one second, home/end. ?t=<seconds> opens at a time. */
import type { Film } from './film';

export function hud(film: Film, host: HTMLElement): void {
  const fit = (): void => {
    const s = Math.min(innerWidth / film.width, (innerHeight - 40) / film.height);
    host.style.transform = 'scale(' + s + ')';
    host.style.left = (innerWidth - film.width * s) / 2 + 'px';
  };
  fit();
  addEventListener('resize', fit);
  const bar = document.createElement('div');
  bar.className = 'film-hud';
  bar.innerHTML = '<button type="button" data-act="play">play</button><input type="range" min="0" step="1" aria-label="time"><span data-out></span>';
  document.body.appendChild(bar);
  const range = bar.querySelector('input')!, out = bar.querySelector('[data-out]')!, btn = bar.querySelector('button')!;
  const frames = Math.round(film.duration * film.fps);
  range.max = String(frames);
  let frame = Math.round(film.now * film.fps), playing = false, t0 = 0, f0 = 0, busy = false;
  const beat = 60 / film.bpm;
  const show = async (f: number): Promise<void> => {
    frame = Math.max(0, Math.min(frames, f));
    range.value = String(frame);
    const t = frame / film.fps;
    const abs = film.offset + t;
    out.textContent = t.toFixed(3) + ' s  f' + frame + (film.offset ? '  (film ' + abs.toFixed(3) + ' s)' : '') + '  beat ' + Math.floor(abs / beat + 1e-9) + '  bar.beat ' + (Math.floor(abs / beat / 4 + 1e-9) + 1) + '.' + (Math.floor(abs / beat + 1e-9) % 4 + 1);
    busy = true;
    await film.seek(t);
    busy = false;
  };
  const tick = (now: number): void => {
    if (!playing) return;
    if (!busy) {
      const f = f0 + Math.floor(((now - t0) / 1000) * film.fps);
      if (f > frames) { playing = false; btn.textContent = 'play'; } else void show(f);
    }
    requestAnimationFrame(tick);
  };
  const play = (): void => {
    playing = !playing; btn.textContent = playing ? 'pause' : 'play';
    if (playing) { if (frame >= frames) frame = 0; t0 = performance.now(); f0 = frame; requestAnimationFrame(tick); }
  };
  btn.addEventListener('click', play);
  range.addEventListener('input', () => { playing = false; btn.textContent = 'play'; void show(Number(range.value)); });
  addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); play(); }
    else if (e.key === 'ArrowRight') { playing = false; void show(frame + (e.shiftKey ? film.fps : 1)); }
    else if (e.key === 'ArrowLeft') { playing = false; void show(frame - (e.shiftKey ? film.fps : 1)); }
    else if (e.key === 'Home') void show(0);
    else if (e.key === 'End') void show(frames);
  });
  void show(frame);
}
