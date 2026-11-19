// The standard web APIs a mod may rely on, installed once per isolate before the kernel.
// QuickJS is plain ECMAScript: it has none of these, so each one is written here on top of a
// few native helpers (`native.urlParse`, `native.digest`, `native.randomHex`). Anything not
// installed here does not exist in the isolate: no `fetch`, no timers, no `console`, no `process`.
(function (native, g) {
  'use strict';

  const define = (name, value) =>
    Object.defineProperty(g, name, { value, writable: true, configurable: true, enumerable: false });

  define('queueMicrotask', (fn) => {
    if (typeof fn !== 'function') throw new TypeError('queueMicrotask expects a function');
    Promise.resolve().then(fn);
  });

  // ---- TextEncoder / TextDecoder (UTF-8 only) -------------------------------------------
  class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(input = '') {
      const out = [];
      for (const ch of String(input)) {
        let c = ch.codePointAt(0);
        if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return Uint8Array.from(out);
    }
  }
  class TextDecoder {
    constructor(label = 'utf-8') {
      const l = String(label).toLowerCase();
      if (l !== 'utf-8' && l !== 'utf8') throw new RangeError('only utf-8 is supported');
    }
    get encoding() { return 'utf-8'; }
    decode(input) {
      const b = input === undefined ? new Uint8Array(0)
        : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
      let out = '';
      let i = 0;
      while (i < b.length) {
        const c = b[i];
        let cp;
        let n;
        if (c < 0x80) { cp = c; n = 0; }
        else if (c >= 0xc2 && c <= 0xdf) { cp = c & 0x1f; n = 1; }
        else if (c >= 0xe0 && c <= 0xef) { cp = c & 0x0f; n = 2; }
        else if (c >= 0xf0 && c <= 0xf4) { cp = c & 0x07; n = 3; }
        else { out += '�'; i++; continue; }
        let ok = true;
        for (let k = 1; k <= n; k++) {
          const d = b[i + k];
          if (d === undefined || (d & 0xc0) !== 0x80) { ok = false; break; }
          cp = (cp << 6) | (d & 63);
        }
        if (!ok || (n === 2 && cp < 0x800) || (n === 3 && (cp < 0x10000 || cp > 0x10ffff)) ||
            (cp >= 0xd800 && cp <= 0xdfff)) { out += '�'; i++; continue; }
        out += String.fromCodePoint(cp);
        i += n + 1;
      }
      return out;
    }
  }
  define('TextEncoder', TextEncoder);
  define('TextDecoder', TextDecoder);

  // ---- AbortController / AbortSignal ------------------------------------------------------
  class AbortSignal {
    #listeners = [];
    aborted = false;
    reason = undefined;
    onabort = null;
    addEventListener(type, fn) { if (type === 'abort' && typeof fn === 'function') this.#listeners.push(fn); }
    removeEventListener(type, fn) { this.#listeners = this.#listeners.filter((f) => f !== fn); }
    throwIfAborted() { if (this.aborted) throw this.reason; }
    static abort(reason) { const s = new AbortSignal(); s._abort(reason); return s; }
    _abort(reason) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason === undefined ? new Error('aborted') : reason;
      const ev = { type: 'abort', target: this };
      if (typeof this.onabort === 'function') this.onabort(ev);
      for (const fn of this.#listeners.slice()) fn(ev);
    }
  }
  class AbortController {
    signal = new AbortSignal();
    abort(reason) { this.signal._abort(reason); }
  }
  define('AbortSignal', AbortSignal);
  define('AbortController', AbortController);

  // ---- URL / URLSearchParams ----------------------------------------------------------------
  const formEncode = (s) =>
    encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const formDecode = (s) => {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
  };
  class URLSearchParams {
    #list = [];
    #onChange = null;
    constructor(init = '', onChange = null) {
      this.#onChange = onChange;
      if (typeof init === 'string') {
        const s = init.startsWith('?') ? init.slice(1) : init;
        for (const part of s.split('&')) {
          if (part === '') continue;
          const eq = part.indexOf('=');
          this.#list.push(eq < 0 ? [formDecode(part), ''] : [formDecode(part.slice(0, eq)), formDecode(part.slice(eq + 1))]);
        }
      } else if (init && typeof init[Symbol.iterator] === 'function') {
        for (const [k, v] of init) this.#list.push([String(k), String(v)]);
      } else if (init && typeof init === 'object') {
        for (const k of Object.keys(init)) this.#list.push([k, String(init[k])]);
      }
    }
    #changed() { if (this.#onChange) this.#onChange(this.toString()); }
    get size() { return this.#list.length; }
    append(k, v) { this.#list.push([String(k), String(v)]); this.#changed(); }
    delete(k) { this.#list = this.#list.filter(([n]) => n !== String(k)); this.#changed(); }
    get(k) { const e = this.#list.find(([n]) => n === String(k)); return e ? e[1] : null; }
    getAll(k) { return this.#list.filter(([n]) => n === String(k)).map(([, v]) => v); }
    has(k) { return this.#list.some(([n]) => n === String(k)); }
    set(k, v) {
      const key = String(k);
      const i = this.#list.findIndex(([n]) => n === key);
      if (i < 0) this.#list.push([key, String(v)]);
      else { this.#list[i][1] = String(v); this.#list = this.#list.filter(([n], j) => n !== key || j <= i); }
      this.#changed();
    }
    sort() { this.#list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); this.#changed(); }
    forEach(fn, self) { for (const [k, v] of this.#list) fn.call(self, v, k, this); }
    *entries() { for (const e of this.#list) yield [e[0], e[1]]; }
    *keys() { for (const [k] of this.#list) yield k; }
    *values() { for (const [, v] of this.#list) yield v; }
    [Symbol.iterator]() { return this.entries(); }
    toString() { return this.#list.map(([k, v]) => formEncode(k) + '=' + formEncode(v)).join('&'); }
  }
  class URL {
    #p;
    #params;
    constructor(href, base) {
      const raw = native.urlParse(String(href), base === undefined ? '' : String(base));
      if (!raw) throw new TypeError('Invalid URL: ' + String(href));
      this.#p = JSON.parse(raw);
      this.#params = new URLSearchParams(this.#p.search);
    }
    static canParse(href, base) {
      return native.urlParse(String(href), base === undefined ? '' : String(base)) !== '';
    }
    get href() { return this.#p.href; }
    get origin() { return this.#p.origin; }
    get protocol() { return this.#p.protocol; }
    get username() { return this.#p.username; }
    get password() { return this.#p.password; }
    get host() { return this.#p.host; }
    get hostname() { return this.#p.hostname; }
    get port() { return this.#p.port; }
    get pathname() { return this.#p.pathname; }
    get search() { return this.#p.search; }
    get hash() { return this.#p.hash; }
    get searchParams() { return this.#params; }
    toString() { return this.#p.href; }
    toJSON() { return this.#p.href; }
  }
  define('URLSearchParams', URLSearchParams);
  define('URL', URL);

  // ---- crypto: getRandomValues, randomUUID, subtle.digest ----------------------------------
  const toHex = (bytes) => { let s = ''; for (const b of bytes) s += (b < 16 ? '0' : '') + b.toString(16); return s; };
  const fromHex = (h) => { const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; };
  const randomBytes = (n) => fromHex(native.randomHex(n));
  const bytesOf = (data) => ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
  const subtle = {
    async digest(algorithm, data) {
      const name = typeof algorithm === 'string' ? algorithm : algorithm && algorithm.name;
      const hex = native.digest(String(name).toUpperCase(), toHex(bytesOf(data)));
      if (hex === '') throw new DOMExceptionLike('NotSupportedError', 'unsupported digest algorithm: ' + name);
      return fromHex(hex).buffer;
    },
  };
  class DOMExceptionLike extends Error {
    constructor(name, message) { super(message); this.name = name; }
  }
  const crypto = {
    subtle,
    getRandomValues(array) {
      if (!ArrayBuffer.isView(array) || array instanceof Float32Array || array instanceof Float64Array) {
        throw new TypeError('getRandomValues expects an integer typed array');
      }
      if (array.byteLength > 65536) throw new DOMExceptionLike('QuotaExceededError', 'at most 65536 bytes');
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(randomBytes(array.byteLength));
      return array;
    },
    randomUUID() {
      const b = randomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = toHex(b);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  };
  define('crypto', crypto);
})
