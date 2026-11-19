//! TypeScript and JSX without a build step, and the import checks that go with it.
//!
//! Every module of a mod passes through [`prepare`]: it is parsed with `oxc`, refused if it uses
//! `import()`, and, when it is TypeScript or JSX, type-stripped and JSX-transformed to plain
//! JavaScript. JSX uses the automatic runtime from `claude-code`, so `<Box/>` needs no import.

use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::ImportExpression;
use oxc::ast_visit::Visit;
use oxc::codegen::Codegen;
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;
use oxc::transformer::{JsxRuntime, TransformOptions, Transformer};

use crate::error::{Error, Result};

/// The extensions a mod module may have, as the docs list them. All of them are read as ES modules:
/// `register` is an export, so a `.cjs` or `.cts` file is not `CommonJS` here.
pub const MODULE_EXTENSIONS: [&str; 8] = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"];

/// What the module's JSX imports its runtime from.
pub const JSX_IMPORT_SOURCE: &str = "claude-code";

struct DynamicImports(bool);

impl<'a> Visit<'a> for DynamicImports {
    fn visit_import_expression(&mut self, _it: &ImportExpression<'a>) {
        self.0 = true;
    }
}

fn compile_error(path: &str, message: impl Into<String>) -> Error {
    Error::Compile {
        path: path.to_owned(),
        message: message.into(),
    }
}

/// Turns one module's source into JavaScript the isolate can evaluate.
///
/// `path` is the plugin-relative path; its extension decides the language.
///
/// # Errors
/// [`Error::Compile`] for a syntax error or an extension that is not a mod module, and
/// [`Error::DynamicImport`] when the module uses `import()`.
pub fn prepare(path: &str, source: &str) -> Result<String> {
    // The loader runs inside the engine's C callbacks, where an unwinding panic aborts the whole
    // process. A parser or transformer bug on a hostile file must be a compile error, not that.
    std::panic::catch_unwind(|| prepare_unguarded(path, source)).unwrap_or_else(|panic| {
        let why = panic
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| panic.downcast_ref::<&str>().map(|s| (*s).to_owned()));
        Err(compile_error(
            path,
            format!("the transform panicked: {}", why.unwrap_or_default()),
        ))
    })
}

fn prepare_unguarded(path: &str, source: &str) -> Result<String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if !MODULE_EXTENSIONS.contains(&ext) {
        return Err(compile_error(
            path,
            format!("`.{ext}` is not a module extension (use one of {MODULE_EXTENSIONS:?})"),
        ));
    }
    let source_type = SourceType::from_path(path)
        .map_err(|e| compile_error(path, e.to_string()))?
        .with_module(true);
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if let Some(first) = parsed.diagnostics.errors().next() {
        return Err(compile_error(path, first.message.to_string()));
    }
    let mut program = parsed.program;
    let mut dynamic = DynamicImports(false);
    dynamic.visit_program(&program);
    if dynamic.0 {
        return Err(Error::DynamicImport {
            path: path.to_owned(),
        });
    }
    if !(source_type.is_typescript() || source_type.is_jsx()) {
        return Ok(source.to_owned());
    }
    // `enum` needs the constant evaluation: without it the transformer panics.
    let built = SemanticBuilder::new().with_enum_eval(true).build(&program);
    let mut options = TransformOptions::default();
    options.jsx.runtime = JsxRuntime::Automatic;
    options.jsx.import_source = Some(JSX_IMPORT_SOURCE.to_owned());
    let transformed = Transformer::new(&allocator, Path::new(path), &options)
        .build_with_scoping(built.semantic.into_scoping(), &mut program);
    if let Some(first) = transformed.diagnostics.errors().next() {
        return Err(compile_error(path, first.message.to_string()));
    }
    Ok(Codegen::new().build(&program).code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_types_interfaces_and_type_only_imports() {
        let out = prepare(
            "a.ts",
            "import type { X } from './x';\ninterface P { n: number }\nexport function f(p: P, q?: string): number { return (p.n as number) + 1; }\n",
        )
        .unwrap();
        assert!(!out.contains("interface"), "{out}");
        assert!(!out.contains("./x"), "{out}");
        assert!(!out.contains(": number"), "{out}");
        assert!(out.contains("export function f"), "{out}");
    }

    #[test]
    fn transforms_jsx_to_the_automatic_runtime() {
        let out = prepare(
            "v.tsx",
            "export const v = (n: number) => <Box gap={1}><Text>{n}</Text></Box>;",
        )
        .unwrap();
        assert!(out.contains("claude-code/jsx-runtime"), "{out}");
        assert!(!out.contains('<'), "{out}");
    }

    #[test]
    fn plain_javascript_passes_through_untouched() {
        let src = "export function register(on) { on('x', async () => 1); }\n";
        assert_eq!(prepare("r.js", src).unwrap(), src);
    }

    #[test]
    fn refuses_dynamic_import_in_js_and_ts() {
        for (path, src) in [
            ("a.js", "export const f = () => import('./x.js');"),
            (
                "a.mts",
                "export async function f() { return await import('./x'); }",
            ),
        ] {
            assert_eq!(
                prepare(path, src),
                Err(Error::DynamicImport { path: path.into() }),
                "{path}"
            );
        }
    }

    #[test]
    fn reports_a_syntax_error_with_the_path() {
        let err = prepare("bad.ts", "export const = ;").unwrap_err();
        assert!(
            matches!(err, Error::Compile { ref path, .. } if path == "bad.ts"),
            "{err:?}"
        );
    }

    #[test]
    fn refuses_other_extensions() {
        assert!(matches!(prepare("a.py", "x"), Err(Error::Compile { .. })));
        assert!(matches!(prepare("noext", "x"), Err(Error::Compile { .. })));
    }
}
