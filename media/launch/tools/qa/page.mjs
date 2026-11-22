/* What the checker measures on the page itself, where the DOM and the timeline are exact.

     text         every run of text visible at sampled times (4 a second), with its size on screen in 1080p px
                  (1em measured through every zoom and transform); a run under 28 px is a failure (bible rule 5)
     firstClaim   the first time (in 1/30 s steps) two words or more are on screen, opaque and unclipped, at 28 px or more
     linear       every tween whose ease is linear without being tagged as constant motion (data.linear), and every
                  tween with GSAP's unspecified default ease
     fades        every opacity tween on an element over 10% of the frame (a full-layer cross-fade)
     stillness    the same 12 fps / 160x90 / 0.6 measure as the video, on frames captured from the page without
                  grain or compression: the content's own stillness */
import { openFilm } from '../lib/build.mjs';
import { decodePNG } from '../lib/png.mjs';
import { round } from './video.mjs';

export async function pageChecks(url, o = {}) {
  const { browser, context, page } = await openFilm(url + '&nograin', o.vertical ? { width: 1080, height: 1920 } : {});
  try {
    const meta = await page.evaluate(() => { const f = window.__film; return { duration: f.duration, fps: f.fps, width: f.width, height: f.height, marks: f.marks ?? [], cuts: f.cuts, warnings: f.warnings ?? [] }; });
    /* text sizes, sampled */
    const small = new Map(), seen = [];
    for (let t = 0; t <= meta.duration + 1e-9; t += 0.25) {
      const runs = await page.evaluate(async (t) => { await window.__film.seek(t, { paint: false }); return window.__film.text(); }, t);
      for (const r of runs) {
        if (r.opacity < 0.3 || r.clipped > 0.9) continue;
        seen.push(r.px);
        if (r.px < 28) {
          const k = r.text;
          const s = small.get(k) ?? { text: k, px: r.px, from: t, to: t, el: r.el };
          s.px = Math.min(s.px, r.px); s.to = t;
          small.set(k, s);
        }
      }
    }
    /* the first claim */
    let firstClaim = null, claimText = null;
    for (let f = 0; f <= Math.min(meta.duration, 6) * 30; f++) {
      const t = f / 30;
      const runs = await page.evaluate(async (t) => { await window.__film.seek(t, { paint: false }); return window.__film.text(); }, t);
      /* words a stranger can read: at least two words of two letters, opaque, unclipped, 28 px or more */
      const legible = runs.filter((r) => r.opacity >= 0.6 && r.clipped <= 0.5 && r.px >= 28);
      const words = legible.flatMap((r) => r.text.split(/\s+/)).filter((w) => /[\p{L}]{2}/u.test(w));
      if (words.length >= 2) { firstClaim = round(t, 3); claimText = legible.map((r) => r.text).join(' '); break; }
    }
    /* linear and unspecified eases */
    const tweens = await page.evaluate(() => window.__film.tweens());
    const linear = tweens.filter((t) => t.linear && !t.linearOk && t.props.length && t.end > t.start);
    const unspecified = tweens.filter((t) => /^default/.test(t.ease) && t.end > t.start);
    /* full-layer fades */
    const fades = await page.evaluate(() => window.__film.fades());
    /* content stillness: 160x90 captures straight from the page */
    const cdp = await context.newCDPSession(page);
    const W = meta.width, H = meta.height, sw = 160, sh = Math.round((160 * H) / W);
    let prev = null; const d = [];
    for (let k = 0; k <= Math.floor(meta.duration * 12); k++) {
      await page.evaluate((t) => window.__film.seek(t, { paint: false }), k / 12);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: sw / W } });
      const img = decodePNG(Buffer.from(r.data, 'base64'));
      const g = new Float32Array(img.width * img.height);
      for (let i = 0; i < g.length; i++) g[i] = 0.2126 * img.rgb[i * 3] + 0.7152 * img.rgb[i * 3 + 1] + 0.0722 * img.rgb[i * 3 + 2];
      if (prev) { let s = 0; for (let i = 0; i < g.length; i++) s += Math.abs(g[i] - prev[i]); d.push(s / g.length); }
      prev = g;
    }
    const still = d.map((x) => x < 0.6);
    let longest = 0, run = 0, at = 0, longestAt = 0;
    still.forEach((s, i) => { if (s) { if (!run) at = (i + 1) / 12; run++; if (run > longest) { longest = run; longestAt = at; } } else run = 0; });
    return {
      duration: meta.duration, marks: meta.marks, warnings: meta.warnings,
      text: { sampled: seen.length, smallest: seen.length ? Math.min(...seen) : null, under28: [...small.values()] },
      firstClaim, claimText,
      linear: linear.map((t) => ({ at: round(t.start, 3), ease: t.ease, props: t.props.join(','), target: t.targets.join(',') })),
      unspecified: unspecified.length,
      tweens: tweens.length,
      fades,
      stillness: { stillShare: round(still.filter(Boolean).length / Math.max(1, still.length), 3), longestHold: round(longest / 12, 2), longestHoldAt: round(longestAt, 2), motionIndex: round(d.reduce((a, b) => a + b, 0) / Math.max(1, d.length), 3) }
    };
  } finally {
    await browser.close();
  }
}
