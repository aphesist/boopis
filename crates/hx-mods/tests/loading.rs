//! Loading a mod: manifests, `userConfig`, every module extension, TypeScript and JSX without a
//! build step, relative imports, the `claude-code` module, and everything a mod may not import.

// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;

use common::{runtime, simple_plugin, text_of, tree, write_plugin, write_raw};
use hx_mods::{Error, Render, Tier};
use serde_json::json;
use tempfile::tempdir;

fn load_err(plugin: &std::path::Path) -> Error {
    let (mut rt, _) = runtime();
    rt.load_plugin(plugin, Tier::User).unwrap_err()
}

// ---- manifests ----------------------------------------------------------------------------

#[test]
fn user_config_defaults_reach_register_as_options() {
    let dir = tempdir().unwrap();
    let plugin = write_raw(
        dir.path(),
        "cfg",
        r#"{ "name": "cfg", "version": "1.2.3", "unknownKey": [1, 2], "userConfig": {
            "n":   { "type": "number",  "default": 7 },
            "s":   { "type": "string",  "default": "hi" },
            "b":   { "type": "boolean", "default": false },
            "obj": { "type": "string",  "default": { "a": [1] } },
            "none": { "type": "string", "description": "no default, so absent" } } }"#,
        Some(
            r#"{ "hooks": { "PreToolUse": [] }, "modules": ["./register.js"], "futureKey": true }"#,
        ),
        &[(
            "register.js",
            "export function register(on, options) { on('o', async ($) => ({ options, same: $.plugin.options === options })); }",
        )],
    );
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    let v = rt.dispatch("o", &json!({})).unwrap().value;
    assert_eq!(
        v["options"],
        json!({ "n": 7, "s": "hi", "b": false, "obj": { "a": [1] } })
    );
}

#[test]
fn a_plugin_without_a_modules_key_is_not_a_mod() {
    let dir = tempdir().unwrap();
    let settings_only = write_raw(
        dir.path(),
        "a",
        r#"{ "name": "a" }"#,
        Some(r#"{ "hooks": {} }"#),
        &[],
    );
    let no_hooks_file = write_raw(dir.path(), "b", r#"{ "name": "b" }"#, None, &[]);
    let empty = write_raw(
        dir.path(),
        "c",
        r#"{ "name": "c" }"#,
        Some(r#"{ "modules": [] }"#),
        &[],
    );
    for p in [&settings_only, &no_hooks_file, &empty] {
        assert!(matches!(load_err(p), Error::NotAMod(_)), "{p:?}");
    }
}

#[test]
fn malformed_manifests_name_the_file() {
    let dir = tempdir().unwrap();
    let bad_json = write_raw(
        dir.path(),
        "a",
        "{ not json",
        Some(r#"{ "modules": ["./r.js"] }"#),
        &[("r.js", "")],
    );
    let no_name = write_raw(
        dir.path(),
        "b",
        r#"{ "version": "1" }"#,
        Some(r#"{ "modules": ["./r.js"] }"#),
        &[("r.js", "")],
    );
    let bad_hooks = write_raw(
        dir.path(),
        "c",
        r#"{ "name": "c" }"#,
        Some(r#"{ "modules": "./r.js" }"#),
        &[("r.js", "")],
    );
    for (p, file) in [
        (&bad_json, ".claude-plugin/plugin.json"),
        (&no_name, ".claude-plugin/plugin.json"),
        (&bad_hooks, "hooks/hooks.json"),
    ] {
        match load_err(p) {
            Error::Manifest { file: f, .. } => assert_eq!(f, file),
            other => panic!("{p:?}: {other:?}"),
        }
    }
    assert!(matches!(
        load_err(&dir.path().join("missing")),
        Error::Read { .. }
    ));
}

#[test]
fn a_named_module_that_is_missing_or_has_no_register_fails_to_load() {
    let dir = tempdir().unwrap();
    let missing = write_plugin(dir.path(), "a", "nope.js", &[]);
    assert!(matches!(load_err(&missing), Error::Read { .. }));
    let no_register = simple_plugin(dir.path(), "b", "export const x = 1;");
    assert!(matches!(load_err(&no_register), Error::NoRegister(_)));
    let not_a_function = simple_plugin(dir.path(), "c", "export const register = 3;");
    assert!(matches!(load_err(&not_a_function), Error::NoRegister(_)));
}

#[test]
fn a_syntax_error_reports_the_plugin_relative_path() {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "a",
        "src/register.ts",
        &[(
            "src/register.ts",
            "export function register(on: any) { on('x', ",
        )],
    );
    match load_err(&plugin) {
        Error::Compile { path, .. } => assert_eq!(path, "src/register.ts"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn one_plugin_can_name_several_modules() {
    let dir = tempdir().unwrap();
    let plugin = write_raw(
        dir.path(),
        "multi",
        r#"{ "name": "multi" }"#,
        Some(r#"{ "modules": ["./a.js", "./b.ts"] }"#),
        &[
            (
                "a.js",
                "import { shared } from './shared.ts'; export function register(on) { on('m', async () => shared.n++); }",
            ),
            (
                "b.ts",
                "import { shared } from './shared.ts'; export function register(on: any) { on('m', async (_$: any, _e: any, next: any) => { shared.n += 10; return next(); }); }",
            ),
            (
                "shared.ts",
                "export const shared: { n: number } = { n: 0 };",
            ),
        ],
    );
    let (mut rt, _) = runtime();
    let loaded = rt.load_plugin(&plugin, Tier::User).unwrap();
    assert_eq!((loaded.modules.len(), loaded.hooks), (2, 2));
    // `a` registered first, so it answers first with the shared counter before `b` ever runs;
    // the second dispatch shows both modules see one `shared` instance.
    assert_eq!(rt.dispatch("m", &json!({})).unwrap().value, json!(0));
    assert_eq!(rt.dispatch("m", &json!({})).unwrap().value, json!(1));
}

// ---- extensions, TypeScript, JSX --------------------------------------------------------------

#[test]
fn every_documented_module_extension_loads() {
    for ext in ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"] {
        let dir = tempdir().unwrap();
        let entry = format!("register.{ext}");
        let plugin = write_plugin(
            dir.path(),
            "p",
            &entry,
            &[(
                &entry,
                "export function register(on) { on('x', async () => 'ok'); }",
            )],
        );
        let (mut rt, _) = runtime();
        rt.load_plugin(&plugin, Tier::User)
            .unwrap_or_else(|e| panic!(".{ext}: {e}"));
        assert_eq!(
            rt.dispatch("x", &json!({})).unwrap().value,
            json!("ok"),
            ".{ext}"
        );
    }
}

#[test]
fn other_extensions_are_refused() {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(dir.path(), "p", "register.py", &[("register.py", "x = 1")]);
    assert!(matches!(load_err(&plugin), Error::Compile { .. }));
}

#[test]
fn typescript_is_stripped_without_a_build_step() {
    let ts = r#"
import type { Shape } from './types';
import { Mode, type Pair } from './types';
import { Phantom } from './types';            // only ever used as a type: must be elided

enum Level { Low, High = 5 }
type Id = string | number;
interface Box<T> { value: T; tag?: Id }
abstract class Base<T> { constructor(protected readonly seed: T) {} abstract label(): string; }
class Named extends Base<number> {
  label(): string { return `n${this.seed}`; }
}
function pick<T extends object, K extends keyof T>(o: T, k: K): T[K] { return o[k]; }
const asserted = (JSON.parse('{"a":1}') as { a: number }).a;
const checked = { a: 1 } satisfies Record<string, number>;
const maybe: Phantom | undefined = undefined;

export function register(on: any): void {
  on('ts', async (): Promise<unknown> => {
    const b: Box<number> = { value: 3 };
    const p: Pair = [1, 2];
    const s = 'x' as unknown as Shape;
    return { level: Level.High, rev: Level[0], label: new Named(4).label(), pick: pick(b, 'value'), asserted, checked: checked.a, maybe: maybe ?? null, mode: Mode.On, p, s, bang: (b.tag!) ?? 'none' };
  });
}
"#;
    let types = "export type Shape = 'a'; export type Pair = [number, number]; export type Phantom = string; export enum Mode { On = 'on' }\n";
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "p",
        "register.mts",
        &[("register.mts", ts), ("types.ts", types)],
    );
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    let v = rt.dispatch("ts", &json!({})).unwrap().value;
    assert_eq!(
        v,
        json!({ "level": 5, "rev": "Low", "label": "n4", "pick": 3, "asserted": 1, "checked": 1, "maybe": null, "mode": "on", "p": [1, 2], "s": "x", "bang": "none" })
    );
}

#[test]
fn jsx_needs_no_import_and_supports_components_fragments_and_spread() {
    let tsx = r#"
import { Box, Text, Button } from 'claude-code';

function Row(props: { label: string; n: number }) {
  return <Box gap={1}><Text bold>{props.label}</Text><Text>{props.n}</Text></Box>;
}
const extra = { dimColor: true };

export function register(on: any) {
  on('ui.render', { component: 'Pane' }, async () => (
    <Box flexDirection="column">
      <Row label="a" n={1} />
      <>
        <Text {...extra}>frag</Text>
        {[2, 3].map((n) => <Row key={n} label="r" n={n} />)}
        {false}{null}{undefined}
      </>
      <Button onPress={() => {}}>Go</Button>
    </Box>
  ));
}
"#;
    let dir = tempdir().unwrap();
    let plugin = write_plugin(dir.path(), "p", "register.tsx", &[("register.tsx", tsx)]);
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    let t = tree(rt.render("Pane", None, &json!({})).unwrap());
    assert_eq!(text_of(&t), "a|1|frag|r|2|r|3|Go");
    assert_eq!(t["props"]["flexDirection"], "column");
    // The fragment's children sit directly in the box; `key` is not a prop.
    assert_eq!(t["children"].as_array().unwrap().len(), 5);
    assert_eq!(t["children"][1]["props"], json!({ "dimColor": true }));
}

// ---- imports ----------------------------------------------------------------------------------

#[test]
fn relative_imports_resolve_across_directories_indexes_and_ts_habits() {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "p",
        "src/main/register.ts",
        &[
            (
                "src/main/register.ts",
                "import { a } from '../lib';           // directory index\n\
                 import { b } from '../util/b.js';     // `.js` written for a `.ts` file\n\
                 import { c } from './c';              // extension left off\n\
                 import { d } from '../../shared/d.mjs';\n\
                 export function register(on: any) { on('i', async () => [a, b, c, d]); }",
            ),
            ("src/lib/index.ts", "export const a = 'a';"),
            ("src/util/b.ts", "export const b = 'b';"),
            ("src/main/c.tsx", "export const c = 'c';"),
            ("shared/d.mts", "export const d = 'd';"),
        ],
    );
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    assert_eq!(
        rt.dispatch("i", &json!({})).unwrap().value,
        json!(["a", "b", "c", "d"])
    );
}

#[test]
fn the_claude_code_module_is_ours() {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "p",
        "register.ts",
        &[(
            "register.ts",
            "import * as cc from 'claude-code'; export function register(on: any) { on('x', async () => Object.keys(cc).sort()); }",
        )],
    );
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    let names = rt.dispatch("x", &json!({})).unwrap().value;
    for expected in [
        "Box",
        "Text",
        "Button",
        "Markdown",
        "Input",
        "Select",
        "Code",
        "Link",
        "Svg",
        "Fragment",
        "makeColors",
    ] {
        assert!(
            names.as_array().unwrap().contains(&json!(expected)),
            "{expected} in {names}"
        );
    }
}

#[test]
fn dynamic_import_is_refused_at_load_in_the_entry_and_in_what_it_imports() {
    for (entry, other) in [
        (
            "export function register(on) { on('x', async () => import('./other.js')); }",
            "export const x = 1;",
        ),
        (
            "import './other.ts'; export function register() {}",
            "export const lazy = () => import('./third.js');",
        ),
    ] {
        let dir = tempdir().unwrap();
        let plugin = write_plugin(
            dir.path(),
            "p",
            "register.js",
            &[
                ("register.js", entry),
                ("other.js", other),
                ("other.ts", other),
                ("third.js", ""),
            ],
        );
        match load_err(&plugin) {
            Error::DynamicImport { path } => {
                assert!(path == "register.js" || path == "other.ts", "{path}");
            }
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn import_through_eval_or_the_function_constructor_is_refused_at_run_time() {
    let src = "export function register(on) { on('e', async () => {
        const out = {};
        const tries = {
            direct: () => eval(\"import('./other.js')\"),
            ctor: () => new Function(\"return import('./other.js')\")(),
            indirect: () => (0, eval)(\"import('./other.js')\"),
        };
        for (const [k, f] of Object.entries(tries)) { try { await f(); out[k] = 'loaded'; } catch (x) { out[k] = 'refused'; } }
        return out;
    }); }";
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "p",
        "register.js",
        &[("register.js", src), ("other.js", "export const x = 1;")],
    );
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    assert_eq!(
        rt.dispatch("e", &json!({})).unwrap().value,
        json!({ "direct": "refused", "ctor": "refused", "indirect": "refused" })
    );
}

#[test]
fn nothing_but_relative_files_and_claude_code_can_be_imported() {
    let specs = [
        "fs",
        "node:fs",
        "node:child_process",
        "std",
        "os",
        "react",
        "https://example.com/x.js",
        "file:///etc/passwd",
        "/etc/passwd",
        "claude-code/other",
        "0:register.js", // the runtime's own module names are not importable by a mod
    ];
    for spec in specs {
        let dir = tempdir().unwrap();
        let src = format!("import '{spec}'; export function register() {{}}");
        let plugin = write_plugin(dir.path(), "p", "register.js", &[("register.js", &src)]);
        assert!(matches!(load_err(&plugin), Error::Import { .. }), "{spec}");
    }
}

#[test]
fn a_relative_import_cannot_climb_out_of_the_plugin() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("outside.js"), "export const secret = 1;").unwrap();
    let plugin = write_plugin(
        dir.path(),
        "p",
        "register.js",
        &[(
            "register.js",
            "import '../outside.js'; export function register() {}",
        )],
    );
    assert!(matches!(load_err(&plugin), Error::Import { .. }));
    let deep = write_plugin(
        dir.path(),
        "q",
        "src/register.js",
        &[(
            "src/register.js",
            "import '../../outside.js'; export function register() {}",
        )],
    );
    assert!(matches!(load_err(&deep), Error::Import { .. }));
}

#[test]
fn another_plugins_files_are_out_of_reach() {
    let dir = tempdir().unwrap();
    let _victim = write_plugin(
        dir.path(),
        "victim",
        "register.js",
        &[
            ("register.js", "export function register() {}"),
            ("secret.js", "export const s = 1;"),
        ],
    );
    let plugin = write_plugin(
        dir.path(),
        "p",
        "register.js",
        &[(
            "register.js",
            "import '../victim/secret.js'; export function register() {}",
        )],
    );
    assert!(matches!(load_err(&plugin), Error::Import { .. }));
}

#[cfg(unix)]
#[test]
fn a_symlink_that_leaves_the_plugin_is_refused() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("outside.js"), "export const secret = 1;").unwrap();
    let plugin = write_plugin(
        dir.path(),
        "p",
        "register.js",
        &[(
            "register.js",
            "import './link.js'; export function register() {}",
        )],
    );
    std::os::unix::fs::symlink(dir.path().join("outside.js"), plugin.join("link.js")).unwrap();
    assert!(matches!(load_err(&plugin), Error::Import { .. }));
    // A symlinked directory too, and a symlink as the module `hooks.json` names.
    std::os::unix::fs::symlink(dir.path(), plugin.join("up")).unwrap();
    let via_dir = write_plugin(
        dir.path(),
        "q",
        "register.js",
        &[(
            "register.js",
            "import './up/outside.js'; export function register() {}",
        )],
    );
    std::os::unix::fs::symlink(dir.path(), via_dir.join("up")).unwrap();
    assert!(matches!(load_err(&via_dir), Error::Import { .. }));
    let entry_link = write_raw(
        dir.path(),
        "r",
        r#"{ "name": "r" }"#,
        Some(r#"{ "modules": ["./entry.js"] }"#),
        &[],
    );
    std::os::unix::fs::symlink(dir.path().join("outside.js"), entry_link.join("entry.js")).unwrap();
    assert!(matches!(load_err(&entry_link), Error::Read { .. }));
}

#[test]
fn modules_are_size_capped() {
    let dir = tempdir().unwrap();
    let big = format!(
        "export function register() {{}}\n// {}\n",
        "x".repeat(3 * 1024 * 1024)
    );
    let plugin = write_plugin(dir.path(), "p", "register.js", &[("register.js", &big)]);
    assert!(matches!(load_err(&plugin), Error::Read { .. }));
}

#[test]
fn a_load_failure_leaves_the_isolate_usable_for_the_next_mod() {
    let dir = tempdir().unwrap();
    let bad = simple_plugin(
        dir.path(),
        "bad",
        "import 'fs'; export function register() {}",
    );
    let good = simple_plugin(
        dir.path(),
        "good",
        "export function register(on) { on('x', async () => 'fine'); }",
    );
    let (mut rt, _) = runtime();
    assert!(rt.load_plugin(&bad, Tier::User).is_err());
    rt.load_plugin(&good, Tier::User).unwrap();
    assert_eq!(rt.dispatch("x", &json!({})).unwrap().value, json!("fine"));
    // And a tree still renders: nothing about the failed load is left half-registered.
    assert!(matches!(
        rt.render("Pane", None, &json!({})).unwrap(),
        Render::Default { .. }
    ));
}

#[test]
fn a_dependency_cycle_is_refused_before_anything_runs() {
    let dir = tempdir().unwrap();
    let a = common::write_plugin_with(
        dir.path(),
        "a",
        &["b"],
        "register.js",
        &[(
            "register.js",
            "export function register() { throw new Error('ran'); }",
        )],
    );
    let b = common::write_plugin_with(
        dir.path(),
        "b",
        &["a"],
        "register.js",
        &[(
            "register.js",
            "export function register() { throw new Error('ran'); }",
        )],
    );
    let (mut rt, _) = runtime();
    assert!(matches!(
        rt.load_plugins(&[(&a, Tier::User), (&b, Tier::User)]),
        Err(Error::DependencyCycle(_))
    ));
}
