//! Which modules a mod may import, and where they come from.
//!
//! A mod may import files inside its own plugin directory by relative path, and the bare
//! `claude-code` module (plus its `jsx-runtime`), which this crate provides. Everything else is
//! refused: no other bare specifier, no `node:` builtin, no URL, no absolute path, and no path
//! that climbs out of the plugin. Module names inside the isolate are `<plugin index>:<path>`.

use std::cell::RefCell;
use std::rc::Rc;

use rquickjs::loader::{ImportAttributes, Loader, Resolver};
use rquickjs::module::Declared;
use rquickjs::{Ctx, Module};

use crate::error::Error;
use crate::files::Files;
use crate::transform::{self, MODULE_EXTENSIONS};

/// The module a mod gets for `import … from 'claude-code'`.
const CLAUDE_CODE: &str = include_str!("js/claude-code.js");
/// The module JSX compiles against.
const JSX_RUNTIME: &str = include_str!("js/jsx-runtime.js");

const BARE_CLAUDE_CODE: &str = "claude-code";
const BARE_JSX_RUNTIME: &str = "claude-code/jsx-runtime";

/// The plugin directories the isolate can load from, and the last load error.
///
/// The engine only reports a string when a load fails; the typed error is kept here so the caller
/// gets `Error::DynamicImport` and not a message to parse.
#[derive(Default)]
pub struct Shared {
    /// One entry per plugin, indexed by the number in a module name. A plugin's directory handle
    /// is dropped once it has loaded: every import is static, so nothing reads it afterwards,
    /// and a late `import()` has nothing to read from.
    pub roots: Vec<Option<Files>>,
    /// The first typed failure since it was last taken.
    pub last_error: Option<Error>,
}

/// A handle on [`Shared`], held by the resolver, the loader and the runtime.
pub type SharedRef = Rc<RefCell<Shared>>;

fn import_error(from: &str, specifier: &str, reason: impl Into<String>) -> Error {
    Error::Import {
        from: from.to_owned(),
        specifier: specifier.to_owned(),
        reason: reason.into(),
    }
}

/// Splits `3:src/view.tsx` into the plugin index and the path.
fn split(name: &str) -> Option<(usize, &str)> {
    let (idx, path) = name.split_once(':')?;
    Some((idx.parse().ok()?, path))
}

/// Joins `spec` onto the directory of `base_dir`, collapsing `.` and `..` lexically.
fn join(base_dir: &str, spec: &str) -> Option<String> {
    let mut parts: Vec<&str> = base_dir.split('/').filter(|p| !p.is_empty()).collect();
    for seg in spec.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

/// The files `path` may mean: itself, with an extension, as a directory index, or (TypeScript
/// habit) `.js` written for a `.ts` file.
fn candidates(path: &str) -> Vec<String> {
    let mut out = vec![path.to_owned()];
    out.extend(MODULE_EXTENSIONS.iter().map(|e| format!("{path}.{e}")));
    out.extend(
        MODULE_EXTENSIONS
            .iter()
            .map(|e| format!("{path}/index.{e}")),
    );
    if let Some(stem) = path.strip_suffix(".js") {
        out.extend(["ts", "tsx", "jsx"].iter().map(|e| format!("{stem}.{e}")));
    }
    for (from, to) in [(".mjs", "mts"), (".cjs", "cts")] {
        if let Some(stem) = path.strip_suffix(from) {
            out.push(format!("{stem}.{to}"));
        }
    }
    out
}

/// Resolves what `base` imported as `specifier` to a module name.
///
/// # Errors
/// [`Error::Import`] when the specifier is not allowed or names no file.
pub fn resolve_name(shared: &SharedRef, base: &str, specifier: &str) -> Result<String, Error> {
    if specifier == BARE_CLAUDE_CODE || specifier == BARE_JSX_RUNTIME {
        return Ok(specifier.to_owned());
    }
    // Only the runtime, importing a plugin's entry module with no importer, may use an internal
    // name; a mod naming `1:register.js` would reach another plugin's files.
    let entry = if base.is_empty() {
        split(specifier)
    } else {
        None
    };
    let (idx, base_dir, rel) = if let Some((idx, path)) = entry {
        (idx, String::new(), path.to_owned())
    } else if specifier.starts_with("./") || specifier.starts_with("../") {
        let (idx, base_path) = split(base).ok_or_else(|| {
            import_error(
                base,
                specifier,
                "a relative import needs an importer inside a plugin",
            )
        })?;
        let dir = base_path.rsplit_once('/').map_or("", |(d, _)| d).to_owned();
        (idx, dir, specifier.to_owned())
    } else {
        return Err(import_error(
            base,
            specifier,
            "a mod may import relative files and `claude-code` only (no Node modules, no URLs, no other packages)",
        ));
    };
    let joined = join(&base_dir, &rel)
        .ok_or_else(|| import_error(base, specifier, "the path leaves the plugin directory"))?;
    let guard = shared.borrow();
    let root = guard
        .roots
        .get(idx)
        .and_then(Option::as_ref)
        .ok_or_else(|| import_error(base, specifier, "unknown plugin, or already loaded"))?;
    for candidate in candidates(&joined) {
        if let Some(canonical) = root
            .file(&candidate)
            .map_err(|e| import_error(base, specifier, e.to_string()))?
        {
            return Ok(format!("{idx}:{canonical}"));
        }
    }
    Err(import_error(base, specifier, "no such file"))
}

/// Reads and compiles the module `name`.
///
/// # Errors
/// Anything [`transform::prepare`] or [`PluginDir::read`] refuses.
pub fn module_source(shared: &SharedRef, name: &str) -> Result<String, Error> {
    match name {
        BARE_CLAUDE_CODE => return Ok(CLAUDE_CODE.to_owned()),
        BARE_JSX_RUNTIME => return Ok(JSX_RUNTIME.to_owned()),
        _ => {}
    }
    let (idx, path) =
        split(name).ok_or_else(|| import_error("", name, "not a module of this runtime"))?;
    let text = {
        let guard = shared.borrow();
        guard
            .roots
            .get(idx)
            .and_then(Option::as_ref)
            .ok_or_else(|| import_error("", name, "unknown plugin, or already loaded"))?
            .read(path)?
    };
    transform::prepare(path, &text)
}

fn remember(shared: &SharedRef, e: &Error) {
    shared
        .borrow_mut()
        .last_error
        .get_or_insert_with(|| e.clone());
}

/// The engine's resolver.
pub struct ModResolver(pub SharedRef);

impl Resolver for ModResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        resolve_name(&self.0, base, name).map_err(|e| {
            remember(&self.0, &e);
            rquickjs::Error::new_resolving_message(base, name, e.to_string())
        })
    }
}

/// The engine's loader.
pub struct ModLoader(pub SharedRef);

impl Loader for ModLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, Declared>> {
        let source = module_source(&self.0, name).map_err(|e| {
            remember(&self.0, &e);
            rquickjs::Error::new_loading_message(name, e.to_string())
        })?;
        Module::declare(ctx.clone(), name, source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_collapses_dots_and_refuses_to_climb_out() {
        assert_eq!(join("src", "./a/../b.ts").as_deref(), Some("src/b.ts"));
        assert_eq!(join("src", "../x.ts").as_deref(), Some("x.ts"));
        assert_eq!(join("src", "../../x.ts"), None);
        assert_eq!(join("", "../x.ts"), None);
    }

    #[test]
    fn other_bare_specifiers_are_refused() {
        let shared = SharedRef::default();
        for spec in [
            "fs",
            "node:fs",
            "react",
            "https://example.com/x.js",
            "/etc/passwd",
            "file:///x",
        ] {
            assert!(
                matches!(
                    resolve_name(&shared, "0:register.js", spec),
                    Err(Error::Import { .. })
                ),
                "{spec}"
            );
        }
        assert_eq!(
            resolve_name(&shared, "0:register.js", "claude-code").unwrap(),
            "claude-code"
        );
    }
}
