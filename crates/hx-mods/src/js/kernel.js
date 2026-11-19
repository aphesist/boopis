// The event chain and the `$` API, running inside the isolate. Nothing here reaches outside
// except through `native`: `host` (a `$` call leaving as a request), `now`, `setDeadline`,
// `diag`. The bootstrap passes `native` in and keeps it out of the global scope, so a mod
// cannot call the host except through its own `$`.
//
// Why callbacks and not `async` functions in the driver: when a hook runs past its budget the
// engine's interrupt handler raises an uncatchable exception that unwinds whatever JavaScript
// is on the stack. Every piece of driver state that must survive (the frame, the way to
// resume the chain) therefore lives in plain objects that `recover()` can reach afterwards.
(function (native) {
  'use strict';

  const ELEMENT = Symbol.for('hx.element');
  const DEFAULT = Symbol('hx.default');
  const TIER_RANK = { prepend: 0, user: 1, append: 2 };
  const SERIALIZE_DEPTH_CAP = 64; // a safety valve against cycles; the real limits are checked in Rust
  const SERIALIZE_NODE_CAP = 100000;

  let cfg = { default: 10000, promptEdit: 50, catch: 1000 };
  let seq = 0;
  let handlerSeq = 0;
  let atomSeq = 0;
  let timerSeq = 0;
  let tokenSeq = 0;

  const plugins = new Map();
  const byEvent = new Map();
  const open = []; // frames whose hook is running or waiting on `next`, innermost last
  const results = new Map();
  const handlers = new Map(); // id -> { fn, plugin, site }
  const siteHandlers = new Map(); // site key -> Set of ids
  const staged = new Map(); // token -> { site, plugin, recs }
  const atoms = new Map(); // id -> { value, plugin, readers: Set of site keys }
  const sites = new Map(); // site key -> { component, id, reads: Set of atom ids }
  const timers = new Map(); // id -> { fn, plugin }
  let currentSite = null;

  const message = (x) => (x && typeof x === 'object' && 'message' in x ? String(x.message) : String(x));
  const isElement = (v) => v !== null && typeof v === 'object' && v[ELEMENT] === true;

  function deepFreeze(v, seen = new Set()) {
    if (v === null || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v)) return v;
    seen.add(v);
    for (const k of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (d && 'value' in d) deepFreeze(d.value, seen);
    }
    return Object.freeze(v);
  }

  // ---- matchers ---------------------------------------------------------------------------
  function matchValue(want, got) {
    if (want instanceof RegExp) {
      want.lastIndex = 0;
      return typeof got === 'string' && want.test(got);
    }
    if (Array.isArray(want)) return want.some((w) => matchValue(w, got));
    return want === got;
  }
  function matches(matcher, e) {
    if (!matcher) return true;
    for (const key of Object.keys(matcher)) if (!matchValue(matcher[key], e === null || e === undefined ? undefined : e[key])) return false;
    return true;
  }

  // ---- the `$` API --------------------------------------------------------------------------
  function hostSync(plugin, call, args) {
    const raw = native.host(plugin.name, call, JSON.stringify(args === undefined ? null : args));
    const r = JSON.parse(raw);
    if (r.err) {
      const err = new Error(r.err.message);
      err.code = r.err.code;
      throw err;
    }
    return r.ok === undefined ? undefined : r.ok;
  }
  const hostAsync = (plugin, call, args) =>
    new Promise((resolve, reject) => {
      try { resolve(hostSync(plugin, call, args)); } catch (x) { reject(x); }
    });

  function invalidateReaders(atom) {
    for (const key of atom.readers) {
      const site = sites.get(key);
      if (site) hostSync(atom.plugin, 'ui.invalidate', { target: 'ui.render', component: site.component, id: site.id });
    }
  }

  function makeDollar(plugin) {
    const atomOf = (handle) => {
      const a = handle && atoms.get(handle.id);
      if (!a || a.plugin !== plugin) throw new TypeError('not an atom of this plugin');
      return a;
    };
    return deepFreeze({
      plugin: { name: plugin.name, tier: plugin.tier, options: plugin.options },
      ui: {
        open: (spec) => hostAsync(plugin, 'ui.open', spec),
        close: (spec) => hostAsync(plugin, 'ui.close', spec),
        invalidate: (target) => hostAsync(plugin, 'ui.invalidate', { target: target === undefined ? 'ui.render' : target }),
        toast: (text, opts) => hostAsync(plugin, 'ui.toast', { text, ...(opts || {}) }),
        status: (text) => hostAsync(plugin, 'ui.status', { text }),
        log: (text) => hostAsync(plugin, 'ui.log', { text }),
      },
      state: {
        atom(initial) {
          const id = 'a' + ++atomSeq;
          atoms.set(id, { value: initial, plugin, readers: new Set() });
          return Object.freeze({ id });
        },
        read(handle) {
          const a = atomOf(handle);
          if (currentSite) {
            a.readers.add(currentSite);
            sites.get(currentSite).reads.add(handle.id);
          }
          return a.value;
        },
        update(handle, next) {
          const a = atomOf(handle);
          a.value = typeof next === 'function' ? next(a.value) : next;
          invalidateReaders(a);
          return a.value;
        },
      },
      clock: {
        every(ms, fn) {
          if (typeof fn !== 'function' || !(ms > 0)) throw new TypeError('clock.every(ms, fn) needs a positive interval and a function');
          const id = 't' + ++timerSeq;
          timers.set(id, { fn, plugin });
          hostSync(plugin, 'clock.every', { id, ms });
          const stop = () => {
            if (timers.delete(id)) hostSync(plugin, 'clock.cancel', { id });
          };
          stop.id = id;
          return stop;
        },
      },
      command: {
        register: (spec) => hostAsync(plugin, 'command.register', spec),
      },
    });
  }

  // ---- registration ---------------------------------------------------------------------------
  function makeOn(plugin) {
    return (event, a, b) => {
      const hook = typeof a === 'function' ? a : b;
      const matcher = typeof a === 'function' ? undefined : a;
      if (typeof event !== 'string' || typeof hook !== 'function') throw new TypeError('on(event, matcher?, hook) needs an event name and a function');
      const reg = { event, matcher, hook, catchFn: null, plugin, seq: ++seq };
      if (!byEvent.has(event)) byEvent.set(event, []);
      byEvent.get(event).push(reg);
      plugin.hooks++;
      const handle = {
        catch(fn) {
          if (typeof fn !== 'function') throw new TypeError('.catch(handler) needs a function');
          reg.catchFn = fn;
          return handle;
        },
      };
      return handle;
    };
  }
  const regsFor = (event) =>
    (byEvent.get(event) || []).slice().sort((x, y) => TIER_RANK[x.plugin.tier] - TIER_RANK[y.plugin.tier] || x.seq - y.seq);

  // ---- frames: one per running hook, with its own budget -------------------------------------
  function setTop() {
    const top = open[open.length - 1];
    native.setDeadline(top && !top.paused ? Math.max(0, top.deadlineAt - native.now()) : Infinity);
  }
  function leave(frame) {
    const k = open.lastIndexOf(frame);
    if (k >= 0) open.splice(k, 1);
    frame.state = 'done';
    setTop();
  }
  const budgetFor = (name) => (name === 'prompt.edit' ? cfg.promptEdit : cfg.default);

  function dispatchFrom(run, i, e) {
    e = deepFreeze(e);
    while (i < run.entries.length && !matches(run.entries[i].matcher, e)) i++;
    if (i >= run.entries.length) return run.bottom(e);
    return new Promise((resolve) => {
      const frame = frameFor(run, run.entries[i], i, e, resolve, 'hook');
      Promise.resolve().then(() => start(frame));
    });
  }

  function frameFor(run, reg, i, e, resolve, kind) {
    const frame = {
      run, reg, i, e, resolve, kind,
      state: 'new', paused: false, pausedAt: 0, deadlineAt: 0,
      budget: kind === 'catch' ? cfg.catch : run.budget,
      nextCalled: false, lastDown: undefined, orig: null,
      controller: new AbortController(),
    };
    frame.orig = frame;
    return frame;
  }

  function makeNext(frame) {
    const callDown = (ev, from) => {
      frame.nextCalled = true;
      frame.paused = true;
      frame.pausedAt = native.now();
      const p = Promise.resolve().then(() => dispatchFrom(frame.run, from, ev));
      frame.lastDown = p;
      const resume = () => {
        if (frame.state !== 'running') return;
        frame.paused = false;
        frame.deadlineAt += native.now() - frame.pausedAt;
        setTop();
      };
      p.then(resume, resume);
      return p;
    };
    const next = (...a) => callDown(a.length > 0 && a[0] !== undefined ? a[0] : frame.e, frame.i + 1);
    next.to = (e2, tier) => {
      if (!(tier in TIER_RANK)) throw new TypeError('unknown tier ' + String(tier));
      let from = frame.i + 1;
      while (from < frame.run.entries.length && TIER_RANK[frame.run.entries[from].plugin.tier] < TIER_RANK[tier]) from++;
      return callDown(e2 === undefined ? frame.e : e2, from);
    };
    next.signal = frame.controller.signal;
    next.origin = Object.freeze({ plugin: frame.reg.plugin.name, tier: frame.reg.plugin.tier });
    next.budget = frame.budget;
    return next;
  }

  function start(frame) {
    if (frame.run.aborted) return;
    open.push(frame);
    frame.state = 'running';
    frame.deadlineAt = native.now() + frame.budget;
    setTop();
    const fn = frame.kind === 'catch' ? frame.reg.catchFn : frame.reg.hook;
    const next = frame.next || (frame.next = makeNext(frame));
    if (frame.kind === 'catch') {
      next.error = frame.failure.kind;
      next.cause = frame.failure.error;
      next.called = frame.orig.nextCalled;
    }
    let p;
    try {
      p = fn(frame.reg.plugin.dollar, frame.e, next);
    } catch (x) {
      failed(frame, 'throw', x);
      return;
    }
    Promise.resolve(p).then((v) => finished(frame, v), (x) => failed(frame, 'throw', x));
  }

  function finished(frame, value) {
    if (frame.state !== 'running') return;
    leave(frame);
    if (isElement(value) && !frame.run.answeredBy) frame.run.answeredBy = frame.reg.plugin;
    frame.resolve(value);
  }

  function failed(frame, kind, error) {
    if (frame.state !== 'running') return;
    leave(frame);
    if (kind === 'timeout') frame.controller.abort(error);
    native.diag('warn', frame.reg.plugin.name, `${frame.reg.event}: ${frame.kind === 'catch' ? '.catch handler' : 'hook'} ${kind === 'timeout' ? 'timed out' : 'threw'}: ${message(error)}`);
    if (frame.kind === 'catch') return skip(frame.orig);
    if (frame.reg.catchFn) return runCatch(frame, kind, error);
    skip(frame);
  }

  function runCatch(frame, kind, error) {
    const cf = frameFor(frame.run, frame.reg, frame.i, frame.e, frame.resolve, 'catch');
    cf.orig = frame;
    cf.failure = { kind, error };
    // A catch handler calling `next` after the hook already did gets the same downstream answer.
    cf.next = makeNext(cf);
    if (frame.nextCalled) {
      cf.next = Object.assign(() => frame.lastDown, { to: () => frame.lastDown, signal: cf.next.signal, origin: cf.next.origin, budget: cf.budget });
    }
    Promise.resolve().then(() => start(cf));
  }

  function skip(frame) {
    if (frame.nextCalled) frame.resolve(frame.lastDown);
    else frame.resolve(dispatchFrom(frame.run, frame.i + 1, frame.e));
  }

  // ---- bottoms: what happens when no hook answers ------------------------------------------
  function callbackBottom(rec, label) {
    return (e) => {
      if (!rec) {
        native.diag('warn', '', `${label} is gone`);
        return undefined;
      }
      const reg = { event: 'callback', matcher: undefined, plugin: rec.plugin, catchFn: null, seq: 0,
        hook: async () => { await rec.fn(e.value); return { handled: true }; } };
      const run = { entries: [reg], bottom: () => undefined, budget: cfg.default, aborted: false };
      return dispatchFrom(run, 0, e);
    };
  }
  function bottomFor(name, payload) {
    switch (name) {
      case 'ui.render': return (e) => ({ [DEFAULT]: true, event: e });
      case 'ui.press': case 'ui.input': case 'ui.select': return callbackBottom(handlers.get(payload && payload.handler), 'handler ' + (payload && payload.handler));
      case 'clock.tick': return callbackBottom(timers.get(payload && payload.id), 'timer ' + (payload && payload.id));
      default: return () => undefined;
    }
  }

  // ---- ui.render results: element trees to JSON, handlers to ids ---------------------------------
  function serialize(root, run) {
    const recs = [];
    let count = 0;
    const kids = (list, out, depth) => {
      for (const c of list) {
        if (Array.isArray(c)) kids(c, out, depth);
        else if (typeof c === 'string') out.push(c);
        else if (typeof c === 'number') out.push(String(c));
        else if (c === null || c === undefined || typeof c === 'boolean') continue;
        else if (isElement(c)) out.push(walk(c, depth + 1));
        else throw new TypeError('a child must be a string, a number or an element');
      }
      return out;
    };
    const walk = (el, depth) => {
      if (depth > SERIALIZE_DEPTH_CAP) throw new RangeError('tree deeper than ' + SERIALIZE_DEPTH_CAP);
      if (++count > SERIALIZE_NODE_CAP) throw new RangeError('tree has more than ' + SERIALIZE_NODE_CAP + ' elements');
      const props = {};
      for (const k of Object.keys(el.props)) {
        const v = el.props[k];
        if (typeof v === 'function') {
          const id = 'h' + ++handlerSeq;
          recs.push([id, v]);
          props[k] = { $handler: id };
        } else if (v !== undefined) {
          if (v !== null && typeof v === 'object' && '$handler' in v) throw new TypeError('a prop may not carry a $handler key');
          props[k] = v;
        }
      }
      return { type: el.type, props, children: kids(el.children, [], depth) };
    };
    const tree = walk(root, 1);
    const json = JSON.stringify(tree);
    const token = 'r' + ++tokenSeq;
    staged.set(token, { site: run.site, plugin: run.answeredBy || run.firstPlugin, recs });
    return { token, json };
  }

  function renderResult(run, v) {
    if (v && v[DEFAULT]) return { render: { kind: 'default', props: v.event.props === undefined ? null : v.event.props } };
    if (v === undefined || v === null) return { render: { kind: 'default', props: null } };
    if (!isElement(v)) return { render: { kind: 'invalid', reason: 'a ui.render hook must return an element tree or call next' } };
    try {
      const { token, json } = serialize(v, run);
      return { render: { kind: 'tree', token, json } };
    } catch (x) {
      return { render: { kind: 'invalid', reason: message(x) } };
    }
  }

  function settle(run, build) {
    if (run.aborted) return;
    currentSite = null;
    try {
      results.set(run.id, JSON.stringify(build()));
    } catch (x) {
      results.set(run.id, JSON.stringify({ error: message(x) }));
    }
  }

  // ---- the API the host drives -----------------------------------------------------------------
  function startRun(id, name, payload, entries, bottom, budget) {
    const run = { id, name, entries, bottom, budget, aborted: false, answeredBy: null, site: null, firstPlugin: entries.length > 0 ? entries[0].plugin : null };
    if (name === 'ui.render') {
      const key = `${payload.component}:${payload.id === undefined ? '' : payload.id}`;
      run.site = key;
      const previous = sites.get(key);
      if (previous) for (const a of previous.reads) { const atom = atoms.get(a); if (atom) atom.readers.delete(key); }
      sites.set(key, { component: payload.component, id: payload.id, reads: new Set() });
      currentSite = key;
    }
    Promise.resolve()
      .then(() => dispatchFrom(run, 0, payload))
      .then(
        (v) => settle(run, () => (name === 'ui.render' ? renderResult(run, v) : { answered: v !== undefined, value: v })),
        (x) => settle(run, () => ({ error: message(x) })),
      );
    return run;
  }

  const runs = new Map();
  return {
    configure(json) {
      const c = JSON.parse(json);
      cfg = { default: c.default, promptEdit: c.promptEdit, catch: c.catch };
    },
    loadPlugin(runId, name, tier, optionsJson, register) {
      let plugin = plugins.get(name);
      if (plugin) {
        plugin.loaded = false;
      } else {
        plugin = { name, tier, options: JSON.parse(optionsJson), hooks: 0, loaded: false, dollar: null };
        plugin.dollar = makeDollar(plugin);
        plugins.set(name, plugin);
      }
      const on = makeOn(plugin);
      const reg = { event: 'plugin.register', matcher: undefined, plugin, catchFn: null, seq: 0,
        hook: async () => { await register(on, plugin.options); plugin.loaded = true; } };
      runs.set(runId, startRun(runId, 'plugin.register', {}, [reg], () => undefined, cfg.default));
    },
    pluginState(name) {
      const p = plugins.get(name);
      return p ? JSON.stringify({ loaded: p.loaded, hooks: p.hooks }) : '';
    },
    dispatch(runId, name, payloadJson) {
      const payload = payloadJson === '' ? undefined : JSON.parse(payloadJson);
      const entries = regsFor(name);
      runs.set(runId, startRun(runId, name, payload, entries, bottomFor(name, payload), budgetFor(name)));
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
      failed(top, 'timeout', new Error('over its budget of ' + top.budget + ' ms'));
      return true;
    },
    abort(runId) {
      const run = runs.get(runId);
      if (run) run.aborted = true;
      runs.delete(runId);
      results.delete(runId);
      open.length = 0;
      currentSite = null;
      native.setDeadline(Infinity);
    },
    commit(token, ok) {
      const s = staged.get(token);
      staged.delete(token);
      if (!s || !ok) return;
      for (const id of siteHandlers.get(s.site) || []) handlers.delete(id);
      const ids = new Set();
      for (const [id, fn] of s.recs) {
        handlers.set(id, { fn, plugin: s.plugin, site: s.site });
        ids.add(id);
      }
      siteHandlers.set(s.site, ids);
    },
    stats() {
      return JSON.stringify({ plugins: plugins.size, handlers: handlers.size, atoms: atoms.size, timers: timers.size, open: open.length });
    },
  };
})
