/* Scenarios and the frame recorder, injected into the page by both engines (plain JS, no imports: it is evaluated as
   text, which also keeps it clear of the app's CSP). It talks to the app only through the e2e build's `window.__hx`.

   Frame timing is requestAnimationFrame deltas. The instrument (`install`, run before the app boots) also wraps every
   rAF and ResizeObserver callback to add up how much of each frame is script, so a slow frame can be told apart as
   "the page's JS" or "everything else" (style, layout, paint, composite). Nothing here changes what the app does. */
(() => {
  if (window.__perf) return;
  const P = (window.__perf = { script: { raf: 0, ro: 0, ev: 0 }, marks: {}, flicker: null });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  P.sleep = sleep;

  /* ---- instrumentation: how much of the frame is the page's own script ---- */
  const nowMs = () => performance.now();
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf0((ts) => { const t = nowMs(); try { cb(ts); } finally { P.script.raf += nowMs() - t; } });
  const RO0 = window.ResizeObserver;
  if (RO0) {
    window.ResizeObserver = class extends RO0 {
      constructor(cb) { super((entries, obs) => { const t = nowMs(); try { cb(entries, obs); } finally { P.script.ro += nowMs() - t; } }); }
    };
  }
  /* canvas clears: a canvas whose width or height is assigned loses its pixels until something draws it again */
  const cw = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const ch = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  P.clears = [];
  /* a canvas stays "empty" from the moment its size is assigned until something fills a path on it: a frame painted in
     between shows an orb with no body. `fill` is what orb2 draws with. */
  const note = (el, k, v) => { if (P.recording) P.clears.push({ t: nowMs(), k, v, was: el[k] }); if (v > 0 || el.__empty) el.__empty = v > 0; };
  const fill0 = CanvasRenderingContext2D.prototype.fill;
  CanvasRenderingContext2D.prototype.fill = function (...a) { if (this.canvas) this.canvas.__empty = false; return fill0.apply(this, a); };
  Object.defineProperty(HTMLCanvasElement.prototype, 'width', { configurable: true, get() { return cw.get.call(this); }, set(v) { note(this, 'width', v); cw.set.call(this, v); } });
  Object.defineProperty(HTMLCanvasElement.prototype, 'height', { configurable: true, get() { return ch.get.call(this); }, set(v) { note(this, 'height', v); ch.set.call(this, v); } });

  /* ---- statistics ---- */
  const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const TOL = 1.0; /* ms of timer jitter allowed above one 60 Hz frame before a frame counts as missed */
  function stats(ts, wallMs, script0, script1, busyMs) {
    const d = [];
    for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
    const sum = d.reduce((a, b) => a + b, 0);
    const scr = (script1.raf - script0.raf) + (script1.ro - script0.ro);
    return {
      frames: d.length, p50: +pct(d, 0.5).toFixed(1), p95: +pct(d, 0.95).toFixed(1), p99: +pct(d, 0.99).toFixed(1), max: +Math.max(0, ...d).toFixed(1),
      over8: d.filter((x) => x > 8.3 + TOL).length, over16: d.filter((x) => x > 16.7 + TOL).length, over33: d.filter((x) => x > 33.4 + TOL).length,
      busyMsPerFrame: +(busyMs / Math.max(1, d.length)).toFixed(2),
      fps: +(d.length / (sum / 1000 || 1)).toFixed(1), scriptMsPerFrame: +(scr / Math.max(1, d.length)).toFixed(2), wallMs: Math.round(wallMs)
    };
  }
  /* main-thread work per frame, for engines that report no task time (WebKitGTK): a MessageChannel ping-pong keeps the
     event loop turning, so the gap between two pings is how long one task held the main thread. Script, style, layout
     and the paint a non-composited renderer does all run inside such tasks; what a compositor thread does does not.
     The probe is its own cost (a task every ~0.05 ms), so its numbers are for comparing builds, not absolutes. */
  P.busyProbe = () => {
    const ch = new MessageChannel(); let on = true, last = nowMs(), busy = 0, n = 0;
    ch.port1.onmessage = () => { if (!on) return; const t = nowMs(), g = t - last; last = t; n++; if (g > 0.4) busy += g; ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
    return { stop: () => { on = false; ch.port1.close(); return { busy, n }; } };
  };
  /* a synthetic main-thread load (a 30 ms task every 200 ms) while a scenario runs: what a busy page does to its own motion */
  P.useProbe = false; P.loadOn = false; P.loadMs = 30; P.loadEvery = 200;
  const startLoad = () => {
    let on = true, spent = 0;
    const tick = () => { if (!on) return; const t = nowMs(); while (nowMs() - t < P.loadMs) { /* a long task */ } spent += nowMs() - t; setTimeout(tick, P.loadEvery - P.loadMs); };
    setTimeout(tick, 100);
    return () => { on = false; return spent; };
  };
  /** run `fn` while recording every frame */
  P.record = async (fn) => {
    const ts = []; let on = true;
    const probe0 = P.useProbe ? P.busyProbe() : null, stopLoad = P.loadOn ? startLoad() : null;
    const loop = (t) => { if (!on) return; ts.push(t); raf0(loop); };
    const s0 = { ...P.script }, t0 = nowMs();
    P.recording = true; P.clears.length = 0; P.flick = { blank: 0, frames: 0, orbs: new Set() };
    raf0(loop);
    /* flicker probe: after the orb loop has run for the frame, an orb the page can see that still owes a redraw is about to be painted blank */
    P.flick.q = []; let lastQ = window.OrbAvatar ? window.OrbAvatar.qualityLevel : -1;
    const probe = () => {
      if (!on) return;
      P.flick.frames++;
      const q = window.OrbAvatar ? window.OrbAvatar.qualityLevel : -1;
      if (q !== lastQ) { P.flick.q.push(Math.round(nowMs() - t0) + 'ms:' + lastQ + '>' + q); lastQ = q; }
      for (const o of document.querySelectorAll('orb-avatar')) {
        const c = o.shadowRoot && o.shadowRoot.querySelector('canvas');
        if (c && o._visible && o._cw && c.__empty) { P.flick.blank++; P.flick.orbs.add(o.getAttribute('label') || o.id || '?'); }
      }
      raf0(probe);
    };
    raf0(probe);
    let err = null;
    try { await fn(); } catch (e) { err = String(e && e.stack || e); }
    on = false; P.recording = false;
    const spent = stopLoad ? stopLoad() : 0;
    const busy = probe0 ? probe0.stop() : { busy: 0 };
    await sleep(40);
    const r = stats(ts, nowMs() - t0, s0, { ...P.script }, probe0 ? Math.max(0, busy.busy - spent) : 0);   /* the synthetic load is not the page's work */
    r.load = !!stopLoad;
    r.canvasClears = P.clears.length;
    r.blankOrbFrames = P.flick.blank; r.blankOrbs = [...P.flick.orbs].slice(0, 12).join(',');
    r.qualityChanges = P.flick.q.length; r.qualityLog = P.flick.q.join(' ');
    if (err) r.error = err;
    return r;
  };

  /* ---- helpers on the app ---- */
  const H = () => window.__hx;
  const dock = () => H().dock();
  const bots = () => H().data().bots.snapshot().bots;
  const settle = async (ms = 500) => { await sleep(ms); await frames(2); };
  P.reset = async () => {
    const d = dock();
    if (H().state.tab !== 'session') H().setState({ tab: 'session' });
    if (d.state.card) d.closeSession();
    if (d.state.mode !== 'normal') d.setMode('normal');
    if (d.state.page !== 'bots') d.goPage('bots');
    d.hover(null); document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 4, clientY: 4, pointerType: 'mouse' }));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await settle(700);
  };
  const point = (x, y) => {
    const t = document.elementFromPoint(x, y) || document.body;
    t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1 }));
  };
  const keyOn = (el, key, code) => el.dispatchEvent(new KeyboardEvent('keydown', { key, code: code || key, bubbles: true, cancelable: true }));

  /* ---- the scenarios ---- */
  const S = (P.scenarios = {});
  S.idle = { label: 'idle 10 s, every orb live (session tab: dock row and list)', run: async () => { await sleep(10000); } };
  S['idle-bots'] = { label: 'idle 5 s on the Bots tab (room orbs, list, dock row)', run: async () => { H().setState({ tab: 'bots' }); await settle(900); await P.record(async () => {}); await sleep(5000); H().setState({ tab: 'session' }); await settle(300); } };
  S['dock-morph'] = {
    label: 'dock: open, expand, collapse, minimise, restore (x3)',
    run: async () => { const d = dock(); for (let i = 0; i < 3; i++) for (const m of ['expanded', 'normal', 'minimal', 'normal']) { d.setMode(m); await sleep(750); } }
  };
  S['dock-magnify'] = {
    label: 'dock: pointer sweeps across the bot row (hover magnification), 4 passes',
    run: async () => {
      const row = document.querySelector('#hx-dock .dk-row'); if (!row) throw new Error('no dock row');
      const r = row.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left - 20, x1 = r.right + 20;
      const steps = 70; /* 70 events per pass at ~16 ms: a mouse at 60 Hz */
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i <= steps; i++) { const f = pass % 2 ? 1 - i / steps : i / steps; point(x0 + (x1 - x0) * f, y); await new Promise((res) => setTimeout(res, 16)); }
      }
      point(4, 4); await sleep(500);
    }
  };
  S['dock-pages'] = {
    label: 'dock: switch pages bots, run, needs you, scheduled, bots (x2)',
    run: async () => { const d = dock(); for (let k = 0; k < 2; k++) for (const p of ['run', 'wait', 'sched', 'bots']) { d.goPage(p); await sleep(650); } }
  };
  S['dock-keys'] = {
    label: 'dock: arrow keys along the bot row and back (x2)',
    run: async () => {
      const first = document.querySelector('#hx-dock .dk-bot'); first.focus({ preventScroll: true }); await sleep(250);
      for (let k = 0; k < 2; k++) for (const key of ['ArrowRight', 'ArrowLeft']) for (let i = 0; i < 8; i++) { keyOn(document.activeElement, key); await sleep(110); }
      document.activeElement.blur(); await sleep(300);
    }
  };
  S['dock-session'] = {
    label: 'dock: open a bot session, switch, close (x3)',
    run: async () => { const d = dock(), b = bots(); for (let i = 0; i < 3; i++) { d.openSession(b[i].id); await sleep(800); d.openSession(b[i + 1].id); await sleep(700); d.closeSession(); await sleep(700); } }
  };
  S['create-bot'] = {
    label: 'create two bots from the data seam while the dock is open',
    run: async () => {
      const mk = (n) => H().data().bots.create({ name: 'perf-' + n + '-' + Math.random().toString(36).slice(2, 6), role: 'measures frames', shape: n % 2 ? 'star' : 'cloud', color: n % 2 ? '#7ea6e0' : '#e8b04a', eyes: 'pill', instructions: 'x' });
      mk(1); await sleep(1200); mk(2); await sleep(1500);
    }
  };
  S['tab-switch'] = {
    label: 'switch Session and Bots tabs (x4)',
    run: async () => { for (let i = 0; i < 4; i++) { H().setState({ tab: 'bots' }); await sleep(700); H().setState({ tab: 'session' }); await sleep(700); } }
  };
  S.resize = {
    label: 'resize the window: 60 steps of 16 px over 1 s, there and back',
    run: async () => {
      const w0 = innerWidth;
      await window.__perfNative('resize', { from: w0, to: w0 - 480, steps: 30, ms: 16 });
      await window.__perfNative('resize', { from: w0 - 480, to: w0, steps: 30, ms: 16 });
      await sleep(400);
    }
  };
  /* the same motion with the main thread loaded: a 30 ms task every 200 ms (P.loadMs, P.loadEvery) */
  for (const n of ['dock-morph', 'dock-pages', 'tab-switch']) S[n + '-load'] = { label: S[n].label + ', under a 30 ms task every 200 ms', load: true, run: S[n].run };
  P.run = async (name) => { await P.reset(); const sc = S[name]; if (!sc) throw new Error('no scenario ' + name); P.loadOn = !!sc.load; const r = await P.record(sc.run); P.loadOn = false; r.name = name; return r; };
  P.names = () => Object.keys(S);
  P.info = () => {
    const os = [...document.querySelectorAll('orb-avatar')];
    return { orbMode: window.__hx && window.__hx.orbs ? window.__hx.orbs.mode + (window.__hx.orbs.why ? ' (' + window.__hx.orbs.why + ')' : '') : '?', orbs: os.length, live: os.filter((o) => !o.hasAttribute('static') && o._visible && o._cw).length, canvasPx: os.filter((o) => !o.hasAttribute('static') && o._visible && o._cw).reduce((a, o) => a + o._cw * o._cw, 0), quality: window.OrbAvatar && window.OrbAvatar.qualityLevel, bots: bots().length, dpr: devicePixelRatio, w: innerWidth, h: innerHeight };
  };
  /* resolved by the host when a native step (a window resize) is done */
  const pending = new Map(); let seq = 0;
  P.native = (op, args) => new Promise((res) => { const id = ++seq; pending.set(id, res); window.__perfPost({ type: 'native', id, op, args }); });
  P.nativeDone = (id) => { const r = pending.get(id); if (r) { pending.delete(id); r(); } };
  window.__perfNative = window.__perfNative || P.native;
  window.__perfNativeDone = P.nativeDone;
})();
