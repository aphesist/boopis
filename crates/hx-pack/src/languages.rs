//! The language registry: extension to grammar, plus a definition query.
//!
//! A language is data (`languages.json` and a `queries/*.scm` file) plus one
//! compiled grammar. Adding one means: a grammar crate, a line in
//! the private `grammar` function, a query file and a JSON entry. Nothing in the outline or
//! symbol code names a language. Programs that embed this crate can also add
//! a language at run time with [`Registry::register`].

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;
use tree_sitter::Query;

use crate::error::{Error, Result};
use crate::paths::RelPath;

const LANGUAGES_JSON: &str = include_str!("../languages.json");

/// Query sources by the path `languages.json` names them with.
const QUERIES: &[(&str, &str)] = &[
    ("queries/rust.scm", include_str!("../queries/rust.scm")),
    (
        "queries/typescript.scm",
        include_str!("../queries/typescript.scm"),
    ),
    (
        "queries/javascript.scm",
        include_str!("../queries/javascript.scm"),
    ),
    ("queries/python.scm", include_str!("../queries/python.scm")),
    ("queries/go.scm", include_str!("../queries/go.scm")),
];

/// The compiled grammar for a name used in `languages.json`.
fn grammar(name: &str) -> Option<tree_sitter::Language> {
    Some(match name {
        "rust" => tree_sitter_rust::LANGUAGE.into(),
        "typescript" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "tsx" => tree_sitter_typescript::LANGUAGE_TSX.into(),
        "javascript" => tree_sitter_javascript::LANGUAGE.into(),
        "python" => tree_sitter_python::LANGUAGE.into(),
        "go" => tree_sitter_go::LANGUAGE.into(),
        _ => return None,
    })
}

/// One entry of `languages.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct LanguageSpec {
    /// Short id, as accepted by the `lang` parameter.
    pub id: String,
    /// Grammar name known to the crate.
    pub grammar: String,
    /// File extensions, lowercase, without the dot.
    pub extensions: Vec<String>,
    /// Query file name (only used for the built-in table).
    pub query: String,
    /// Parent nodes that belong to a definition.
    #[serde(default)]
    pub wrappers: Vec<String>,
    /// Sibling nodes that belong to a definition when directly above it.
    #[serde(default)]
    pub leading: Vec<String>,
}

#[derive(Deserialize)]
struct LanguagesFile {
    schema_version: u32,
    languages: Vec<LanguageSpec>,
}

/// A registered language.
pub struct Language {
    spec: LanguageSpec,
    pub(crate) ts: tree_sitter::Language,
    query_source: String,
    query: OnceLock<std::result::Result<Query, String>>,
}

impl std::fmt::Debug for Language {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Language")
            .field("id", &self.spec.id)
            .finish_non_exhaustive()
    }
}

impl Language {
    /// The language id.
    #[must_use]
    pub fn id(&self) -> &str {
        &self.spec.id
    }

    /// The spec this language was registered with.
    #[must_use]
    pub fn spec(&self) -> &LanguageSpec {
        &self.spec
    }

    /// The compiled definition query, built on first use.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] if the query does not compile against the grammar.
    pub fn query(&self) -> Result<&Query> {
        self.query
            .get_or_init(|| {
                Query::new(&self.ts, &self.query_source)
                    .map_err(|e| format!("query for {}: {e}", self.spec.id))
            })
            .as_ref()
            .map_err(|m| Error::ConfigInvalid(m.clone()))
    }
}

/// Extension and id lookup over the registered languages.
#[derive(Debug, Default)]
pub struct Registry {
    langs: Vec<Language>,
    by_ext: HashMap<String, usize>,
}

impl Registry {
    /// An empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The built-in languages, compiled once.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] if `languages.json` does not load.
    pub fn builtin() -> Result<&'static Self> {
        static CELL: OnceLock<std::result::Result<Registry, String>> = OnceLock::new();
        CELL.get_or_init(|| Self::load_builtin().map_err(|e| e.to_string()))
            .as_ref()
            .map_err(|m| Error::ConfigInvalid(m.clone()))
    }

    fn load_builtin() -> Result<Self> {
        let file: LanguagesFile = serde_json::from_str(LANGUAGES_JSON)
            .map_err(|e| Error::ConfigInvalid(format!("languages.json: {e}")))?;
        if file.schema_version != 1 {
            return Err(Error::ConfigInvalid(
                "languages.json: unsupported schema_version".into(),
            ));
        }
        let mut reg = Self::new();
        for spec in file.languages {
            let query = QUERIES
                .iter()
                .find(|(name, _)| *name == spec.query)
                .map(|(_, src)| (*src).to_owned())
                .ok_or_else(|| {
                    Error::ConfigInvalid(format!("languages.json: no query {}", spec.query))
                })?;
            let ts = grammar(&spec.grammar).ok_or_else(|| {
                Error::ConfigInvalid(format!("languages.json: no grammar {}", spec.grammar))
            })?;
            reg.register(spec, ts, query)?;
        }
        Ok(reg)
    }

    /// Adds a language.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] if the id or an extension is already taken.
    pub fn register(
        &mut self,
        spec: LanguageSpec,
        ts: tree_sitter::Language,
        query_source: String,
    ) -> Result<()> {
        if self.by_id(&spec.id).is_some() {
            return Err(Error::ConfigInvalid(format!(
                "language {} registered twice",
                spec.id
            )));
        }
        let idx = self.langs.len();
        for ext in &spec.extensions {
            if self.by_ext.insert(ext.to_lowercase(), idx).is_some() {
                return Err(Error::ConfigInvalid(format!(
                    "extension {ext} registered twice"
                )));
            }
        }
        self.langs.push(Language {
            spec,
            ts,
            query_source,
            query: OnceLock::new(),
        });
        Ok(())
    }

    /// The language of a file, by extension.
    #[must_use]
    pub fn for_path(&self, path: &RelPath) -> Option<&Language> {
        let ext = path.extension()?.to_lowercase();
        self.by_ext.get(&ext).and_then(|&i| self.langs.get(i))
    }

    /// The language with this id.
    #[must_use]
    pub fn by_id(&self, id: &str) -> Option<&Language> {
        self.langs.iter().find(|l| l.spec.id == id)
    }

    /// A language by id or by one of its extensions (`rs`, `py`, `ts`).
    #[must_use]
    pub fn lookup(&self, name: &str) -> Option<&Language> {
        let name = name.to_lowercase();
        self.by_id(&name)
            .or_else(|| self.by_ext.get(&name).and_then(|&i| self.langs.get(i)))
    }

    /// All languages, in registration order.
    pub fn languages(&self) -> impl Iterator<Item = &Language> {
        self.langs.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_registry_maps_extensions_and_every_query_compiles() {
        let reg = Registry::builtin().unwrap();
        for (path, id) in [
            ("a.rs", "rust"),
            ("a.ts", "typescript"),
            ("a.mts", "typescript"),
            ("a.tsx", "tsx"),
            ("a.js", "javascript"),
            ("a.jsx", "javascript"),
            ("a.py", "python"),
            ("a.pyi", "python"),
            ("a.go", "go"),
            ("DIR/A.RS", "rust"),
        ] {
            let rel = RelPath::parse(path).unwrap();
            assert_eq!(reg.for_path(&rel).map(Language::id), Some(id), "{path}");
        }
        assert!(reg.for_path(&RelPath::parse("a.cpp").unwrap()).is_none());
        assert!(reg.for_path(&RelPath::parse("Makefile").unwrap()).is_none());
        for lang in reg.languages() {
            lang.query().unwrap();
        }
        assert_eq!(reg.lookup("rs").map(Language::id), Some("rust"));
        assert_eq!(reg.lookup("Python").map(Language::id), Some("python"));
        assert!(reg.lookup("cobol").is_none());
    }

    #[test]
    fn a_new_language_plugs_in_as_data() {
        // Registering a second grammar under new ids needs no code in outline or symbol.
        let mut reg = Registry::new();
        let spec = LanguageSpec {
            id: "rust2".into(),
            grammar: "rust".into(),
            extensions: vec!["rs2".into()],
            query: String::new(),
            wrappers: vec![],
            leading: vec![],
        };
        let query = "(function_item name: (identifier) @name) @definition.function".to_owned();
        reg.register(
            spec.clone(),
            tree_sitter_rust::LANGUAGE.into(),
            query.clone(),
        )
        .unwrap();
        let dup = reg.register(spec, tree_sitter_rust::LANGUAGE.into(), query);
        assert_eq!(dup.unwrap_err().code(), "hx.pack.config_invalid");
        let lang = reg.lookup("rs2").unwrap();
        let defs = crate::symbols::definitions(lang, "fn a() {}\nstruct S;\n").unwrap();
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name, "a");
    }

    #[test]
    fn a_broken_query_is_a_config_error_not_a_panic() {
        let mut reg = Registry::new();
        let spec = LanguageSpec {
            id: "bad".into(),
            grammar: "rust".into(),
            extensions: vec!["bad".into()],
            query: String::new(),
            wrappers: vec![],
            leading: vec![],
        };
        reg.register(
            spec,
            tree_sitter_rust::LANGUAGE.into(),
            "(no_such_node) @definition.x".into(),
        )
        .unwrap();
        let err = reg.lookup("bad").unwrap().query().unwrap_err();
        assert_eq!(err.code(), "hx.pack.config_invalid");
    }
}
