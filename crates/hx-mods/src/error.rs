//! The one error type of this crate.

/// Why a mod operation failed. A hook that throws or runs over budget is not an error: the chain
/// skips it and records a [`crate::Diagnostic`]. These are the failures of the runtime itself and
/// of loading a mod.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A file in the plugin could not be read, or its path leaves the plugin directory.
    #[error("cannot read `{path}`: {message}")]
    Read {
        /// The plugin-relative path.
        path: String,
        /// What went wrong.
        message: String,
    },
    /// `plugin.json` or `hooks/hooks.json` is malformed.
    #[error("invalid `{file}`: {message}")]
    Manifest {
        /// The manifest file.
        file: String,
        /// What is wrong with it.
        message: String,
    },
    /// The plugin has no `modules` key in `hooks/hooks.json`, so it is not a mod.
    #[error("`{0}` is not a mod: hooks/hooks.json has no `modules`")]
    NotAMod(String),
    /// A plugin with this name is already loaded in the runtime; unload it first.
    #[error("`{0}` is already loaded")]
    AlreadyLoaded(String),
    /// The dependency graph of the plugins to load has a cycle.
    #[error("the dependencies of `{0}` form a cycle")]
    DependencyCycle(String),
    /// TypeScript or JSX could not be parsed or transformed.
    #[error("cannot compile `{path}`: {message}")]
    Compile {
        /// The plugin-relative path.
        path: String,
        /// The first diagnostic.
        message: String,
    },
    /// A module uses `import()`, which mods may not.
    #[error("`{path}` uses a dynamic import(), which mods may not")]
    DynamicImport {
        /// The plugin-relative path.
        path: String,
    },
    /// An import names something a mod may not import.
    #[error("`{from}` cannot import `{specifier}`: {reason}")]
    Import {
        /// The importing module.
        from: String,
        /// The specifier as written.
        specifier: String,
        /// Why it was refused.
        reason: String,
    },
    /// A module has no `register` export.
    #[error("`{0}` does not export a `register` function")]
    NoRegister(String),
    /// `register` threw, or ran past its budget.
    #[error("`{plugin}` failed to load: {reason}")]
    LoadFailed {
        /// The plugin name.
        plugin: String,
        /// What happened.
        reason: String,
    },
    /// The isolate raised an exception outside any hook.
    #[error("script error: {0}")]
    Script(String),
    /// The isolate could not be driven to an answer. It is no longer usable: build a new one.
    #[error("the isolate is unusable: {0}")]
    Crashed(String),
    /// A value could not be turned into or read from JSON.
    #[error("json: {0}")]
    Json(String),
}

/// The crate's result type.
pub type Result<T> = std::result::Result<T, Error>;

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e.to_string())
    }
}
