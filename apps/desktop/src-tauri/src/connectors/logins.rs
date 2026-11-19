//! The sign-in commands the host may run for a form, as data (`apps/shared/data/logins.json`, reviewed, shipped with the app).
//! A form names a **provider id**, never a command: whoever writes a form's schema (an agent, a teammate, a mod) can name a
//! provider, and the host maps it to a fixed program and argument vector. A command in a form is ignored. The curated
//! connector collection may name one more per entry (`variants[].login`); those are reviewed data too.

use std::sync::OnceLock;

use serde::Deserialize;

use super::validate;
use crate::error::{Error, Result};

/// The shared data file, compiled in. The UI reads the same file to say which sign-ins it can offer.
pub const LOGINS_JSON: &str = include_str!("../../../../shared/data/logins.json");
/// The `program` value that means the Hermes the host runs.
pub const HERMES_PROGRAM: &str = "hermes";

/// One sign-in command.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Login {
    /// The provider id a form names.
    pub id: String,
    /// What the card calls it.
    pub name: String,
    /// The program: a name on the `PATH`, or `hermes`.
    pub program: String,
    /// Its arguments, exactly.
    pub args: Vec<String>,
}

impl Login {
    /// The line the card shows: display only, it runs as a vector.
    #[must_use]
    pub fn line(&self) -> String {
        validate::display_command(&self.program, &self.args)
    }

    /// Whether the program and arguments pass the host's own command checks (`hermes` is the host's, not a PATH name).
    ///
    /// # Errors
    /// `InvalidInput`.
    pub fn check(&self) -> Result<()> {
        validate::name(&self.id)?;
        if self.program != HERMES_PROGRAM {
            validate::command(&self.program)?;
        }
        validate::args(&self.program, &self.args)
    }
}

/// The table.
#[derive(Debug, Clone, Default)]
pub struct LoginTable(Vec<Login>);

#[derive(Deserialize)]
struct File {
    logins: Vec<Login>,
}

impl LoginTable {
    /// A table over `logins`.
    #[must_use]
    pub fn new(logins: Vec<Login>) -> Self {
        Self(logins)
    }

    /// Parse the data file's text.
    ///
    /// # Errors
    /// `Config` when it does not parse or an entry fails the command checks.
    pub fn parse(text: &str) -> Result<Self> {
        let f: File = serde_json::from_str(text)
            .map_err(|e| Error::Config(format!("the sign-in table does not parse: {e}")))?;
        for l in &f.logins {
            l.check()
                .map_err(|e| Error::Config(format!("sign-in {}: {e}", l.id)))?;
        }
        Ok(Self(f.logins))
    }

    /// The compiled-in table, parsed once. A broken file gives an empty table (nothing can run), never a partial one.
    #[must_use]
    pub fn shared() -> Self {
        static TABLE: OnceLock<LoginTable> = OnceLock::new();
        TABLE
            .get_or_init(|| {
                Self::parse(LOGINS_JSON).unwrap_or_else(|e| {
                    tracing::error!(error = %e, "no sign-in can run");
                    Self::default()
                })
            })
            .clone()
    }

    /// The entry for a provider id.
    #[must_use]
    pub fn find(&self, id: &str) -> Option<&Login> {
        self.0.iter().find(|l| l.id == id)
    }

    /// Every entry.
    #[must_use]
    pub fn all(&self) -> &[Login] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_table_parses_and_every_entry_is_a_plain_program_and_vector() {
        let t = LoginTable::parse(LOGINS_JSON).unwrap();
        assert!(!t.all().is_empty());
        let mut ids: Vec<&str> = t.all().iter().map(|l| l.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), t.all().len(), "ids are unique");
        for l in t.all() {
            l.check().unwrap();
            assert!(!l.args.is_empty(), "{}", l.id);
        }
        assert_eq!(
            t.find("gcloud").unwrap().line(),
            "gcloud auth login --brief"
        );
        assert_eq!(
            t.find("hermes-nous").unwrap().line(),
            "hermes auth add nous --type oauth"
        );
    }

    #[test]
    fn nothing_that_runs_arbitrary_programs_or_a_claude_subscription_is_in_it() {
        let t = LoginTable::shared();
        for l in t.all() {
            assert!(
                !l.program.contains("claude")
                    && !l.id.contains("claude")
                    && !l.id.contains("anthropic"),
                "{}",
                l.id
            );
            assert!(
                ![
                    "curl", "wget", "rm", "python", "python3", "node", "sh", "bash", "env"
                ]
                .contains(&l.program.as_str()),
                "{}",
                l.id
            );
        }
    }

    #[test]
    fn an_entry_that_is_a_shell_string_or_a_wrapper_is_refused_when_the_table_is_read() {
        for (program, args) in [
            ("sh", r#"["-c","id"]"#),
            ("env", r#"["id"]"#),
            ("gcloud auth", "[]"),
            ("python3", r#"["-c","1"]"#),
        ] {
            let text = format!(
                r#"{{"logins":[{{"id":"x","name":"X","program":"{program}","args":{args}}}]}}"#
            );
            assert!(LoginTable::parse(&text).is_err(), "{program}");
        }
        assert!(LoginTable::parse("not json").is_err());
    }
}
