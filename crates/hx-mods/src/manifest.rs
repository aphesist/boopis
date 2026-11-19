//! `.claude-plugin/plugin.json` and `hooks/hooks.json`, and the order plugins load in.
//!
//! Wire types ignore unknown fields: a mod may carry any key Claude Code adds later.

use std::collections::{BTreeMap, HashMap};

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::files::PluginDir;

const PLUGIN_JSON: &str = ".claude-plugin/plugin.json";
const HOOKS_JSON: &str = "hooks/hooks.json";

#[derive(Deserialize, Default)]
struct PluginJson {
    name: Option<String>,
    version: Option<String>,
    #[serde(default, rename = "userConfig")]
    user_config: BTreeMap<String, Value>,
    #[serde(default)]
    dependencies: Vec<Value>,
}

#[derive(Deserialize, Default)]
struct HooksJson {
    modules: Option<Vec<String>>,
}

/// What the runtime needs to know about a mod before it loads.
#[derive(Debug, Clone, PartialEq)]
pub struct Manifest {
    /// The plugin name.
    pub name: String,
    /// The version, when the manifest has one.
    pub version: Option<String>,
    /// The `userConfig` defaults: what `register(on, options)` receives as `options`.
    pub options: Map<String, Value>,
    /// The plugins this one depends on, by name.
    pub dependencies: Vec<String>,
    /// The module paths from `hooks/hooks.json`, as written (`./register.js`).
    pub modules: Vec<String>,
}

fn parse<T: for<'de> Deserialize<'de>>(dir: &PluginDir, file: &str) -> Result<T> {
    let text = dir.read(file)?;
    serde_json::from_str(&text).map_err(|e| Error::Manifest { file: file.to_owned(), message: e.to_string() })
}

/// Reads both manifests of the plugin in `dir`.
///
/// # Errors
/// [`Error::Manifest`] for bad JSON or a missing name, [`Error::NotAMod`] when `hooks.json` has
/// no `modules` key (the plugin has settings hooks only).
pub fn read(dir: &PluginDir) -> Result<Manifest> {
    let plugin: PluginJson = parse(dir, PLUGIN_JSON)?;
    let name = plugin
        .name
        .filter(|n| !n.is_empty())
        .ok_or_else(|| Error::Manifest { file: PLUGIN_JSON.to_owned(), message: "`name` is required".to_owned() })?;
    let hooks: HooksJson = if dir.file(HOOKS_JSON)?.is_some() { parse(dir, HOOKS_JSON)? } else { HooksJson::default() };
    let modules = hooks.modules.filter(|m| !m.is_empty()).ok_or_else(|| Error::NotAMod(name.clone()))?;
    let options = plugin
        .user_config
        .into_iter()
        .filter_map(|(key, spec)| spec.get("default").cloned().map(|d| (key, d)))
        .collect();
    let dependencies = plugin
        .dependencies
        .iter()
        .filter_map(|d| d.as_str().or_else(|| d.get("name").and_then(Value::as_str)).map(str::to_owned))
        .collect();
    Ok(Manifest { name, version: plugin.version, options, dependencies, modules })
}

/// Orders `plugins` so every plugin comes after the ones it depends on. Dependencies that are not
/// in the list are installed elsewhere and ignored. Otherwise the given order is kept.
///
/// # Errors
/// [`Error::DependencyCycle`] when the dependencies form a cycle.
pub fn load_order(plugins: &[(String, Vec<String>)]) -> Result<Vec<usize>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        New,
        Visiting,
        Done,
    }
    fn visit(i: usize, plugins: &[(String, Vec<String>)], index: &HashMap<&str, usize>, marks: &mut [Mark], order: &mut Vec<usize>) -> Result<()> {
        match marks[i] {
            Mark::Done => return Ok(()),
            Mark::Visiting => return Err(Error::DependencyCycle(plugins[i].0.clone())),
            Mark::New => marks[i] = Mark::Visiting,
        }
        for dep in plugins[i].1.iter().filter_map(|d| index.get(d.as_str())) {
            visit(*dep, plugins, index, marks, order)?;
        }
        marks[i] = Mark::Done;
        order.push(i);
        Ok(())
    }
    let index: HashMap<&str, usize> = plugins.iter().enumerate().map(|(i, (n, _))| (n.as_str(), i)).collect();
    let mut marks = vec![Mark::New; plugins.len()];
    let mut order = Vec::with_capacity(plugins.len());
    for i in 0..plugins.len() {
        visit(i, plugins, &index, &mut marks, &mut order)?;
    }
    Ok(order)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(name: &str, deps: &[&str]) -> (String, Vec<String>) {
        (name.to_owned(), deps.iter().map(|d| (*d).to_owned()).collect())
    }

    #[test]
    fn dependencies_come_first_and_the_rest_keeps_its_order() {
        let order = load_order(&[p("a", &["c"]), p("b", &[]), p("c", &["b"]), p("d", &["missing"])]).unwrap();
        assert_eq!(order, vec![1, 2, 0, 3]);
    }

    #[test]
    fn a_cycle_is_refused() {
        assert!(matches!(load_order(&[p("a", &["b"]), p("b", &["a"])]), Err(Error::DependencyCycle(_))));
    }
}
