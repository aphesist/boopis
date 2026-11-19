//! Method names. `area.verb`, in `snake_case`.

/// `hx.describe`: version, protocol and capabilities.
pub const DESCRIBE: &str = "hx.describe";
/// `txn.validate`: check every edit in memory, write nothing.
pub const TXN_VALIDATE: &str = "txn.validate";
/// `txn.apply`: validate, journal, apply atomically.
pub const TXN_APPLY: &str = "txn.apply";
/// `txn.restore`: undo a transaction from its journal.
pub const TXN_RESTORE: &str = "txn.restore";
/// `txn.discard`: keep the changes and drop the journal.
pub const TXN_DISCARD: &str = "txn.discard";
/// `txn.recover`: restore every incomplete journal after a crash.
pub const TXN_RECOVER: &str = "txn.recover";
/// `pack.search`: matches with surrounding lines.
pub const PACK_SEARCH: &str = "pack.search";
/// `pack.read`: a file or line ranges.
pub const PACK_READ: &str = "pack.read";
/// `pack.symbol`: the source of named definitions.
pub const PACK_SYMBOL: &str = "pack.symbol";
/// `pack.outline`: the definitions of files and directories.
pub const PACK_OUTLINE: &str = "pack.outline";
/// `pack.status`: git status, branch and HEAD.
pub const PACK_STATUS: &str = "pack.status";
/// `pack.bundle`: several of the above under one byte budget.
pub const PACK_BUNDLE: &str = "pack.bundle";
/// `redact.apply`: the text with every secret replaced, and how many were.
pub const REDACT_APPLY: &str = "redact.apply";
/// `$/cancelRequest`: notification `{id}` that cancels an in-flight request.
pub const CANCEL_REQUEST: &str = "$/cancelRequest";

/// The areas methods live in. `pack` and `sandbox` are reserved for the crates that own them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Namespace {
    /// `hx.*`: the binary itself (`hx.describe`).
    Hx,
    /// `txn.*`: file transactions (`hx-txn`).
    Txn,
    /// `pack.*`: search and outlines (`hx-pack`).
    Pack,
    /// `sandbox.*`: OS sandboxing (`hx-sandbox`).
    Sandbox,
    /// `redact.*`: secret redaction of free text (`hx-pack`'s redactor).
    Redact,
}

impl Namespace {
    /// The method-name prefix, without the dot.
    #[must_use]
    pub fn prefix(self) -> &'static str {
        match self {
            Namespace::Hx => "hx",
            Namespace::Txn => "txn",
            Namespace::Pack => "pack",
            Namespace::Sandbox => "sandbox",
            Namespace::Redact => "redact",
        }
    }

    /// Whether `method` is `<prefix>.<something>`.
    #[must_use]
    pub fn owns(self, method: &str) -> bool {
        method
            .strip_prefix(self.prefix())
            .and_then(|rest| rest.strip_prefix('.'))
            .is_some_and(|verb| !verb.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_needs_the_dot_and_a_verb() {
        assert!(Namespace::Txn.owns("txn.apply"));
        assert!(!Namespace::Txn.owns("txn."));
        assert!(!Namespace::Txn.owns("txnapply"));
        assert!(!Namespace::Pack.owns("txn.apply"));
        assert!(Namespace::Sandbox.owns("sandbox.run"));
        assert!(Namespace::Redact.owns("redact.apply"));
        assert!(!Namespace::Pack.owns("redact.apply"));
    }
}
