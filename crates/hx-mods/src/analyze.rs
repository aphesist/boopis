//! What a mod says it does, read from its code without running it: the hooks it registers and the
//! `$` calls it makes. The install prompt shows this before the user consents.
//!
//! The analysis runs on the transformed module (TypeScript and JSX already compiled to plain
//! JavaScript, as the runtime loads it) and is an aid to the reader, not a limit on the mod: a
//! mod that passes `$` to a function or indexes it with a variable cannot be listed completely,
//! and the result says so (`dynamic`). What a mod may actually do is decided call by call by the
//! plugin's policy, whatever this list says.

use std::collections::BTreeSet;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Argument, CallExpression, ComputedMemberExpression, Expression, Function, IdentifierReference,
    StaticMemberExpression, VariableDeclarator,
};
use oxc::ast_visit::Visit;
use oxc::parser::Parser;
use oxc::span::SourceType;
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::files::Bundle;
use crate::transform::{self, MODULE_EXTENSIONS};

/// What one module does.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModuleAnalysis {
    /// The plugin-relative path.
    pub path: String,
    /// The events it registers hooks for, in source order, repeats kept.
    pub hooks: Vec<String>,
    /// The `$` members it uses, as written (`ui.open`, `fs.read`), sorted and unique.
    pub calls: Vec<String>,
    /// True when `$` escapes or is indexed with a computed key, so `calls` may be incomplete.
    pub dynamic: bool,
}

/// What a whole plugin says it does.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Analysis {
    /// Every module file with a hook or a `$` use.
    pub modules: Vec<ModuleAnalysis>,
}

impl Analysis {
    /// The distinct `$` namespaces used (`ui`, `fs`, ...), sorted.
    #[must_use]
    pub fn namespaces(&self) -> Vec<String> {
        let set: BTreeSet<String> = self
            .modules
            .iter()
            .flat_map(|m| m.calls.iter())
            .filter_map(|c| c.split('.').next().map(str::to_owned))
            .collect();
        set.into_iter().collect()
    }

    /// The distinct events hooks are registered for, sorted.
    #[must_use]
    pub fn events(&self) -> Vec<String> {
        let set: BTreeSet<String> = self
            .modules
            .iter()
            .flat_map(|m| m.hooks.iter().cloned())
            .collect();
        set.into_iter().collect()
    }

    /// True when any module could not be listed completely.
    #[must_use]
    pub fn dynamic(&self) -> bool {
        self.modules.iter().any(|m| m.dynamic)
    }
}

/// The names of the registration function (`on`, or `register`'s first parameter) and the `$`
/// parameters of hook functions.
#[derive(Default)]
struct Names {
    on: BTreeSet<String>,
    dollar: BTreeSet<String>,
}

fn first_param<'a>(f: &Function<'a>) -> Option<String> {
    f.params
        .items
        .first()
        .and_then(|p| p.pattern.get_binding_identifier())
        .map(|b| b.name.as_str().to_owned())
}

struct Collect<'n>(&'n mut Names);

impl<'a> Visit<'a> for Collect<'_> {
    fn visit_function(&mut self, f: &Function<'a>, flags: oxc::semantic::ScopeFlags) {
        if f.id.as_ref().is_some_and(|i| i.name == "register")
            && let Some(p) = first_param(f)
        {
            self.0.on.insert(p);
        }
        oxc::ast_visit::walk::walk_function(self, f, flags);
    }

    fn visit_variable_declarator(&mut self, d: &VariableDeclarator<'a>) {
        if d.id.get_binding_identifier().is_some_and(|i| i.name == "register") {
            match &d.init {
                Some(Expression::ArrowFunctionExpression(a)) => {
                    if let Some(p) = a.params.items.first().and_then(|p| p.pattern.get_binding_identifier()) {
                        self.0.on.insert(p.name.as_str().to_owned());
                    }
                }
                Some(Expression::FunctionExpression(f)) => {
                    if let Some(p) = first_param(f) {
                        self.0.on.insert(p);
                    }
                }
                _ => {}
            }
        }
        oxc::ast_visit::walk::walk_variable_declarator(self, d);
    }
}

fn callee_name<'b>(e: &'b Expression<'_>) -> Option<&'b str> {
    match e {
        Expression::Identifier(i) => Some(i.name.as_str()),
        _ => None,
    }
}

fn hook_event<'b>(call: &'b CallExpression<'_>, names: &Names) -> Option<&'b str> {
    let name = callee_name(&call.callee)?;
    if !names.on.contains(name) {
        return None;
    }
    match call.arguments.first() {
        Some(Argument::StringLiteral(s)) => s.value.as_str().into(),
        _ => None,
    }
}

/// Finds the `$` parameter of each function passed to a registration call.
struct FindDollar<'n>(&'n mut Names);

impl<'a> Visit<'a> for FindDollar<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if hook_event(call, self.0).is_some() {
            for arg in &call.arguments {
                let name = match arg.as_expression() {
                    Some(Expression::ArrowFunctionExpression(a)) => a
                        .params
                        .items
                        .first()
                        .and_then(|p| p.pattern.get_binding_identifier())
                        .map(|b| b.name.as_str().to_owned()),
                    Some(Expression::FunctionExpression(f)) => first_param(f),
                    _ => None,
                };
                if let Some(n) = name {
                    self.0.dollar.insert(n);
                }
            }
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

struct Scan<'n> {
    names: &'n Names,
    out: ModuleAnalysis,
    chains: Vec<String>,
    consumed: BTreeSet<u32>,
}

impl Scan<'_> {
    /// `$.a.b` as `["a", "b"]` when the chain is rooted at a `$` name; marks the root as used.
    fn chain(&mut self, e: &Expression<'_>) -> Option<Vec<String>> {
        match e {
            Expression::Identifier(i) if self.names.dollar.contains(i.name.as_str()) => {
                self.consumed.insert(i.span.start);
                Some(Vec::new())
            }
            Expression::StaticMemberExpression(m) => {
                let mut base = self.chain(&m.object)?;
                base.push(m.property.name.as_str().to_owned());
                Some(base)
            }
            Expression::ParenthesizedExpression(p) => self.chain(&p.expression),
            _ => None,
        }
    }
}

impl<'a> Visit<'a> for Scan<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(event) = hook_event(call, self.names) {
            self.out.hooks.push(event.to_owned());
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }

    fn visit_static_member_expression(&mut self, m: &StaticMemberExpression<'a>) {
        let mut base = self.chain(&m.object);
        if let Some(path) = base.as_mut() {
            path.push(m.property.name.as_str().to_owned());
            self.chains.push(path.join("."));
        }
        oxc::ast_visit::walk::walk_static_member_expression(self, m);
    }

    fn visit_computed_member_expression(&mut self, m: &ComputedMemberExpression<'a>) {
        if self.chain(&m.object).is_some() {
            self.out.dynamic = true;
        }
        oxc::ast_visit::walk::walk_computed_member_expression(self, m);
    }

    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        if self.names.dollar.contains(id.name.as_str()) && !self.consumed.contains(&id.span.start) {
            // `$` itself, as a value: passed on, stored, destructured.
            self.out.dynamic = true;
        }
    }
}

fn analyze_module(path: &str, source: &str) -> Result<ModuleAnalysis> {
    let js = transform::prepare(path, source)?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &js, SourceType::mjs()).parse();
    let mut names = Names::default();
    names.on.insert("on".to_owned());
    names.dollar.insert("$".to_owned());
    Collect(&mut names).visit_program(&parsed.program);
    FindDollar(&mut names).visit_program(&parsed.program);
    let mut scan = Scan {
        names: &names,
        out: ModuleAnalysis {
            path: path.to_owned(),
            ..ModuleAnalysis::default()
        },
        chains: Vec::new(),
        consumed: BTreeSet::new(),
    };
    scan.visit_program(&parsed.program);
    // `$.ui` alone is the prefix of `$.ui.open`: keep only the longest chain of each.
    let all: BTreeSet<String> = scan.chains.iter().cloned().collect();
    scan.out.calls = all
        .iter()
        .filter(|c| !all.iter().any(|o| o.len() > c.len() && o.starts_with(&format!("{c}."))))
        .cloned()
        .collect();
    Ok(scan.out)
}

/// Analyses every module file in the bundle.
///
/// # Errors
/// [`crate::Error::Compile`] for a file that does not parse or transform.
pub fn analyze(bundle: &Bundle) -> Result<Analysis> {
    let mut modules = Vec::new();
    for (path, text) in &bundle.files {
        let is_module = MODULE_EXTENSIONS
            .iter()
            .any(|e| path.ends_with(&format!(".{e}")));
        if !is_module {
            continue;
        }
        let m = analyze_module(path, text)?;
        if !m.hooks.is_empty() || !m.calls.is_empty() || m.dynamic {
            modules.push(m);
        }
    }
    Ok(Analysis { modules })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(path: &str, src: &str) -> ModuleAnalysis {
        analyze_module(path, src).unwrap()
    }

    #[test]
    fn lists_hooks_and_dollar_members_of_a_typescript_module() {
        let m = one(
            "r.ts",
            "export function register(on: any): void {
               on('session.start', async ($: any, e: any, next: any) => { await $.ui.open({ id: 'x' }); $.clock.every(1, () => {}); return next(e); });
               on('command.run', { name: 'a' }, async (api: any) => { await api.fs.read('/x'); await api.http.fetch('https://e.com'); });
             }",
        );
        assert_eq!(m.hooks, ["session.start", "command.run"]);
        assert_eq!(m.calls, ["clock.every", "fs.read", "http.fetch", "ui.open"]);
        assert!(!m.dynamic);
    }

    #[test]
    fn reads_jsx_modules_after_the_transform() {
        let m = one(
            "r.jsx",
            "import { Box } from 'claude-code';
             export function register(on) { on('ui.render', { component: 'Pane' }, async ($) => <Box>{$.state.read($.state.atom(1))}</Box>); }",
        );
        assert_eq!(m.hooks, ["ui.render"]);
        assert_eq!(m.calls, ["state.atom", "state.read"]);
    }

    #[test]
    fn a_dollar_that_escapes_or_is_indexed_is_marked_dynamic() {
        assert!(one("r.js", "export function register(on) { on('x', async ($) => helper($)); }").dynamic);
        assert!(one("r.js", "export function register(on) { on('x', async ($) => { const k = 'fs'; return $[k].read('/x'); }); }").dynamic);
        assert!(one("r.js", "export function register(on) { on('x', async ($) => { const { fs } = $; return fs; }); }").dynamic);
        assert!(!one("r.js", "export function register(on) { on('x', async ($) => $.ui.toast('hi')); }").dynamic);
    }

    #[test]
    fn a_plain_function_named_on_in_another_style_is_still_a_registration() {
        let m = one(
            "r.js",
            "export const register = (listen) => { listen('prompt.submit', async () => 1); };",
        );
        assert_eq!(m.hooks, ["prompt.submit"]);
    }
}
