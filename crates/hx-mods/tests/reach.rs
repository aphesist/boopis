//! What a mod can reach from inside the isolate: which globals exist, how the web APIs behave,
//! and that nothing gives it files, a network or a process. The OS-level check (descriptors,
//! sockets, threads, children) is in `no_ambient_authority.rs`, in its own process.

// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{runtime, simple_plugin};
use hx_mods::{ModRuntime, Tier};
use serde_json::{Value, json};
use tempfile::{TempDir, tempdir};

/// A runtime with one mod whose `q` hook evaluates `body` (an async function body) and returns it.
fn ask(body: &str) -> (ModRuntime, TempDir) {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "probe",
        &format!("export function register(on) {{ on('q', async ($, e) => {{ {body} }}); }}"),
    );
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    (rt, dir)
}

fn eval(body: &str) -> Value {
    let (mut rt, _dir) = ask(body);
    rt.dispatch("q", &json!({})).unwrap().value
}

/// The global names the isolate has: ECMAScript itself, three engine extras QuickJS-NG ships
/// (`atob`, `btoa`, `performance`, `DOMException`), and the web APIs this crate installs. A new name
/// after an engine upgrade fails this test on purpose: decide whether a mod should see it.
const GLOBALS: &[&str] = &[
    "AbortController",
    "AbortSignal",
    "AggregateError",
    "Array",
    "ArrayBuffer",
    "AsyncDisposableStack",
    "Atomics",
    "BigInt",
    "BigInt64Array",
    "BigUint64Array",
    "Boolean",
    "DOMException",
    "DataView",
    "Date",
    "DisposableStack",
    "Error",
    "EvalError",
    "FinalizationRegistry",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "Function",
    "Infinity",
    "Int16Array",
    "Int32Array",
    "Int8Array",
    "InternalError",
    "Iterator",
    "JSON",
    "Map",
    "Math",
    "NaN",
    "Number",
    "Object",
    "Promise",
    "Proxy",
    "RangeError",
    "ReferenceError",
    "Reflect",
    "RegExp",
    "Set",
    "SharedArrayBuffer",
    "String",
    "SuppressedError",
    "Symbol",
    "SyntaxError",
    "TextDecoder",
    "TextEncoder",
    "TypeError",
    "URIError",
    "URL",
    "URLSearchParams",
    "Uint16Array",
    "Uint32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "WeakMap",
    "WeakRef",
    "WeakSet",
    "atob",
    "btoa",
    "crypto",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    "escape",
    "eval",
    "globalThis",
    "isFinite",
    "isNaN",
    "parseFloat",
    "parseInt",
    "performance",
    "queueMicrotask",
    "undefined",
    "unescape",
];

#[test]
fn the_global_scope_is_exactly_the_documented_set() {
    let names = eval("return Object.getOwnPropertyNames(globalThis).sort();");
    let names: Vec<&str> = names
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_str().unwrap())
        .collect();
    assert_eq!(names, GLOBALS);
}

#[test]
fn nothing_that_reaches_files_the_network_or_processes_exists() {
    let out = eval(
        "const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts',
           'require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer', 'Deno', 'Bun', 'std', 'os', 'scriptArgs',
           'print', 'console', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'navigator', 'window', 'self', 'document',
           'localStorage', 'indexedDB', 'caches', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
           'ReadableStream', 'structuredClone', 'native', 'WebAssembly', 'Intl', 'Event', 'EventTarget', 'MessageChannel', 'BroadcastChannel'];
         return names.filter((n) => typeof globalThis[n] !== 'undefined');",
    );
    assert_eq!(out, json!([]));
}

#[test]
fn dollar_is_the_only_door_and_modules_are_strict() {
    let out = eval(
        "return { dollar: Object.keys($).sort(),
                  sloppyThis: (function () { return this; })(),
                  assignGlobal: (() => { try { undeclared = 1; return 'assigned'; } catch (x) { return x.constructor.name; } })() };",
    );
    assert_eq!(
        out["dollar"],
        json!(["clock", "command", "plugin", "state", "ui"])
    );
    // Modules are strict: a bare function sees no `this`, and a stray assignment does not create a global.
    assert_eq!(out["sloppyThis"], Value::Null);
    assert_eq!(out["assignGlobal"], "ReferenceError");
}

#[test]
fn the_function_constructor_gives_the_same_global_and_no_more() {
    let out = eval(
        "const g = new Function('return this')();
         const own = Object.getOwnPropertyNames(g);
         return { same: g === globalThis, count: own.length };",
    );
    assert_eq!(out, json!({ "same": true, "count": GLOBALS.len() }));
}

// ---- the web APIs that exist ------------------------------------------------------------------

#[test]
fn url_and_url_search_params() {
    let out = eval(
        "const u = new URL('../b/c?x=1&y=a+b#frag', 'https://user:pw@Example.com:8443/a/d/e');
         u.searchParams.append('z', 'é&');
         return { href: u.href, origin: u.origin, host: u.host, hostname: u.hostname, port: u.port, path: u.pathname, search: u.search, hash: u.hash,
                  user: u.username, y: u.searchParams.get('y'), all: [...u.searchParams].length, canParse: [URL.canParse('nope'), URL.canParse('/x', 'http://h')],
                  bad: (() => { try { new URL('not a url'); return 'parsed'; } catch (x) { return x.constructor.name; } })(),
                  qs: new URLSearchParams({ a: '1', b: 'x y' }).toString() };",
    );
    assert_eq!(out["origin"], "https://example.com:8443");
    assert_eq!(
        (
            out["host"].as_str(),
            out["hostname"].as_str(),
            out["port"].as_str()
        ),
        (Some("example.com:8443"), Some("example.com"), Some("8443"))
    );
    assert_eq!(out["path"], "/a/b/c");
    assert_eq!(
        (
            out["search"].as_str(),
            out["hash"].as_str(),
            out["user"].as_str()
        ),
        (Some("?x=1&y=a+b"), Some("#frag"), Some("user"))
    );
    assert_eq!(out["y"], "a b");
    assert_eq!(out["canParse"], json!([false, true]));
    assert_eq!(out["bad"], "TypeError");
    assert_eq!(out["qs"], "a=1&b=x+y");
}

#[test]
fn text_encoder_and_decoder_round_trip_every_plane() {
    let out = eval(
        "const text = 'aé€😀\\u0000z';
         const bytes = new TextEncoder().encode(text);
         return { bytes: Array.from(bytes), back: new TextDecoder().decode(bytes) === text,
                  bad: new TextDecoder().decode(new Uint8Array([0x61, 0xff, 0xc3, 0x28, 0x62])),
                  lone: Array.from(new TextEncoder().encode('\\ud800')), enc: new TextEncoder().encoding,
                  label: (() => { try { new TextDecoder('latin1'); return 'ok'; } catch (x) { return x.constructor.name; } })() };",
    );
    assert_eq!(
        out["bytes"],
        json!([
            0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0, 0x7a
        ])
    );
    assert_eq!(out["back"], true);
    assert_eq!(out["bad"], "a\u{fffd}\u{fffd}(b");
    assert_eq!(out["lone"], json!([0xef, 0xbf, 0xbd]));
    assert_eq!(
        (out["enc"].as_str(), out["label"].as_str()),
        (Some("utf-8"), Some("RangeError"))
    );
}

#[test]
fn abort_controller_and_signal() {
    let out = eval(
        "const c = new AbortController(); const seen = [];
         c.signal.addEventListener('abort', () => seen.push('listener')); c.signal.onabort = () => seen.push('onabort');
         const before = c.signal.aborted; c.abort('why'); c.abort('again');
         let thrown; try { c.signal.throwIfAborted(); } catch (x) { thrown = x; }
         return { before, after: c.signal.aborted, reason: c.signal.reason, seen, thrown, pre: AbortSignal.abort().aborted };",
    );
    assert_eq!(
        out,
        json!({ "before": false, "after": true, "reason": "why", "seen": ["onabort", "listener"], "thrown": "why", "pre": true })
    );
}

#[test]
fn crypto_subtle_digest_get_random_values_and_random_uuid() {
    let out = eval(
        "const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
         const data = new TextEncoder().encode('abc');
         const algs = {};
         for (const a of ['SHA-256', 'sha-384', { name: 'SHA-512' }, 'SHA-1', 'MD5']) {
           try { algs[typeof a === 'string' ? a : a.name] = hex(await crypto.subtle.digest(a, data)).slice(0, 16); } catch (x) { algs[typeof a === 'string' ? a : a.name] = x.name; }
         }
         const r = crypto.getRandomValues(new Uint8Array(32));
         const u = crypto.randomUUID();
         return { algs, distinct: new Set(r).size > 8, uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u), another: u !== crypto.randomUUID(),
                  subtle: Object.keys(crypto.subtle), float: (() => { try { crypto.getRandomValues(new Float32Array(1)); return 'ok'; } catch (x) { return x.constructor.name; } })(),
                  big: (() => { try { crypto.getRandomValues(new Uint8Array(65537)); return 'ok'; } catch (x) { return x.name; } })() };",
    );
    assert_eq!(out["algs"]["SHA-256"], "ba7816bf8f01cfea");
    assert_eq!(out["algs"]["sha-384"], "cb00753f45a35e8b");
    assert_eq!(out["algs"]["SHA-512"], "ddaf35a193617aba");
    // Not provided: SHA-1 and MD5 refuse with a DOMException, never a wrong answer.
    assert_eq!(
        (out["algs"]["SHA-1"].as_str(), out["algs"]["MD5"].as_str()),
        (Some("NotSupportedError"), Some("NotSupportedError"))
    );
    assert_eq!(
        (
            out["distinct"].as_bool(),
            out["uuid"].as_bool(),
            out["another"].as_bool()
        ),
        (Some(true), Some(true), Some(true))
    );
    assert_eq!(
        out["subtle"],
        json!(["digest"]),
        "only `digest` exists on crypto.subtle"
    );
    assert_eq!(
        (out["float"].as_str(), out["big"].as_str()),
        (Some("TypeError"), Some("QuotaExceededError"))
    );
}

#[test]
fn queue_microtask_runs_after_the_current_job() {
    let out = eval(
        "const order = []; queueMicrotask(() => order.push('micro')); order.push('sync'); await null; order.push('after await'); return order;",
    );
    assert_eq!(out, json!(["sync", "micro", "after await"]));
}
