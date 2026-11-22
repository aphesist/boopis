//! A small reader for the options of the commands that take them (`groups`, `run`, `team`): `--flag`, `--flag value`,
//! `--flag=value`, a `--` that ends the options, and everything else as a plain argument. Each command lists the options it
//! knows; any other one is a usage error (exit code 2), never ignored.

use std::collections::BTreeMap;

/// What an option takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// No value (`--json`).
    Switch,
    /// One value (`--lead kai`), given once.
    Value,
    /// A value that may be given again (`--skills a --skills b`).
    Many,
}

/// A usage mistake, in a sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Usage(pub String);

/// The options of one command, as read.
#[derive(Debug, Default)]
pub struct Args {
    /// What was not an option, in order.
    pub plain: Vec<String>,
    values: BTreeMap<String, Vec<String>>,
}

impl Args {
    /// Read `args` against the options in `known` (`(name without dashes, kind)`).
    ///
    /// # Errors
    /// `Usage` for an option that is not known, a value that is missing, or one given twice that takes one.
    pub fn read(args: &[String], known: &[(&str, Kind)]) -> Result<Self, Usage> {
        let mut out = Self::default();
        let mut i = 0;
        let mut only_plain = false;
        while i < args.len() {
            let a = &args[i];
            i += 1;
            if only_plain || !a.starts_with("--") || a == "--" {
                if a == "--" && !only_plain {
                    only_plain = true;
                } else {
                    out.plain.push(a.clone());
                }
                continue;
            }
            let body = &a[2..];
            let (name, inline) = match body.split_once('=') {
                Some((n, v)) => (n, Some(v.to_owned())),
                None => (body, None),
            };
            let Some((_, kind)) = known.iter().find(|(n, _)| *n == name) else {
                return Err(Usage(format!("--{name} is not an option of this command")));
            };
            let value = match kind {
                Kind::Switch => {
                    if inline.is_some() {
                        return Err(Usage(format!("--{name} takes no value")));
                    }
                    String::new()
                }
                Kind::Value | Kind::Many => {
                    if let Some(v) = inline {
                        v
                    } else {
                        let next = args.get(i).filter(|n| !n.starts_with("--") || n.len() == 2);
                        let Some(v) = next else {
                            return Err(Usage(format!("--{name} needs a value")));
                        };
                        i += 1;
                        v.clone()
                    }
                }
            };
            let slot = out.values.entry(name.to_owned()).or_default();
            if *kind != Kind::Many && !slot.is_empty() {
                return Err(Usage(format!("--{name} is given twice")));
            }
            slot.push(value);
        }
        Ok(out)
    }

    /// Whether a switch was given.
    #[must_use]
    pub fn has(&self, name: &str) -> bool {
        self.values.contains_key(name)
    }

    /// The value of an option, when given.
    #[must_use]
    pub fn value(&self, name: &str) -> Option<&str> {
        self.values
            .get(name)
            .and_then(|v| v.last())
            .map(String::as_str)
    }

    /// Every value of a repeatable option.
    #[must_use]
    #[allow(dead_code)] // no command takes a repeatable option yet; its test keeps the reader whole
    pub fn all(&self, name: &str) -> &[String] {
        self.values.get(name).map_or(&[], Vec::as_slice)
    }

    /// A whole number option.
    ///
    /// # Errors
    /// `Usage` when it is given and is not a whole number.
    pub fn number(&self, name: &str) -> Result<Option<u32>, Usage> {
        self.value(name)
            .map(|v| {
                v.parse::<u32>()
                    .map_err(|_| Usage(format!("--{name} takes a whole number, not {v:?}")))
            })
            .transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| (*s).to_owned()).collect()
    }
    const KNOWN: &[(&str, Kind)] = &[
        ("json", Kind::Switch),
        ("lead", Kind::Value),
        ("skills", Kind::Many),
    ];

    #[test]
    fn options_and_plain_arguments_are_told_apart() {
        let r = Args::read(
            &a(&[
                "paper",
                "kai",
                "--lead",
                "kai",
                "--json",
                "nina",
                "--skills=a",
                "--skills",
                "b",
            ]),
            KNOWN,
        )
        .unwrap();
        assert_eq!(r.plain, ["paper", "kai", "nina"]);
        assert_eq!(r.value("lead"), Some("kai"));
        assert!(r.has("json"));
        assert_eq!(r.all("skills"), ["a", "b"]);
    }

    #[test]
    fn a_double_dash_ends_the_options() {
        let r = Args::read(&a(&["--json", "--", "--lead", "x"]), KNOWN).unwrap();
        assert_eq!(r.plain, ["--lead", "x"]);
        assert!(!r.has("lead"));
    }

    #[test]
    fn mistakes_are_usage_errors() {
        assert!(Args::read(&a(&["--nope"]), KNOWN).is_err());
        assert!(Args::read(&a(&["--lead"]), KNOWN).is_err());
        assert!(Args::read(&a(&["--lead", "--json"]), KNOWN).is_err());
        assert!(Args::read(&a(&["--lead", "a", "--lead", "b"]), KNOWN).is_err());
        assert!(Args::read(&a(&["--json=1"]), KNOWN).is_err());
        assert!(
            Args::read(&a(&["--lead", "x"]), KNOWN)
                .unwrap()
                .number("lead")
                .is_err()
        );
    }
}
