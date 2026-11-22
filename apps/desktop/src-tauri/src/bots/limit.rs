//! A bot's cap on turns for `boopis run --bot`: how many turns the engine's goal mode lets one task take.
//!
//! The engine keeps a goal's budget in `goals.max_turns` of the configuration of the home the session runs in (its
//! `GatewayRunner._goal_max_turns_from_config` reads it under the session's profile, `hermes_cli/goals.py`), and every bot has
//! a home of its own, so unlike a group's cap this one is written where the engine reads it: `hermes config set
//! goals.max_turns N` in the bot's home, through the same [`Engine`] operations `prepare` uses. Nothing of the engine is patched.
//!
//! `hermes config get` answers with the engine's own default (20) for a key nobody set, so "the bot has no cap of its own" cannot
//! be told from "the bot's cap is 20" by asking it. The bot's `config.yaml` is read instead, read only (the engine owns the
//! file), and a bot that has no value there runs for boopis's default of ten turns. The run passes the number it resolved to the
//! goal (`session.automation`, `goal.set` with `max_turns`), so the flag, the bot's setting and the default are one rule in one
//! place ([`effective`]).

use std::path::Path;

use super::Engine;
use crate::error::{Error, Result};

/// The configuration key the engine reads a goal's budget from.
pub const KEY: &str = "goals.max_turns";
/// The cap when neither the bot nor the command says (the owner, 22 November 2026: "10 is fine as a default, but it should be
/// editable (both for specific agents and for specific chat groups)"). A bot sets its own, and a run's flag beats both.
pub const DEFAULT_MAX_TURNS: u32 = 10;
/// The largest cap a bot may be given (a group's is the same).
pub const LIMIT_MAX_TURNS: u32 = 1_000;

/// Check a cap.
///
/// # Errors
/// `InvalidInput` outside `1..=1000`.
pub fn check_turns(n: u32) -> Result<u32> {
    if (1..=LIMIT_MAX_TURNS).contains(&n) {
        Ok(n)
    } else {
        Err(Error::InvalidInput(format!(
            "max turns is 1 to {LIMIT_MAX_TURNS}, not {n}"
        )))
    }
}

/// The cap a run uses: the command's own, else the bot's, else the default.
#[must_use]
pub fn effective(flag: Option<u32>, bot: Option<u32>) -> u32 {
    flag.or(bot).unwrap_or(DEFAULT_MAX_TURNS)
}

/// The cap a configuration file holds for its home, `None` when it holds none. The engine reads `int(value or 20)`, so a value
/// that is not a whole number above zero is no cap of this bot's.
///
/// # Errors
/// `Config` when the text is not YAML.
pub fn parse(text: &str) -> Result<Option<u32>> {
    let root: serde_norway::Value = serde_norway::from_str(text)
        .map_err(|e| Error::Config(format!("config.yaml is not readable: {e}")))?;
    let Some(v) = root.get("goals").and_then(|g| g.get("max_turns")) else {
        return Ok(None);
    };
    let n = match v {
        serde_norway::Value::Number(n) => n.as_u64(),
        serde_norway::Value::String(s) => s.trim().parse::<u64>().ok(),
        _ => None,
    };
    Ok(n.filter(|n| *n >= 1)
        .map(|n| u32::try_from(n).unwrap_or(u32::MAX)))
}

/// The cap kept for the bot whose home is `home`: read from its `config.yaml` (read only). A home with no file has none.
///
/// # Errors
/// `Io` when the file is there and cannot be read, `Config` when it is not YAML.
pub fn read(home: &Path) -> Result<Option<u32>> {
    let path = home.join("config.yaml");
    match std::fs::read_to_string(&path) {
        Ok(text) => parse(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Io(format!("{}: {e}", path.display()))),
    }
}

/// Keep (or, with `None`, forget) the cap of the bot whose home is `home`. Only what differs is written: a bot that already has
/// this cap is left alone, and a bot with none is not asked to forget one (the engine refuses to unset a key that is not there).
/// Returns whether anything was written.
///
/// # Errors
/// `InvalidInput` for a cap outside 1 to 1000; the engine's, when its command fails.
pub async fn write(engine: &dyn Engine, home: &Path, turns: Option<u32>) -> Result<bool> {
    if let Some(n) = turns {
        check_turns(n)?;
    }
    if read(home)? == turns {
        return Ok(false);
    }
    match turns {
        Some(n) => engine.config_set(home, KEY, &n.to_string()).await?,
        None => engine.config_unset(home, KEY).await?,
    }
    Ok(true)
}

/// A change to a bot's cap: a number, or the default again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Cap {
    /// This many turns.
    Turns(u32),
    /// Forget the bot's own cap: the default applies.
    Default,
}

impl Cap {
    /// The value to keep: `None` for the default.
    #[must_use]
    pub fn kept(self) -> Option<u32> {
        match self {
            Self::Turns(n) => Some(n),
            Self::Default => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use async_trait::async_trait;
    use serde_json::Value;

    use super::*;

    #[test]
    fn the_flag_beats_the_bot_which_beats_the_default() {
        assert_eq!(effective(None, None), 10);
        assert_eq!(effective(None, Some(30)), 30);
        assert_eq!(effective(Some(5), Some(30)), 5);
        assert_eq!(effective(Some(5), None), 5);
    }

    #[test]
    fn a_cap_is_one_to_a_thousand() {
        assert_eq!(check_turns(1).unwrap(), 1);
        assert_eq!(check_turns(1_000).unwrap(), 1_000);
        assert!(check_turns(0).is_err());
        assert!(check_turns(1_001).is_err());
    }

    #[test]
    fn the_file_holds_a_cap_or_none() {
        assert_eq!(parse("goals:\n  max_turns: 25\n").unwrap(), Some(25));
        assert_eq!(parse("goals:\n  max_turns: '7'\n").unwrap(), Some(7));
        assert_eq!(parse("model: x\n").unwrap(), None);
        assert_eq!(parse("goals: {}\n").unwrap(), None);
        // what the engine would not read as a number of turns is not a cap
        assert_eq!(parse("goals:\n  max_turns: 0\n").unwrap(), None);
        assert_eq!(parse("goals:\n  max_turns: lots\n").unwrap(), None);
        assert_eq!(parse("goals:\n  max_turns: -3\n").unwrap(), None);
        assert_eq!(parse("").unwrap(), None);
        assert!(parse("goals: [unclosed").is_err());
    }

    #[test]
    fn a_home_without_a_file_has_no_cap() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read(d.path()).unwrap(), None);
    }

    /// The engine's `config set` and `config unset` over a real file: they change `goals.max_turns` in `config.yaml` and say
    /// "not set" (an error) for an unset of a key that is not there.
    #[derive(Default)]
    struct Cli {
        log: Mutex<Vec<(String, String, String)>>,
    }

    #[async_trait]
    impl Engine for Cli {
        async fn config_get(&self, _: &Path, _: &str) -> Result<Option<Value>> {
            Ok(None)
        }
        async fn config_set(&self, home: &Path, key: &str, value: &str) -> Result<()> {
            assert_eq!(key, KEY);
            std::fs::write(
                home.join("config.yaml"),
                format!("model: x\ngoals:\n  max_turns: {value}\n"),
            )
            .unwrap();
            self.log
                .lock()
                .unwrap()
                .push(("set".into(), key.into(), value.into()));
            Ok(())
        }
        async fn config_unset(&self, home: &Path, key: &str) -> Result<()> {
            if read(home)?.is_none() {
                return Err(Error::Config(format!("Config key not set: {key}")));
            }
            std::fs::write(home.join("config.yaml"), "model: x\ngoals: {}\n").unwrap();
            self.log
                .lock()
                .unwrap()
                .push(("unset".into(), key.into(), String::new()));
            Ok(())
        }
        async fn enable_plugin(&self, _: &Path, _: &str) -> Result<()> {
            Ok(())
        }
        async fn call(&self, _: &Path, _: &str, _: Value) -> Result<Value> {
            Ok(Value::Null)
        }
        async fn reload_plugins(&self, _: &Path, _: &Path) -> Result<()> {
            Ok(())
        }
        async fn restart_when_idle(&self, _: &Path) -> Result<bool> {
            Ok(false)
        }
    }

    fn home() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().to_path_buf();
        std::fs::write(p.join("config.yaml"), "model: x\n").unwrap();
        (d, p)
    }

    #[tokio::test]
    async fn the_cap_is_written_where_the_engine_reads_it_and_only_when_it_differs() {
        let (_d, h) = home();
        let cli = Cli::default();
        assert!(write(&cli, &h, Some(30)).await.unwrap());
        assert_eq!(read(&h).unwrap(), Some(30));
        // the same cap again writes nothing
        assert!(!write(&cli, &h, Some(30)).await.unwrap());
        assert_eq!(cli.log.lock().unwrap().len(), 1);
        // the way back to the default is one unset, and a second one asks for nothing (the engine would refuse it)
        assert!(write(&cli, &h, None).await.unwrap());
        assert_eq!(read(&h).unwrap(), None);
        assert!(!write(&cli, &h, None).await.unwrap());
        assert_eq!(
            cli.log.lock().unwrap().as_slice(),
            [
                ("set".to_owned(), KEY.to_owned(), "30".to_owned()),
                ("unset".to_owned(), KEY.to_owned(), String::new())
            ]
        );
    }

    #[tokio::test]
    async fn a_cap_out_of_range_is_refused_before_the_engine_is_asked() {
        let (_d, h) = home();
        let cli = Cli::default();
        assert!(write(&cli, &h, Some(0)).await.is_err());
        assert!(write(&cli, &h, Some(5_000)).await.is_err());
        assert!(cli.log.lock().unwrap().is_empty());
    }
}
