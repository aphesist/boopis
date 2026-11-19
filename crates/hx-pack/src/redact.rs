//! Secret redaction: named patterns plus Shannon-entropy detection.
//!
//! The rules live in `redact.rules.json`, which the Python plugin reads as
//! well (`boopis.util.redact`), so both sides redact alike. Each redaction
//! becomes `[REDACTED:<rule>]` and is counted.
//!
//! Properties the tests hold:
//! * **idempotent**: redacting redacted text changes nothing;
//! * **line-preserving**: a multi-line match leaves as many newlines as it
//!   had, so line numbers computed on redacted text equal the original's;
//! * **lockfile-safe**: hashes and git SHAs are not mistaken for secrets.

use std::borrow::Cow;
use std::sync::OnceLock;

use regex::{Regex, RegexSet};
use serde::Deserialize;

use crate::error::{Error, Result};
use crate::types::Redactions;

const RULES_JSON: &str = include_str!("../redact.rules.json");

#[derive(Deserialize)]
struct RulesFile {
    schema_version: u32,
    placeholder: String,
    placeholder_prefix: String,
    rules: Vec<RuleDef>,
    entropy: EntropyDef,
    #[serde(default)]
    examples: Vec<Example>,
}

#[derive(Deserialize)]
struct RuleDef {
    id: String,
    pattern: String,
    #[serde(default)]
    preserve_lines: bool,
    #[serde(default)]
    skip_value_prefixes: Vec<String>,
}

#[derive(Deserialize)]
struct PathLikeDef {
    min_slashes: usize,
    min_wordlike_fraction: f64,
}

#[derive(Deserialize)]
struct HexDef {
    min_length: usize,
    threshold_bits: f64,
    sensitive_contexts: Vec<String>,
}

#[derive(Deserialize)]
struct AllowDef {
    line_contexts: Vec<String>,
    token_prefixes: Vec<String>,
    token_patterns: Vec<String>,
    skip_files: Vec<String>,
}

#[derive(Deserialize)]
struct EntropyDef {
    enabled: bool,
    rule_id: String,
    min_length: usize,
    threshold_bits: f64,
    require_classes: usize,
    path_like: PathLikeDef,
    hex: HexDef,
    allow: AllowDef,
}

/// One input/output pair from the rules file, shared with other implementations.
#[derive(Deserialize, Debug, Clone)]
pub struct Example {
    /// Text to redact.
    pub input: String,
    /// The expected result.
    pub output: String,
}

struct Rule {
    id: String,
    re: Regex,
    has_secret_group: bool,
    preserve_lines: bool,
    skip_value_prefixes: Vec<String>,
}

struct Entropy {
    rule_id: String,
    token_re: Regex,
    min_length: usize,
    threshold: f64,
    require_classes: usize,
    path_min_slashes: usize,
    path_wordlike: f64,
    hex_min: usize,
    hex_threshold: f64,
    sensitive: Vec<String>,
    line_contexts: Vec<String>,
    prefixes: Vec<String>,
    token_patterns: Vec<Regex>,
    skip_files: Vec<String>,
}

/// A compiled rule set.
pub struct Redactor {
    rules: Vec<Rule>,
    set: RegexSet,
    entropy: Option<Entropy>,
    ph_head: String,
    ph_tail: String,
    ph_prefix: String,
    examples: Vec<Example>,
}

impl std::fmt::Debug for Redactor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Redactor")
            .field("rules", &self.rules.len())
            .field("entropy", &self.entropy.is_some())
            .finish_non_exhaustive()
    }
}

fn cfg(msg: impl std::fmt::Display) -> Error {
    Error::ConfigInvalid(format!("redact.rules.json: {msg}"))
}

fn compile(pat: &str) -> Result<Regex> {
    Regex::new(pat).map_err(|e| cfg(format!("{pat}: {e}")))
}

impl Redactor {
    /// Compiles a rules document.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] for bad JSON, bad patterns, or a placeholder
    /// that the entropy pass could mistake for a token (which would break
    /// idempotence).
    pub fn from_json(json: &str) -> Result<Self> {
        let file: RulesFile = serde_json::from_str(json).map_err(cfg)?;
        if file.schema_version != 1 {
            return Err(cfg(format!(
                "unsupported schema_version {}",
                file.schema_version
            )));
        }
        let (ph_head, ph_tail) = file
            .placeholder
            .split_once("{rule}")
            .map(|(a, b)| (a.to_owned(), b.to_owned()))
            .ok_or_else(|| cfg("placeholder needs {rule}"))?;
        let mut rules = Vec::new();
        let mut patterns = Vec::new();
        for def in file.rules {
            let re = compile(&def.pattern)?;
            let has_secret_group = re.capture_names().flatten().any(|n| n == "secret");
            patterns.push(def.pattern.clone());
            rules.push(Rule {
                id: def.id,
                re,
                has_secret_group,
                preserve_lines: def.preserve_lines,
                skip_value_prefixes: def.skip_value_prefixes,
            });
        }
        let set = RegexSet::new(&patterns).map_err(cfg)?;
        let entropy = if file.entropy.enabled {
            Some(Self::build_entropy(file.entropy)?)
        } else {
            None
        };
        let redactor = Self {
            rules,
            set,
            entropy,
            ph_head,
            ph_tail,
            ph_prefix: file.placeholder_prefix,
            examples: file.examples,
        };
        redactor.check_placeholders_are_not_tokens()?;
        Ok(redactor)
    }

    fn build_entropy(def: EntropyDef) -> Result<Entropy> {
        let min = def.min_length.min(def.hex.min_length).max(8);
        let token_re = compile(&format!("[A-Za-z0-9+/_\\-]{{{min},}}={{0,2}}"))?;
        let token_patterns = def
            .allow
            .token_patterns
            .iter()
            .map(|p| compile(p))
            .collect::<Result<Vec<_>>>()?;
        let lower = |v: Vec<String>| v.into_iter().map(|s| s.to_lowercase()).collect::<Vec<_>>();
        Ok(Entropy {
            rule_id: def.rule_id,
            token_re,
            min_length: def.min_length,
            threshold: def.threshold_bits,
            require_classes: def.require_classes,
            path_min_slashes: def.path_like.min_slashes,
            path_wordlike: def.path_like.min_wordlike_fraction,
            hex_min: def.hex.min_length,
            hex_threshold: def.hex.threshold_bits,
            sensitive: lower(def.hex.sensitive_contexts),
            line_contexts: lower(def.allow.line_contexts),
            prefixes: def.allow.token_prefixes,
            token_patterns,
            skip_files: def.allow.skip_files,
        })
    }

    /// A placeholder must not look like a secret to the entropy pass, or
    /// redacting twice would redact the placeholder.
    fn check_placeholders_are_not_tokens(&self) -> Result<()> {
        let Some(e) = &self.entropy else {
            return Ok(());
        };
        let min = e.min_length.min(e.hex_min);
        let ids = self
            .rules
            .iter()
            .map(|r| r.id.as_str())
            .chain([e.rule_id.as_str()]);
        for id in ids {
            let ph = self.placeholder(id);
            if e.token_re.is_match(&ph) || ph.len() > min * 4 {
                return Err(cfg(format!(
                    "placeholder for {id} could be read as a token"
                )));
            }
        }
        Ok(())
    }

    /// The compiled embedded rules.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] if the embedded file is broken; callers fail
    /// closed and return nothing.
    pub fn embedded() -> Result<&'static Self> {
        static CELL: OnceLock<std::result::Result<Redactor, String>> = OnceLock::new();
        CELL.get_or_init(|| Redactor::from_json(RULES_JSON).map_err(|e| e.to_string()))
            .as_ref()
            .map_err(|msg| Error::ConfigInvalid(msg.clone()))
    }

    /// The shared input/output examples from the rules file.
    #[must_use]
    pub fn examples(&self) -> &[Example] {
        &self.examples
    }

    fn placeholder(&self, rule: &str) -> String {
        format!("{}{rule}{}", self.ph_head, self.ph_tail)
    }

    /// Redacts `text`. `path` is the file's relative path; the entropy pass
    /// uses its name to leave lockfiles alone. Returns the text and the
    /// redactions applied.
    #[must_use]
    pub fn redact<'a>(&self, path: &str, text: &'a str) -> (Cow<'a, str>, Redactions) {
        let mut counts = Redactions::default();
        let mut current: Cow<'a, str> = Cow::Borrowed(text);
        for idx in &self.set.matches(text) {
            if let Some(rule) = self.rules.get(idx)
                && let Some(next) = self.apply_rule(rule, &current, &mut counts)
            {
                current = Cow::Owned(next);
            }
        }
        if let Some(e) = &self.entropy {
            let name = path.rsplit('/').next().unwrap_or(path);
            if !e.skip_files.iter().any(|f| f == name)
                && let Some(next) = self.apply_entropy(e, &current, &mut counts)
            {
                current = Cow::Owned(next);
            }
        }
        (current, counts)
    }

    fn apply_rule(&self, rule: &Rule, text: &str, counts: &mut Redactions) -> Option<String> {
        let ph = self.placeholder(&rule.id);
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        let mut hits = 0usize;
        if rule.has_secret_group {
            for caps in rule.re.captures_iter(text) {
                let Some(g) = caps.name("secret") else {
                    continue;
                };
                let value = g.as_str();
                if value.starts_with(&self.ph_prefix)
                    || rule
                        .skip_value_prefixes
                        .iter()
                        .any(|p| value.starts_with(p.as_str()))
                {
                    continue;
                }
                out.push_str(&text[last..g.start()]);
                out.push_str(&ph);
                last = g.end();
                hits += 1;
            }
        } else {
            for m in rule.re.find_iter(text) {
                out.push_str(&text[last..m.start()]);
                out.push_str(&ph);
                if rule.preserve_lines {
                    let newlines = m.as_str().bytes().filter(|&b| b == b'\n').count();
                    out.extend(std::iter::repeat_n('\n', newlines));
                }
                last = m.end();
                hits += 1;
            }
        }
        if hits == 0 {
            return None;
        }
        out.push_str(&text[last..]);
        counts.total += hits;
        *counts.by_rule.entry(rule.id.clone()).or_insert(0) += hits;
        Some(out)
    }

    fn apply_entropy(&self, e: &Entropy, text: &str, counts: &mut Redactions) -> Option<String> {
        let ph = self.placeholder(&e.rule_id);
        let mut out = String::new();
        let mut last = 0;
        let mut hits = 0usize;
        for m in e.token_re.find_iter(text) {
            if !e.is_secret(m.as_str(), line_of(text, m.start(), m.end())) {
                continue;
            }
            out.push_str(&text[last..m.start()]);
            out.push_str(&ph);
            last = m.end();
            hits += 1;
        }
        if hits == 0 {
            return None;
        }
        out.push_str(&text[last..]);
        counts.total += hits;
        *counts.by_rule.entry(e.rule_id.clone()).or_insert(0) += hits;
        Some(out)
    }

    /// Counts the placeholders in `text`, by rule. This is how a response
    /// reports the redactions its output contains.
    pub fn count_placeholders(&self, text: &str, into: &mut Redactions) {
        let mut rest = text;
        while let Some(i) = rest.find(&self.ph_prefix) {
            rest = &rest[i + self.ph_prefix.len()..];
            let Some(end) = rest.find(&self.ph_tail) else {
                break;
            };
            let id = &rest[..end];
            if id.len() <= 32 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
                into.total += 1;
                *into.by_rule.entry(id.to_owned()).or_insert(0) += 1;
            }
            rest = &rest[end..];
        }
    }
}

/// The line of `text` that holds `start..end`.
fn line_of(text: &str, start: usize, end: usize) -> &str {
    let from = text[..start].rfind('\n').map_or(0, |i| i + 1);
    let to = text[end..].find('\n').map_or(text.len(), |i| end + i);
    &text[from..to]
}

impl Entropy {
    /// Whether `token` (found on `line`) is a secret the rules did not name.
    fn is_secret(&self, token: &str, line: &str) -> bool {
        let core = token.trim_end_matches('=');
        if core.len() < self.hex_min.min(self.min_length) {
            return false;
        }
        if self.prefixes.iter().any(|p| core.starts_with(p.as_str()))
            || self.token_patterns.iter().any(|re| re.is_match(core))
        {
            return false;
        }
        let is_hex = core.bytes().all(|b| b.is_ascii_hexdigit());
        let bits = shannon_bits(core.as_bytes());
        let candidate = if is_hex {
            core.len() >= self.hex_min && bits >= self.hex_threshold
        } else {
            core.len() >= self.min_length
                && bits >= self.threshold
                && class_count(core) >= self.require_classes
                && !self.path_like(core)
        };
        if !candidate {
            return false;
        }
        let lower = line.to_lowercase();
        if self
            .line_contexts
            .iter()
            .any(|c| lower.contains(c.as_str()))
        {
            return false;
        }
        // Hashes and git SHAs are hex: only a line that names a secret makes one suspect.
        !is_hex || self.sensitive.iter().any(|c| lower.contains(c.as_str()))
    }

    fn path_like(&self, token: &str) -> bool {
        let slashes = token.matches('/').count();
        if slashes < self.path_min_slashes {
            return false;
        }
        let segments: Vec<&str> = token.split('/').filter(|s| !s.is_empty()).collect();
        let wordlike = segments
            .iter()
            .filter(|s| {
                s.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
            })
            .count();
        #[allow(clippy::cast_precision_loss)]
        // Segment counts are tiny; the float is a ratio, not an index.
        let fraction = wordlike as f64 / segments.len().max(1) as f64;
        fraction >= self.path_wordlike
    }
}

/// Shannon entropy of `bytes`, in bits per byte.
#[must_use]
pub fn shannon_bits(bytes: &[u8]) -> f64 {
    if bytes.is_empty() {
        return 0.0;
    }
    let mut freq = [0u32; 256];
    for &b in bytes {
        freq[usize::from(b)] += 1;
    }
    #[allow(clippy::cast_precision_loss)]
    // Token lengths are far below 2^52; the conversion is exact.
    let n = bytes.len() as f64;
    freq.iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = f64::from(c) / n;
            -p * p.log2()
        })
        .sum()
}

fn class_count(s: &str) -> usize {
    let b = s.as_bytes();
    [
        b.iter().any(u8::is_ascii_uppercase),
        b.iter().any(u8::is_ascii_lowercase),
        b.iter().any(u8::is_ascii_digit),
    ]
    .into_iter()
    .filter(|&x| x)
    .count()
}

/// Redacts `text` with the embedded rules.
///
/// # Errors
/// [`Error::ConfigInvalid`] if the embedded rules do not load.
pub fn redact<'a>(path: &str, text: &'a str) -> Result<(Cow<'a, str>, Redactions)> {
    Ok(Redactor::embedded()?.redact(path, text))
}

/// The redactor `hx` hands to its logger (`hx_proto::log::Redactor`): the embedded rules,
/// applied to every log line.
#[derive(Debug, Clone, Copy)]
pub struct LogRedactor(&'static Redactor);

impl LogRedactor {
    /// Loads the embedded rules.
    ///
    /// # Errors
    /// [`Error::ConfigInvalid`] if they are broken: the binary should refuse to start
    /// rather than log unredacted.
    pub fn embedded() -> Result<Self> {
        Ok(Self(Redactor::embedded()?))
    }
}

impl hx_proto::log::Redactor for LogRedactor {
    fn redact<'a>(&self, line: &'a str) -> Cow<'a, str> {
        self.0.redact("", line).0
    }
}
