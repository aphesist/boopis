// One mod's side of the runtime, in the mod's own context: its `$`, its hooks, handlers, timers,
// state atoms, `console`, and the serialisation of element trees. Nothing here is shared with
// another mod: the chain (`chain.js`) lives in a different context, and the two talk in JSON
// messages routed by Rust.
//
// The bootstrap captures every primitive it needs in the closure below, then freezes the
// intrinsics before any mod code is evaluated, so a mod cannot patch `JSON.stringify`, `Promise`,
// `Object.keys` or a prototype to change what this file does later. The plugin name attached to
// each host call is set by Rust, in the native function itself, and is not something this file or
// the mod can change.
//
// Natives: `host(call, argsJson)`, `send(json)`, `now()`, `diag(level, message)`.
(function (native, info) {
  'use strict';

  const g = globalThis;
  const { Object: O, Reflect: R, JSON: J, Map, Set, Promise, Symbol, Error, TypeError, RangeError, Array: A, String: S, Number: N, Proxy, AbortController } = g;
  const stringify = J.stringify;
  const parse = J.parse;
  const keys = O.keys;
  const freeze = O.freeze;
  const isArray = A.isArray;
  const ELEMENT = Symbol.for('hx.element');
  const DEFAULT = Symbol('hx.default');
  const TIER_RANK = { prepend: 0, user: 1, append: 2 };
  const SERIALIZE_DEPTH_CAP = 64;
  const SERIALIZE_NODE_CAP = 100000;
  const idx = info.idx;

  let hookSeq = 0;
  let handlerSeq = 0;
  let atomSeq = 0;
  let timerSeq = 0;
  let tokenSeq = 0;
  let callSeq = 0;

  const handlers = new Map(); // id -> { fn, site }
  const siteHandlers = new Map(); // site -> Set of ids
  const staged = new Map(); // token -> { site, recs }
  const foreign = new Set(); // handler ids of other mods that were handed to us in a tree
  const atoms = new Map();
  const sites = new Map(); // site -> { component, id, reads: Set, run }
  const timers = new Map();
  const hooks = new Map(); // hook id -> { event, matcher, fn, catchFn }
  const frames = new Map(); // frame id -> { controller, e, thrown }
  const nexts = new Map(); // call id -> { resolve }
  const pendingCalls = new Map(); // host call id -> { resolve, reject }
  let currentSite = null;
  let registerFn = null;

  const message = (x) => (x && typeof x === 'object' && 'message' in x ? S(x.message) : S(x));
  const isElement = (v) => v !== null && typeof v === 'object' && v[ELEMENT] === true;
  const send = (m) => native.send(stringify(m));

  function deepFreeze(v, seen = new Set()) {
    if (v === null || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v)) return v;
    seen.add(v);
    for (const k of R.ownKeys(v)) {
      const d = O.getOwnPropertyDescriptor(v, k);
      if (d && 'value' in d) deepFreeze(d.value, seen);
    }
    return freeze(v);
  }

  // ---- matchers ---------------------------------------------------------------------------
  function matchValue(want, got) {
    if (want instanceof RegExp) {
      want.lastIndex = 0;
      return typeof got === 'string' && want.test(got);
    }
    if (isArray(want)) return want.some((w) => matchValue(w, got));
    return want === got;
  }
  function matches(matcher, e) {
    if (!matcher) return true;
    for (const key of keys(matcher)) if (!matchValue(matcher[key], e === null || e === undefined ? undefined : e[key])) return false;
    return true;
  }

  // ---- host calls: every one is a promise ------------------------------------------------------
  function hostCall(call, args) {
    return new Promise((resolve, reject) => {
      let r;
      try {
        r = parse(native.host(call, stringify(args === undefined ? null : args)));
      } catch (x) {
        reject(x);
        return;
      }
      if (r.pending !== undefined) {
        pendingCalls.set(r.pending, { resolve, reject });
        return;
      }
      settleCall({ resolve, reject }, r);
    });
  }
  function settleCall(p, r) {
    if (r.err) {
      const err = new Error(r.err.message);
      err.code = r.err.code;
      p.reject(err);
    } else {
      p.resolve(r.ok === undefined ? undefined : deepFreeze(r.ok));
    }
  }
  const fireAndForget = (call, args) => { hostCall(call, args).catch(() => {}); };

  function invalidateReaders(atom) {
    for (const key of atom.readers) {
      const site = sites.get(key);
      if (site) fireAndForget('ui.invalidate', { target: 'ui.render', component: site.component, id: site.id });
    }
  }

  const unsupported = (ns) => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? (...a) => hostCall(ns + '.' + name, a[0]) : undefined) });

  function makeDollar(plugin) {
    const atomOf = (handle) => {
      const a = handle && atoms.get(handle.id);
      if (!a) throw new TypeError('not an atom of this plugin');
      return a;
    };
    const ui = {
      open: (spec) => hostCall('ui.open', spec),
      close: (spec) => hostCall('ui.close', spec),
      invalidate: (target) => hostCall('ui.invalidate', { target: target === undefined ? 'ui.render' : target }),
      toast: (text, opts) => hostCall('ui.toast', { text, ...(opts || {}) }),
      status: (text) => hostCall('ui.status', { text }),
      log: (text, opts) => hostCall('ui.log', { text, ...(opts || {}) }),
      notify: (text, opts) => hostCall('ui.notify', { text, ...(opts || {}) }),
      ask: (question, opts) => hostCall('ui.ask', { question, ...(opts || {}) }),
    };
    return deepFreeze({
      plugin: { name: plugin.name, tier: plugin.tier, options: plugin.options },
      ui,
      state: {
        atom(initial) {
          const id = 'a' + ++atomSeq;
          atoms.set(id, { value: initial, readers: new Set() });
          return freeze({ id });
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
      store: {
        get: (key) => hostCall('store.get', { key }),
        set: (key, value) => hostCall('store.set', { key, value }),
        delete: (key) => hostCall('store.delete', { key }),
        keys: () => hostCall('store.keys', {}),
      },
      clock: {
        now: () => hostCall('clock.now', {}),
        every(ms, fn) {
          if (typeof fn !== 'function' || !(ms > 0)) throw new TypeError('clock.every(ms, fn) needs a positive interval and a function');
          const id = idx + '.t' + ++timerSeq;
          timers.set(id, { fn });
          hostCall('clock.every', { id, ms }).catch((x) => { timers.delete(id); native.diag('warn', 'clock.every refused: ' + message(x)); });
          const stop = () => {
            if (timers.delete(id)) fireAndForget('clock.cancel', { id });
          };
          stop.id = id;
          return stop;
        },
      },
      command: { register: (spec) => hostCall('command.register', spec) },
      config: { get: (key) => hostCall('config.get', { key }) },
      env: { get: (name) => hostCall('env.get', { name }) },
      theme: {
        set: (spec) => hostCall('theme.set', spec),
        clear: () => hostCall('theme.clear', {}),
      },
      fs: {
        read: (path, opts) => hostCall('fs.read', { path, ...(opts || {}) }),
        write: (path, content, opts) => hostCall('fs.write', { path, content, ...(opts || {}) }),
      },
      http: { fetch: (url, init) => hostCall('http.fetch', { url, ...(init || {}) }) },
      session: { messages: (opts) => hostCall('session.messages', opts || {}) },
      // Not in boopis yet: the call goes to the plugin, which refuses it by name and records it.
      process: unsupported('process'),
      mcp: unsupported('mcp'),
      model: unsupported('model'),
      agent: unsupported('agent'),
      tool: unsupported('tool'),
      prompt: unsupported('prompt'),
      turn: unsupported('turn'),
      settings: unsupported('settings'),
      audio: unsupported('audio'),
      telemetry: unsupported('telemetry'),
    });
  }

  const plugin = { name: info.name, tier: info.tier, options: info.options };
  const dollar = makeDollar(plugin);

  // ---- console: the mod's log line -----------------------------------------------------------
  const show = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.name + ': ' + v.message;
    try { const t = stringify(v); return t === undefined ? S(v) : t; } catch { return S(v); }
  };
  const line = (args) => args.map(show).join(' ');
  const consoleObj = {};
  for (const level of ['log', 'info', 'warn', 'error']) {
    consoleObj[level] = (...args) => { fireAndForget('ui.log', { text: line(args) }); };
  }
  consoleObj.debug = (...args) => { fireAndForget('ui.log', { text: line(args), to: 'debug' }); };

  // ---- registration ---------------------------------------------------------------------------
  function on(event, a, b) {
    const fn = typeof a === 'function' ? a : b;
    const matcher = typeof a === 'function' ? undefined : a;
    if (typeof event !== 'string' || typeof fn !== 'function') throw new TypeError('on(event, matcher?, hook) needs an event name and a function');
    const id = idx + '.k' + ++hookSeq;
    const rec = { event, matcher, fn, catchFn: null };
    hooks.set(id, rec);
    send({ k: 'reg', event, hook: id });
    const handle = {
      catch(catchFn) {
        if (typeof catchFn !== 'function') throw new TypeError('.catch(handler) needs a function');
        rec.catchFn = catchFn;
        send({ k: 'catch', hook: id });
        return handle;
      },
    };
    return handle;
  }

  // ---- values between contexts ---------------------------------------------------------------
  function element(type, props, children) {
    return freeze({ [ELEMENT]: true, type, props: freeze(props), children: freeze(children) });
  }
  function rebuild(node) {
    if (typeof node === 'string') return node;
    const props = {};
    for (const k of keys(node.props)) {
      const v = node.props[k];
      if (v !== null && typeof v === 'object' && '$handler' in v) foreign.add(v.$handler);
      props[k] = v;
    }
    return element(node.type, props, node.children.map(rebuild));
  }
  function decode(text) {
    if (text === undefined || text === null) return undefined;
    const v = parse(text);
    if (v !== null && typeof v === 'object') {
      if (v.$default === true) return freeze({ [DEFAULT]: true, event: deepFreeze(v.event) });
      if ('$el' in v) return rebuild(v.$el);
    }
    return deepFreeze(v);
  }

  // Element trees leave as JSON with functions replaced by handler ids. Handlers are staged under
  // a token and installed only when Rust has validated the tree and says `commit`.
  function serialize(root, site) {
    const recs = [];
    let count = 0;
    const kids = (list, out, depth) => {
      for (const c of list) {
        if (isArray(c)) kids(c, out, depth);
        else if (typeof c === 'string') out.push(c);
        else if (typeof c === 'number') out.push(S(c));
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
      for (const k of keys(el.props)) {
        const v = el.props[k];
        if (typeof v === 'function') {
          const id = idx + '.h' + ++handlerSeq;
          recs.push([id, v]);
          props[k] = { $handler: id };
        } else if (v !== undefined) {
          if (v !== null && typeof v === 'object' && '$handler' in v) {
            // Only a handler of another mod that was handed to us in a tree may pass through.
            if (!foreign.has(v.$handler)) throw new TypeError('a prop may not carry a $handler key');
          }
          props[k] = v;
        }
      }
      return { type: el.type, props, children: kids(el.children, [], depth) };
    };
    const tree = walk(root, 1);
    const token = 'r' + idx + '.' + ++tokenSeq;
    staged.set(token, { site, recs });
    return { tree, token };
  }

  // The answer of a hook as JSON text, plus the token of a tree it drew.
  function encode(v, site) {
    if (v === undefined) return { value: undefined };
    if (isElement(v)) {
      const { tree, token } = serialize(v, site);
      return { value: stringify({ $el: tree }), tok: token };
    }
    if (v !== null && typeof v === 'object' && v[DEFAULT] === true) return { value: stringify({ $default: true, event: v.event }) };
    const text = stringify(v);
    return { value: text };
  }

  function makeNext(frame, e, inv) {
    const callDown = (ev, tier) => {
      const call = 'n' + ++callSeq;
      return new Promise((resolve) => {
        nexts.set(call, resolve);
        send({ k: 'next', frame: inv.frame, call, e: stringify(ev === undefined ? e : ev), tier });
      });
    };
    const next = (...a) => callDown(a.length > 0 && a[0] !== undefined ? a[0] : undefined, undefined);
    next.to = (e2, tier) => {
      if (!(tier in TIER_RANK)) throw new TypeError('unknown tier ' + S(tier));
      return callDown(e2, tier);
    };
    next.signal = frame.controller.signal;
    next.origin = freeze({ plugin: plugin.name, tier: inv.tier });
    next.budget = inv.budget;
    if (inv.failure) {
      next.error = inv.failure.kind;
      next.cause = frame.cause;
      next.called = inv.failure.called;
    }
    return next;
  }

  // ---- running a hook, a handler, a timer or `register` ------------------------------------------
  function invoke(inv) {
    const frame = { controller: new AbortController(), cause: undefined };
    frames.set(inv.frame, frame);
    // Hook code always starts in a job, as it would anywhere else, never on the caller's stack.
    Promise.resolve().then(() => run(inv, frame));
  }

  function settle(inv, status, extra) {
    frames.delete(inv.frame);
    currentSite = null;
    send({ k: 'settled', frame: inv.frame, status, ...extra });
  }

  async function run(inv, frame) {
    let fn;
    let e;
    let value;
    try {
      if (inv.kind === 'register') {
        if (typeof registerFn !== 'function') throw new TypeError('no register function');
        await registerFn(on, plugin.options);
        settle(inv, 'ok', {});
        return;
      }
      if (inv.kind === 'callback') {
        const rec = handlers.get(inv.hook) || timers.get(inv.hook);
        if (!rec) {
          native.diag('warn', 'handler ' + inv.hook + ' is gone');
          settle(inv, 'ok', { value: stringify({ handled: false }) });
          return;
        }
        const arg = parse(inv.e).value;
        await rec.fn(arg);
        settle(inv, 'ok', { value: stringify({ handled: true }) });
        return;
      }
      const rec = hooks.get(inv.hook);
      if (!rec) throw new Error('hook is gone');
      e = deepFreeze(parse(inv.e));
      if (inv.kind === 'hook' && !matches(rec.matcher, e)) {
        settle(inv, 'nomatch', {});
        return;
      }
      if (inv.event === 'ui.render' && inv.site !== undefined) {
        const previous = sites.get(inv.site);
        if (!previous || previous.run !== inv.run) {
          if (previous) for (const a of previous.reads) { const atom = atoms.get(a); if (atom) atom.readers.delete(inv.site); }
          sites.set(inv.site, { component: e.component, id: e.id, reads: new Set(), run: inv.run });
        }
        currentSite = inv.site;
      }
      if (inv.failure) frame.cause = new Error(inv.failure.message);
      fn = inv.kind === 'catch' ? rec.catchFn : rec.fn;
      value = await fn(dollar, e, makeNext(frame, e, inv));
      let out;
      try {
        out = encode(value, inv.site);
      } catch (x) {
        // A tree that cannot be serialised is an invalid drawing, not a throwing hook.
        if (!isElement(value)) throw x;
        out = { value: stringify({ $invalid: message(x) }) };
      }
      settle(inv, 'ok', out.tok === undefined ? { value: out.value } : { value: out.value, tok: out.tok });
    } catch (x) {
      settle(inv, 'threw', { error: message(x) });
    }
  }

  function commit(m) {
    for (const id of siteHandlers.get(m.site) || []) handlers.delete(id);
    siteHandlers.delete(m.site);
    const ids = new Set();
    for (const token of m.tokens) {
      const s = staged.get(token);
      staged.delete(token);
      if (!s || !m.ok) continue;
      for (const [id, fn] of s.recs) { handlers.set(id, { fn }); ids.add(id); }
    }
    if (m.ok) siteHandlers.set(m.site, ids);
  }

  const api = {
    // Rust gives the module's `register` export after evaluating it.
    load(register) { registerFn = register; },
    receive(json) {
      const m = parse(json);
      switch (m.k) {
        case 'invoke': invoke(m); break;
        case 'nextDone': {
          const resolve = nexts.get(m.call);
          nexts.delete(m.call);
          if (resolve) resolve(decode(m.value));
          break;
        }
        case 'abort': {
          const f = frames.get(m.frame);
          if (f) f.controller.abort(new Error(m.message));
          break;
        }
        case 'commit': commit(m); break;
        default: native.diag('warn', 'agent: unknown message ' + S(m.k));
      }
    },
    // The host's answer to a call that was pending.
    complete(callId, replyJson) {
      const p = pendingCalls.get(callId);
      pendingCalls.delete(callId);
      if (p) settleCall(p, parse(replyJson));
    },
    stats() {
      return stringify({ hooks: hooks.size, handlers: handlers.size, atoms: atoms.size, timers: timers.size, pending: pendingCalls.size });
    },
  };

  // ---- freeze the intrinsics, then publish `console` -----------------------------------------------
  // `console` is part of what is frozen: it is ours, and a mod may call it but not replace its parts.
  O.defineProperty(g, 'console', { value: deepFreeze(consoleObj), writable: true, configurable: true, enumerable: false });
  hardenIntrinsics();
  return api;

  function hardenIntrinsics() {
    const seen = new Set();
    const roots = [];
    const add = (v) => { if (v !== null && (typeof v === 'object' || typeof v === 'function') && !seen.has(v)) { seen.add(v); roots.push(v); } };
    // The "override mistake": once Object.prototype is frozen, `obj.toString = f` throws in strict code
    // because an inherited data property is read-only. These few properties become accessors that
    // define an own property on assignment, as SES does, so ordinary mods keep working.
    const REPAIR = ['constructor', 'toString', 'toJSON', 'valueOf', 'toLocaleString', 'name', 'message', 'stack', 'cause'];
    const repair = (obj) => {
      for (const k of REPAIR) {
        const d = O.getOwnPropertyDescriptor(obj, k);
        if (!d || !('value' in d) || !d.configurable) continue;
        const value = d.value;
        O.defineProperty(obj, k, {
          configurable: false,
          enumerable: d.enumerable,
          get() { return value; },
          set(v) {
            if (this === obj) throw new TypeError('Cannot assign to read only property ' + S(k));
            O.defineProperty(this, k, { value: v, writable: true, enumerable: true, configurable: true });
          },
        });
      }
    };
    for (const name of O.getOwnPropertyNames(g)) {
      if (name === 'globalThis' || name === 'console' || name === 'undefined' || name === 'NaN' || name === 'Infinity') continue;
      const d = O.getOwnPropertyDescriptor(g, name);
      if (d && 'value' in d) add(d.value);
    }
    // Prototypes the globals do not name.
    add(O.getPrototypeOf(function* () {}));
    add(O.getPrototypeOf(async function () {}));
    add(O.getPrototypeOf(async function* () {}));
    add(O.getPrototypeOf(O.getPrototypeOf([][Symbol.iterator]())));
    add(O.getPrototypeOf(new Map()[Symbol.iterator]()));
    add(O.getPrototypeOf(new Set()[Symbol.iterator]()));
    add(O.getPrototypeOf(''[Symbol.iterator]()));
    add(O.getPrototypeOf(Int8Array));
    for (let i = 0; i < roots.length; i++) {
      const v = roots[i];
      for (const k of R.ownKeys(v)) {
        const d = O.getOwnPropertyDescriptor(v, k);
        if (!d) continue;
        if ('value' in d) add(d.value);
        else { add(d.get); add(d.set); }
      }
      add(O.getPrototypeOf(v));
    }
    // Do not freeze the global object itself, or the `$`-free module scope of a mod could not
    // define globals; do freeze everything it can reach and would share.
    for (const v of roots) {
      if (v === g) continue;
      if (typeof v === 'function' || typeof v === 'object') repair(v);
    }
    for (const v of roots) if (v !== g) { try { freeze(v); } catch { /* an exotic object that refuses */ } }
  }
})
