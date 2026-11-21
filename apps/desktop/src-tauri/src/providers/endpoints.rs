//! The rules behind an endpoint of the person's own (ADR-0039): the slug derived from its name, the checks on what the form sends, and
//! the key's own check. The rules are data (`providers.json`, `endpoint`); the numbers here are read from it.

use super::endpoint::EndpointRequest;
use super::http::Address;
use super::{Config, catalogue};
use crate::error::{Error, Result};

const MAX_KEY: usize = 4096;

fn invalid(why: impl Into<String>) -> Error {
    Error::Provider("hx.provider.endpoint_invalid", why.into())
}

/// The slug a name makes: the prefix (`custom-`), the name in lower case with every run of anything but letters and digits as one
/// dash, dashes trimmed, cut to leave the pattern's 40 characters; `-2`, `-3` and so on while `taken` has it. A name with no letter
/// or digit makes none.
///
/// # Errors
/// `hx.provider.endpoint_invalid` for a name that is empty or has no letter or digit, or when every suffix is taken.
pub fn slug_for(name: &str, taken: &[String]) -> Result<String> {
    let rules = &catalogue().endpoint.slug;
    let prefix = rules["prefix"].as_str().unwrap_or("custom-");
    let room = 40;
    let mut base = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            base.push(c);
        } else if !base.ends_with('-') {
            base.push('-');
        }
    }
    let base = base.trim_matches('-');
    if base.is_empty() {
        return Err(invalid("the name needs at least one letter or digit"));
    }
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>().trim_end_matches('-').to_owned();
    let first = format!("{prefix}{}", cut(base, room));
    if !taken.contains(&first) {
        return Ok(first);
    }
    for n in 2..100 {
        let suffix = format!("-{n}");
        let s = format!("{prefix}{}{suffix}", cut(base, room - suffix.len()));
        if !taken.contains(&s) {
            return Ok(s);
        }
    }
    Err(Error::Provider(
        "hx.provider.endpoint_exists",
        "there are too many endpoints with that name".into(),
    ))
}

/// The slugs a new endpoint may not take: the ones in the configuration and the fixed ones of the catalogue's runtimes
/// (`custom-ollama` and the like).
#[must_use]
pub fn reserved(existing: &[String]) -> Vec<String> {
    let mut all: Vec<String> = existing.to_vec();
    all.extend(
        catalogue()
            .ways()
            .filter(|(_, w)| w.config == Config::Endpoint)
            .filter_map(|(_, w)| w.slug.clone()),
    );
    all
}

/// Check a key a person pasted: surrounding whitespace (a pasted newline) is dropped; what is left must be one token with no
/// whitespace or control character, not empty, not absurdly long, and must not start with a prefix the way refuses.
///
/// # Errors
/// `hx.provider.key_invalid`. Nothing about the key is in the message.
pub fn clean_key(raw: &str, refuse_prefixes: &[String]) -> Result<String> {
    let key = raw.trim();
    let bad = key.is_empty()
        || key.len() > MAX_KEY
        || key.chars().any(|c| c.is_whitespace() || c.is_control());
    if bad {
        return Err(Error::Provider(
            "hx.provider.key_invalid",
            "a key is one piece of text, with no spaces, up to 4096 characters".into(),
        ));
    }
    if refuse_prefixes.iter().any(|p| key.starts_with(p.as_str())) {
        return Err(Error::Provider(
            "hx.provider.key_invalid",
            "that kind of key is not for boopis (its plan limits use to the tools it lists); use a pay-as-you-go key".into(),
        ));
    }
    Ok(key.to_owned())
}

/// What a request to save an endpoint asks, after the checks.
#[derive(Debug)]
pub struct Checked {
    /// The address.
    pub address: Address,
    /// The ids to save, in order, without repeats.
    pub models: Vec<String>,
    /// The request timeout in seconds.
    pub timeout_s: u32,
    /// The key, cleaned, when there is one.
    pub key: Option<String>,
}

/// Check an endpoint request against the rules in the data: address, model ids, `use_model`, context length, timeout and key.
///
/// # Errors
/// `hx.provider.endpoint_invalid`, `hx.provider.endpoint_blocked`, `hx.provider.key_invalid`.
pub fn check(req: &EndpointRequest) -> Result<Checked> {
    let limits = &catalogue().endpoint.limits;
    let address = Address::parse(&req.base_url)?;
    let mut models: Vec<String> = Vec::new();
    for raw in &req.models {
        let id = raw.trim();
        if id.is_empty() {
            continue;
        }
        if id.chars().count() > limits.max_model_id_chars as usize
            || id.chars().any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(invalid("a model id is one word of up to 200 characters"));
        }
        if !models.iter().any(|m| m == id) {
            models.push(id.to_owned());
        }
    }
    if models.len() > limits.max_models as usize {
        return Err(invalid(format!("at most {} models", limits.max_models)));
    }
    if let Some(m) = &req.use_model
        && !models.contains(m)
    {
        return Err(invalid("the model to use is not one of the models saved"));
    }
    if let Some(c) = req.context_length
        && c < limits.context_length_min
    {
        return Err(invalid(format!(
            "a context length is at least {}",
            limits.context_length_min
        )));
    }
    let default_timeout = if address.loopback {
        limits.request_timeout_loopback_s
    } else {
        limits.request_timeout_s
    };
    let timeout_s = req.request_timeout_s.unwrap_or(default_timeout);
    if !(1..=3600).contains(&timeout_s) {
        return Err(invalid("a request timeout is 1 to 3600 seconds"));
    }
    let key = match req.key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) => Some(clean_key(k, &[])?),
        None => None,
    };
    Ok(Checked {
        address,
        models,
        timeout_s,
        key,
    })
}

/// The `models` value of `providers.<slug>`: a table of ids, which the engine reads and the setup's model choices list.
#[must_use]
pub fn models_value(models: &[String]) -> serde_json::Value {
    serde_json::Value::Object(
        models
            .iter()
            .map(|m| (m.clone(), serde_json::json!({})))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ApiMode;

    fn slug(name: &str, taken: &[&str]) -> Result<String> {
        slug_for(name, &taken.iter().map(|t| (*t).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn the_slug_rule_follows_the_catalogues_examples() {
        let rules = &catalogue().endpoint.slug;
        for ex in rules["examples"].as_array().unwrap() {
            let taken: Vec<&str> = ex["taken"].as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
            assert_eq!(slug(ex["name"].as_str().unwrap(), &taken).unwrap(), ex["slug"].as_str().unwrap());
        }
        for bad in rules["invalid_names"].as_array().unwrap() {
            assert!(slug(bad.as_str().unwrap(), &[]).is_err(), "{bad}");
        }
    }

    #[test]
    fn every_slug_matches_the_pattern_and_is_never_frontier() {
        let pattern = catalogue().endpoint.slug["pattern"].as_str().unwrap().to_owned();
        let re = |s: &str| {
            // ^custom-[a-z0-9][a-z0-9-]{0,39}$
            let rest = s.strip_prefix("custom-").unwrap_or("");
            let b = rest.as_bytes();
            pattern.starts_with("^custom-")
                && (1..=40).contains(&b.len())
                && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
                && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        };
        let long = "A very long name that goes on and on and on and on and on".to_owned();
        let mut taken = Vec::new();
        for name in ["Ünïcode Server", "x", "---a---", "9lives", long.as_str(), "ÄÖ x ÄÖ"] {
            let s = slug_for(name, &taken).unwrap();
            assert!(re(&s), "{name}: {s}");
            assert!(!crate::frontier::is_frontier(&s, "claude-opus-5-5"), "{s}");
            assert!(crate::secrets::refs::SecretRef::parse(&format!("secret://provider.{s}/api_key")).is_ok(), "{s}");
            taken.push(s);
        }
        // a long name still takes its suffixes inside the limit and stays unique
        let mut seen = std::collections::BTreeSet::new();
        let mut taken = Vec::new();
        for _ in 0..12 {
            let s = slug_for(&long, &taken).unwrap();
            assert!(re(&s) && seen.insert(s.clone()), "{s}");
            taken.push(s);
        }
    }

    #[test]
    fn the_fixed_runtime_slugs_are_taken_before_anyone_chooses_them() {
        let r = reserved(&[]);
        for s in ["custom-ollama", "custom-llama-cpp", "custom-vllm"] {
            assert!(r.iter().any(|x| x == s), "{s}");
        }
        assert_eq!(slug_for("Ollama", &r).unwrap(), "custom-ollama-2");
    }

    #[test]
    fn a_key_is_one_clean_token_and_a_coding_plan_key_is_refused() {
        let kimi = vec!["sk-kimi-".to_owned()];
        assert_eq!(clean_key("  sk-abc123\n", &[]).unwrap(), "sk-abc123");
        for bad in ["", "   ", "sk abc", "sk-a\tb", "sk-a\u{7}b", &"k".repeat(5000)] {
            assert_eq!(clean_key(bad, &[]).unwrap_err().code(), "hx.provider.key_invalid", "{bad:?}");
        }
        let e = clean_key("sk-kimi-abcdef", &kimi).unwrap_err();
        assert_eq!(e.code(), "hx.provider.key_invalid");
        assert!(!e.to_string().contains("abcdef"), "the key is never in the message");
        assert!(clean_key("sk-moon-abcdef", &kimi).is_ok());
    }

    fn request() -> EndpointRequest {
        EndpointRequest {
            name: "My Server".into(),
            base_url: "http://127.0.0.1:8000/v1".into(),
            api_mode: ApiMode::ChatCompletions,
            key: None,
            models: vec!["a".into(), " b ".into(), "a".into(), String::new()],
            discover: true,
            context_length: None,
            request_timeout_s: None,
            use_model: None,
            profile: None,
        }
    }

    #[test]
    fn the_request_checks_hold_to_the_data() {
        let ok = check(&request()).unwrap();
        assert_eq!(ok.models, ["a", "b"]);
        assert_eq!(ok.timeout_s, 300, "longer on this computer");
        let mut r = request();
        r.base_url = "https://api.example.com/v1".into();
        assert_eq!(check(&r).unwrap().timeout_s, 120);
        let code = |f: &dyn Fn(&mut EndpointRequest)| {
            let mut r = request();
            f(&mut r);
            check(&r).unwrap_err().code()
        };
        assert_eq!(code(&|r| r.base_url = "http://10.0.0.5/v1".into()), "hx.provider.endpoint_blocked");
        assert_eq!(code(&|r| r.base_url = "ftp://x".into()), "hx.provider.endpoint_invalid");
        assert_eq!(code(&|r| r.models = vec!["two words".into()]), "hx.provider.endpoint_invalid");
        assert_eq!(code(&|r| r.models = vec!["x".repeat(201)]), "hx.provider.endpoint_invalid");
        assert_eq!(code(&|r| r.models = (0..51).map(|i| format!("m{i}")).collect()), "hx.provider.endpoint_invalid");
        assert_eq!(code(&|r| r.use_model = Some("zzz".into())), "hx.provider.endpoint_invalid");
        assert_eq!(code(&|r| r.context_length = Some(10)), "hx.provider.endpoint_invalid");
        assert_eq!(code(&|r| r.request_timeout_s = Some(0)), "hx.provider.endpoint_invalid");
        assert_eq!(code(&|r| r.key = Some("a b".into())), "hx.provider.key_invalid");
        let mut r = request();
        r.key = Some("   ".into());
        assert!(check(&r).unwrap().key.is_none(), "a blank key is no key");
    }
}
