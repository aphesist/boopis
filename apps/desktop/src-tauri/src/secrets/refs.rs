//! Secret references: `secret://<scope>/<name>`, the keychain entry they name and the environment variable that carries
//! them into Hermes. The rule is data (`crates/hx-proto/secret-refs.json`) written once here and once in the plugin
//! (`plugins/boopis/hostsecrets/refs.py`); both are tested against that file's examples.

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// The shared rule file, compiled in (the plugin has its own copy under `data/`).
pub const RULES_JSON: &str = include_str!("../../../../../crates/hx-proto/secret-refs.json");
/// The key of Hermes's config section for the plugin's secret source.
pub const SOURCE: &str = "boopis_host";
const SCHEME: &str = "secret://";
const SERVICE_PREFIX: &str = "boopis.";
const ENV_PREFIX: &str = "BOOPIS_";

/// A parsed reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretRef {
    /// The scope, such as `provider.openai`.
    pub scope: String,
    /// The name within the scope, such as `api_key`.
    pub name: String,
}

fn part_ok(p: &str) -> bool {
    let b = p.as_bytes();
    (1..=63).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'.' | b'-')
        })
}

impl SecretRef {
    /// Parse `secret://<scope>/<name>`.
    ///
    /// # Errors
    /// `InvalidInput` for anything else.
    pub fn parse(text: &str) -> Result<Self> {
        let rest = text
            .strip_prefix(SCHEME)
            .ok_or_else(|| Error::InvalidInput(format!("{text:?} is not a secret reference")))?;
        match rest.split_once('/') {
            Some((scope, name)) if part_ok(scope) && part_ok(name) => Ok(Self {
                scope: scope.to_owned(),
                name: name.to_owned(),
            }),
            _ => Err(Error::InvalidInput(format!(
                "{text:?} is not secret://<scope>/<name> (lowercase)"
            ))),
        }
    }

    /// The reference as text.
    #[must_use]
    pub fn text(&self) -> String {
        format!("{SCHEME}{}/{}", self.scope, self.name)
    }

    /// The keychain service.
    #[must_use]
    pub fn service(&self) -> String {
        format!("{SERVICE_PREFIX}{}", self.scope)
    }

    /// The environment variable Hermes reads this secret from.
    #[must_use]
    pub fn env_name(&self) -> String {
        let raw = format!("{}_{}", self.scope, self.name).to_ascii_uppercase();
        let mut slug = String::new();
        for c in raw.chars() {
            let c = if c.is_ascii_alphanumeric() { c } else { '_' };
            if c == '_' && slug.ends_with('_') {
                continue;
            }
            slug.push(c);
        }
        let digest = hex::encode(Sha256::digest(self.text().as_bytes()));
        format!(
            "{ENV_PREFIX}{}_{}",
            slug.trim_matches('_'),
            digest[..8].to_ascii_uppercase()
        )
    }

    /// The reference for a provider's API key.
    #[must_use]
    pub fn provider_key(provider: &str) -> Self {
        Self {
            scope: format!("provider.{provider}"),
            name: "api_key".to_owned(),
        }
    }
}

/// The environment variable a built-in provider reads its key from, when the shared table knows it.
#[must_use]
pub fn builtin_provider_env(provider: &str) -> Option<String> {
    let rules: serde_json::Value = serde_json::from_str(RULES_JSON).ok()?;
    rules["builtin_provider_env"][provider]
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rule_matches_the_shared_examples() {
        let rules: serde_json::Value = serde_json::from_str(RULES_JSON).unwrap();
        let examples = rules["examples"].as_array().unwrap();
        assert!(!examples.is_empty());
        for ex in examples {
            let r = SecretRef::parse(ex["ref"].as_str().unwrap()).unwrap();
            assert_eq!(r.service(), ex["service"].as_str().unwrap());
            assert_eq!(r.name, ex["account"].as_str().unwrap());
            assert_eq!(r.env_name(), ex["env"].as_str().unwrap());
        }
    }

    #[test]
    fn bad_references_are_refused() {
        for bad in [
            "",
            "secret://",
            "secret://a",
            "http://a/b",
            "secret://A/b",
            "secret://a/b/c",
            "secret:///b",
        ] {
            assert!(SecretRef::parse(bad).is_err(), "{bad}");
        }
        assert_eq!(
            builtin_provider_env("anthropic").unwrap(),
            "ANTHROPIC_API_KEY"
        );
        assert_eq!(builtin_provider_env("nope"), None);
    }
}
