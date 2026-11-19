// The event chain, in its own context. No mod code ever runs here: a mod's hooks run in the mod's
// own context (`agent.js`), and this file only decides who is asked, in what order, under what
// budget. Everything that crosses between this context and a mod's is a JSON string, sent as a
// message through `native.send` and routed by Rust, so no object is ever shared between mods.
//
// Natives: `now`, `setDeadline`, `diag`, `send(modIdx, json)`.
//
// Why callbacks and not `async` functions in the driver: when a hook runs past its budget the
// engine's interrupt handler raises an uncatchable exception that unwinds whatever JavaScript is
// on the stack. Every piece of driver state that must survive (the frame, the way to resume the
// chain) therefore lives in plain objects that `recover()` can reach afterwards.
(function (native) {
  'use strict';

  const { JSON: J, Map, Set, Promise, Error, TypeError, Object: O, Math: M } = globalThis;
  const stringify = J.stringify;
  const parse = J.parse;
  const TIER_RANK = { prepend: 0, user: 1, append: 2 };

  let cfg = { default: 10000, promptEdit: 50, catch: 1000 };
  let seq = 0;
  let callSeq = 0;
  let frameSeq = 0;

  const plugins = new Map(); // idx -> { idx, name, tier, hooks, loaded }
  const regs = new Map(); // hook id -> reg
  const byEvent = new Map(); // event -> [reg]
  const open = []; // frames whose hook is running or waiting on `next`, innermost last
  const frames = new Map(); // frame id -> frame
  const results = new Map();
  const runs = new Map();

  const message = (x) => (x && typeof x === 'object' && 'message' in x ? String(x.message) : String(x));
  const toMod = (idx, m) => native.send(idx, stringify(m));

  // ---- frames: one per running hook, with its own budget -------------------------------------
  function setTop() {
    const top = open[open.length - 1];
    native.setDeadline(top && !top.paused ? M.max(0, top.deadlineAt - native.now()) : Infinity);
  }
  function leave(frame) {
    const k = open.lastIndexOf(frame);
    if (k >= 0) open.splice(k, 1);
    frame.state = 'done';
    frames.delete(frame.id);
    setTop();
  }
  const budgetFor = (name) => (name === 'prompt.edit' ? cfg.promptEdit : cfg.default);
  const sorted = (event) =>
    (byEvent.get(event) || []).slice().sort((x, y) => TIER_RANK[x.plugin.tier] - TIER_RANK[y.plugin.tier] || x.seq - y.seq);

  // `eText` is the event as JSON text. A hook that does not match is skipped by the mod's own
  // context (a matcher can hold a RegExp, which must run under the mod's budget, not here).
  function dispatchFrom(run, i, eText) {
    if (i >= run.entries.length) return Promise.resolve(run.bottom(eText));
    return new Promise((resolve) => {
      const frame = frameFor(run, run.entries[i], i, eText, resolve, run.entries[i].kind || 'hook');
      Promise.resolve().then(() => start(frame));
    });
  }

  function frameFor(run, reg, i, eText, resolve, kind) {
    const frame = {
      id: 'f' + ++frameSeq, run, reg, i, eText, resolve, kind,
      state: 'new', paused: false, pausedAt: 0, deadlineAt: 0,
      budget: kind === 'catch' ? cfg.catch : run.budget,
      nextCalled: false, lastDown: undefined, orig: null, failure: null, nextCalls: new Map(),
    };
    frame.orig = frame;
    return frame;
  }

  function start(frame) {
    if (frame.run.aborted) return;
    open.push(frame);
    frames.set(frame.id, frame);
    frame.state = 'running';
    frame.deadlineAt = native.now() + frame.budget;
    setTop();
    const reg = frame.reg;
    toMod(reg.plugin.idx, {
      k: 'invoke', frame: frame.id, hook: reg.hook, kind: frame.kind, e: frame.eText, budget: frame.budget,
      event: frame.run.name, tier: reg.plugin.tier, site: frame.run.site,
      run: frame.run.id, tokens: undefined,
      failure: frame.kind === 'catch' ? { kind: frame.failure.kind, message: frame.failure.message, called: frame.orig.nextCalled } : undefined,
    });
  }

  // The mod answered, matched nothing, or threw.
  function settled(m) {
    const frame = frames.get(m.frame);
    if (!frame || frame.state !== 'running') return;
    if (m.status === 'nomatch') {
      leave(frame);
      frame.resolve(dispatchFrom(frame.run, frame.i + 1, frame.eText));
      return;
    }
    if (m.status === 'threw') return failed(frame, 'throw', m.error);
    leave(frame);
    if (m.tok !== undefined) frame.run.tokens.push([frame.reg.plugin.idx, m.tok]);
    if (m.value !== undefined && frame.run.answeredBy === null) frame.run.answeredBy = frame.reg.plugin.idx;
    frame.resolve(m.value);
  }

  // `next(e)` from a hook: run everything below this frame and hand its answer back.
  function down(m) {
    const frame = frames.get(m.frame);
    if (!frame || frame.state !== 'running') return;
    // A catch handler calling `next` after the hook already did gets the same downstream answer.
    if (frame.kind === 'catch' && frame.orig.nextCalled) {
      Promise.resolve(frame.orig.lastDown).then((v) => answerNext(frame, m.call, v));
      return;
    }
    let from = frame.i + 1;
    if (m.tier !== undefined) {
      while (from < frame.run.entries.length && TIER_RANK[frame.run.entries[from].plugin.tier] < TIER_RANK[m.tier]) from++;
    }
    frame.nextCalled = true;
    frame.paused = true;
    frame.pausedAt = native.now();
    setTop();
    const p = Promise.resolve().then(() => dispatchFrom(frame.run, from, m.e));
    frame.lastDown = p;
    const resume = () => {
      if (frame.state !== 'running') return;
      frame.paused = false;
      frame.deadlineAt += native.now() - frame.pausedAt;
      setTop();
    };
    p.then(resume, resume);
    p.then((v) => answerNext(frame, m.call, v));
  }

  function answerNext(frame, call, value) {
    if (frame.state === 'done' && frame.reg.plugin.gone) return;
    toMod(frame.reg.plugin.idx, { k: 'nextDone', frame: frame.id, call, value });
  }

  function failed(frame, kind, error) {
    if (frame.state !== 'running') return;
    leave(frame);
    frame.run.failed = true;
    if (kind === 'timeout') toMod(frame.reg.plugin.idx, { k: 'abort', frame: frame.id, message: error });
    native.diag('warn', frame.reg.plugin.name, `${frame.run.name}: ${frame.kind === 'catch' ? '.catch handler' : 'hook'} ${kind === 'timeout' ? 'timed out' : 'threw'}: ${error}`);
    if (frame.kind === 'catch') return skip(frame.orig);
    if (frame.reg.hasCatch) return runCatch(frame, kind, error);
    skip(frame);
  }

  function runCatch(frame, kind, error) {
    const cf = frameFor(frame.run, frame.reg, frame.i, frame.eText, frame.resolve, 'catch');
    cf.orig = frame;
    cf.failure = { kind, message: error };
    Promise.resolve().then(() => start(cf));
  }

  function skip(frame) {
    if (frame.nextCalled) frame.resolve(frame.lastDown);
    else frame.resolve(dispatchFrom(frame.run, frame.i + 1, frame.eText));
  }

  // ---- bottoms: what happens when no hook answers ----------------------------------------------
  const ownerOf = (id) => {
    const n = Number(String(id).split('.')[0]);
    return plugins.get(n);
  };

  // Press, input, select and timers end in the handler of the mod that drew or set them, run as a
  // frame of its own so it has a budget and a catch of nothing.
  function callbackBottom(id, valueOf) {
    return (eText) => {
      const owner = ownerOf(id);
      if (!owner || owner.gone) {
        native.diag('warn', '', `handler ${id} is gone`);
        return undefined;
      }
      const reg = { event: 'callback', hook: id, plugin: owner, hasCatch: false, kind: 'callback', seq: 0 };
      const run = { id: -1, name: 'callback', entries: [reg], bottom: () => undefined, budget: cfg.default, aborted: false, answeredBy: null, site: undefined, tokens: [] };
      return dispatchFrom(run, 0, stringify({ handler: id, value: valueOf(parse(eText)) }));
    };
  }
  function bottomFor(name, payload) {
    switch (name) {
      case 'ui.render': return (eText) => stringify({ $default: true, event: parse(eText) });
      case 'ui.press': case 'ui.input': case 'ui.select': return callbackBottom(payload && payload.handler, (e) => e.value);
      case 'clock.tick': return callbackBottom(payload && payload.id, () => undefined);
      default: return () => undefined;
    }
  }

  function startRun(id, name, eText, entries, bottom, budget) {
    const payload = eText === '' ? undefined : parse(eText);
    let site;
    if (name === 'ui.render') site = `${payload.component}:${payload.id === undefined ? '' : payload.id}`;
    const run = { id, name, entries, bottom: bottom(payload), budget, aborted: false, answeredBy: null, site, tokens: [] };
    runs.set(id, run);
    Promise.resolve()
      .then(() => dispatchFrom(run, 0, eText === '' ? 'null' : eText))
      .then(
        (v) => { if (!run.aborted) results.set(id, stringify({ value: v === undefined ? null : v, answered: v !== undefined, site: run.site, tokens: run.tokens, answeredBy: run.answeredBy })); },
        (x) => { if (!run.aborted) results.set(id, stringify({ error: message(x) })); },
      );
    return run;
  }

  // ---- the API the host drives -----------------------------------------------------------------
  return {
    configure(json) {
      const c = parse(json);
      cfg = { default: c.default, promptEdit: c.promptEdit, catch: c.catch };
    },
    addPlugin(idx, name, tier) {
      plugins.set(idx, { idx, name, tier, hooks: 0, loaded: false, gone: false });
    },
    // Runs `register(on, options)` of one module of a plugin, in the plugin's own context.
    register(runId, idx, optionsJson) {
      const plugin = plugins.get(idx);
      plugin.loaded = false;
      const reg = { event: 'plugin.register', hook: 'register', plugin, hasCatch: false, kind: 'register', seq: 0 };
      const run = { id: runId, name: 'plugin.register', entries: [reg], bottom: () => undefined, budget: cfg.default, aborted: false, answeredBy: null, site: undefined, tokens: [] };
      runs.set(runId, run);
      Promise.resolve()
        .then(() => dispatchFrom(run, 0, optionsJson))
        .then(
          () => { plugin.loaded = !run.failed; results.set(runId, '{}'); },
          (x) => results.set(runId, stringify({ error: message(x) })),
        );
    },
    removePlugin(idx) {
      const plugin = plugins.get(idx);
      if (!plugin) return;
      plugin.gone = true;
      plugins.delete(idx);
      for (const [id, reg] of regs) {
        if (reg.plugin === plugin) {
          regs.delete(id);
          const list = (byEvent.get(reg.event) || []).filter((r) => r !== reg);
          if (list.length > 0) byEvent.set(reg.event, list);
          else byEvent.delete(reg.event);
        }
      }
    },
    pluginState(idx) {
      const p = plugins.get(idx);
      return p ? stringify({ loaded: p.loaded, hooks: p.hooks }) : '';
    },
    dispatch(runId, name, payloadJson) {
      startRun(runId, name, payloadJson, sorted(name), (payload) => bottomFor(name, payload), budgetFor(name));
    },
    // A message from a mod's context.
    receive(idx, json) {
      const m = parse(json);
      switch (m.k) {
        case 'reg': {
          const plugin = plugins.get(idx);
          if (!plugin) return;
          const reg = { event: m.event, hook: m.hook, plugin, hasCatch: false, kind: 'hook', seq: ++seq };
          regs.set(m.hook, reg);
          if (!byEvent.has(m.event)) byEvent.set(m.event, []);
          byEvent.get(m.event).push(reg);
          plugin.hooks++;
          break;
        }
        case 'catch': {
          const reg = regs.get(m.hook);
          if (reg) reg.hasCatch = true;
          break;
        }
        case 'settled': settled(m); break;
        case 'next': down(m); break;
        default: native.diag('warn', '', 'chain: unknown message ' + String(m.k));
      }
    },
    poll(runId) {
      const r = results.get(runId);
      if (r === undefined) return undefined;
      results.delete(runId);
      runs.delete(runId);
      return r;
    },
    // Called when the engine interrupted the running hook, or when nothing can run any more.
    // Blames the innermost running frame. False means there was nobody to blame.
    recover() {
      const top = open[open.length - 1];
      if (!top || top.state !== 'running') return false;
      failed(top, 'timeout', 'over its budget of ' + top.budget + ' ms');
      return true;
    },
    // Time spent waiting for the host is not the hook's: push its deadline out by that much.
    advance(ms) {
      const top = open[open.length - 1];
      if (top && top.state === 'running' && !top.paused) {
        top.deadlineAt += ms;
        setTop();
      }
    },
    abort(runId) {
      const run = runs.get(runId);
      if (run) run.aborted = true;
      runs.delete(runId);
      results.delete(runId);
      open.length = 0;
      frames.clear();
      native.setDeadline(Infinity);
    },
    stats() {
      return stringify({ plugins: plugins.size, regs: regs.size, open: open.length, frames: frames.size });
    },
  };
})
