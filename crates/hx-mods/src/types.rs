//! The plain types of the runtime: tiers, budgets, configuration, diagnostics and what an event or
//! a draw produces. They are shared by the worker side (`engine`), the chain (`chain`) and the
//! in-process runtime (`runtime`).

use std::time::Duration;

use serde_json::Value as Json;

use crate::tree::{TreeLimits, TreeStats};

/// Where a mod sits in the chain: `prependPlugins` run first, `appendPlugins` last.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Tier {
    /// Before user mods.
    Prepend,
    /// User mods, dependencies first.
    #[default]
    User,
    /// After user mods.
    Append,
}

impl Tier {
    /// The tier named `name` (`prepend`, `user` or `append`).
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "prepend" => Some(Self::Prepend),
            "user" => Some(Self::User),
            "append" => Some(Self::Append),
            _ => None,
        }
    }

    /// The tier's name, as the chain and the wire spell it.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Prepend => "prepend",
            Self::User => "user",
            Self::Append => "append",
        }
    }
}

/// How long a hook may run. A hook past its budget is interrupted and skipped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budgets {
    /// Per hook, for most events.
    pub event: Duration,
    /// Per hook for `prompt.edit`, which runs on the keystroke path.
    pub prompt_edit: Duration,
    /// Per `.catch` handler.
    pub catch: Duration,
}

impl Default for Budgets {
    fn default() -> Self {
        Self {
            event: Duration::from_secs(10),
            prompt_edit: Duration::from_millis(50),
            catch: Duration::from_secs(1),
        }
    }
}

/// Everything configurable about an isolate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeConfig {
    /// Hook budgets.
    pub budgets: Budgets,
    /// Heap limit in bytes, for each mod's own runtime. An allocation past it throws inside the
    /// hook, and no other mod notices.
    pub memory_limit: usize,
    /// Native stack limit in bytes; deep recursion throws a `RangeError` inside the hook.
    pub stack_limit: usize,
    /// Element tree limits.
    pub tree: TreeLimits,
    /// The longest a `$` call may stay pending before the mod's promise rejects.
    pub host_timeout: Duration,
    /// The shortest `clock.every` interval; a shorter one is raised to it.
    pub min_timer: Duration,
    /// The longest one hook may stay in flight, waiting for its answer, before its worker is
    /// stopped. It includes every `$` call the hook waits on (a form the user has to answer).
    pub frame_limit: Duration,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            budgets: Budgets::default(),
            memory_limit: 64 * 1024 * 1024,
            stack_limit: 512 * 1024,
            tree: TreeLimits::default(),
            host_timeout: Duration::from_mins(10),
            min_timer: Duration::from_millis(50),
            frame_limit: Duration::from_mins(30),
        }
    }
}

/// Something worth telling the mod author or the log: a hook threw, timed out, or drew an
/// invalid tree. Never an answer to the event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// `warn` for a skipped hook.
    pub level: String,
    /// The plugin concerned, empty when none is.
    pub plugin: String,
    /// What happened.
    pub message: String,
}

/// What loading a plugin registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedPlugin {
    /// The plugin name.
    pub name: String,
    /// The tier it was loaded into.
    pub tier: Tier,
    /// The module files that were evaluated.
    pub modules: Vec<String>,
    /// How many hooks `register` added.
    pub hooks: usize,
}

/// The chain's answer to an event.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    /// A hook (or the default behaviour) returned something. False when every hook passed or was skipped.
    pub answered: bool,
    /// What it returned; `null` when not answered.
    pub value: Json,
    /// The mod whose hook answered, when one did.
    pub answered_by: Option<String>,
}

/// What a `ui.render` produced.
#[derive(Debug, Clone, PartialEq)]
pub enum Render {
    /// A valid element tree, as JSON with handlers replaced by `{"$handler": id}`.
    Tree {
        /// The tree.
        tree: Json,
        /// What it measured.
        stats: TreeStats,
    },
    /// No mod drew it: the site keeps its own drawing, with these props (changed or not).
    Default {
        /// The props the last hook passed on, when any.
        props: Option<Json>,
    },
    /// A mod drew something invalid; the site keeps its own drawing and a diagnostic was recorded.
    Skipped {
        /// Why.
        reason: String,
    },
}

/// Memory the engine holds, in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Memory {
    /// Bytes in use by the heap.
    pub used: i64,
    /// Bytes requested from the allocator.
    pub allocated: i64,
}

/// The milliseconds in a duration, as the JavaScript side counts them.
#[must_use]
pub fn millis(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}
