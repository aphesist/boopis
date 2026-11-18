//! Redaction: rules, entropy, false positives, idempotence.
// Test code: a failing unwrap is the failure report, and these pedantic style
// lints (casts in assertions, `Default::default()` in fixtures, `format!` in
// iterator chains) add noise without protecting anything.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::default_trait_access,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::format_collect,
    clippy::too_many_lines
)]

mod common;

use std::fs;
use std::path::Path;

use hx_pack::{Redactions, Redactor, redact};
use proptest::prelude::*;

fn red(path: &str, text: &str) -> (String, Redactions) {
    let (out, counts) = redact(path, text).unwrap();
    (out.into_owned(), counts)
}

#[test]
fn shared_examples_hold() {
    let r = Redactor::embedded().unwrap();
    assert!(!r.examples().is_empty());
    for ex in r.examples() {
        let (out, _) = r.redact("src/x.rs", &ex.input);
        assert_eq!(out, ex.output, "input: {}", ex.input);
    }
}

#[test]
fn named_rules_fire() {
    let cases = [
        ("sk-ant-api03-abcdefghijklmnop", "anthropic_key"),
        ("key sk-proj-abcdefghijklmnopqrstu", "openai_key"),
        ("AKIAIOSFODNN7EXAMPLE", "aws_access_key"),
        ("ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github_token"),
        ("github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuv", "github_pat"),
        ("AIzaSyA-abcdefghijklmnopqrstuvwxyz012345", "google_api_key"),
        ("xoxb-1234567890-abcdefghij", "slack_token"),
        ("sk_live_abcdefghijklmnop1234", "stripe_key"),
        ("glpat-abcdefghijklmnopqrstu", "gitlab_token"),
        (
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
            "jwt",
        ),
        (
            "Authorization: Bearer abcdefghij0123456789abcd",
            "bearer_token",
        ),
        ("redis://user:p4ssw0rd@cache:6379", "url_password"),
        ("client_secret: \"s3cr3t-value\"", "generic_secret"),
        ("{\"api_key\": \"abc12345\"}", "generic_secret"),
        (
            "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
            "private_key",
        ),
    ];
    for (input, rule) in cases {
        let (out, counts) = red("a.txt", input);
        assert!(out.contains(&format!("[REDACTED:{rule}]")), "{rule}: {out}");
        assert!(
            counts.by_rule.get(rule).is_some_and(|n| *n >= 1),
            "{rule}: {counts:?}"
        );
    }
}

#[test]
fn key_blocks_keep_their_line_count_and_truncated_blocks_go_to_the_end() {
    let text = "a\n-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\nz\n";
    let (out, _) = red("k.txt", text);
    assert_eq!(out.matches('\n').count(), text.matches('\n').count());
    assert!(out.starts_with("a\n[REDACTED:private_key]") && out.ends_with("\nz\n"));
    let open = "x\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nQQQQ\nrest\n";
    let (out, counts) = red("k.txt", open);
    assert!(!out.contains("MIIEow") && !out.contains("rest"));
    assert_eq!(counts.by_rule["private_key_open"], 1);
    assert_eq!(out.matches('\n').count(), open.matches('\n').count());
}

#[test]
fn placeholders_are_not_redacted_again_and_templates_are_left_alone() {
    let (out, c) = red(
        "a.txt",
        "password = \"${DB_PASSWORD}\"\ntoken = \"<your token here>\"",
    );
    assert_eq!(c.total, 0, "{out}");
    let (once, _) = red("a.txt", "api_key = \"sk-ant-abcdefghijklmnopqrs\"");
    assert_eq!(once, "api_key = \"[REDACTED:anthropic_key]\"");
}

#[test]
fn entropy_catches_unnamed_tokens_but_not_code() {
    // 43 random-looking base64 characters, no known prefix.
    let secret = "q8Zr3LkP0vXy7TnB5mWc2JdHs9AeUf1GoIbN6tRxYhE";
    let (out, c) = red("cfg.rs", &format!("let k = \"{secret}\";"));
    assert_eq!(out, "let k = \"[REDACTED:high_entropy]\";");
    assert_eq!(c.by_rule["high_entropy"], 1);
    // The AWS secret key shape includes slashes.
    let aws = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    let (out, _) = red("cfg.rs", &format!("x = {aws}"));
    assert!(out.contains("[REDACTED:high_entropy]"), "{out}");
    // Long identifiers, paths and prose stay.
    for keep in [
        "pub fn handle_search_with(req: &SearchRequest, ctl: &Control) -> Result<SearchResponse>",
        "src/components/ui/buttons/PrimaryButton2Variant.tsx",
        "SOME_VERY_LONG_CONSTANT_NAME_WITH_MANY_WORDS_IN_IT_2",
        "the_quick_brown_fox_jumps_over_the_lazy_dog_again_and_again",
        "getUserProfileSettingsForOrganizationAccount",
        "https://registry.npmjs.org/@babel/core/-/core-7.22.5.tgz",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0123456789012345678901234567890123456789",
    ] {
        let (out, c) = red("a.rs", keep);
        assert_eq!(c.total, 0, "{keep} -> {out}");
    }
}

#[test]
fn hex_is_redacted_only_where_a_secret_is_named() {
    let sha = "9fceb02d0ae598e95dc970b74767f19372d61af8";
    assert_eq!(red("a.txt", &format!("commit {sha}")).1.total, 0);
    assert_eq!(red("a.txt", &format!("rev: {sha}")).1.total, 0);
    let hex = "00112233445566778899aabbccddeeff00112233";
    let (out, c) = red("a.txt", &format!("api_secret: {hex}"));
    assert_eq!(c.by_rule["high_entropy"], 1, "{out}");
    // A line that is labelled a checksum is not a secret.
    assert_eq!(red("a.txt", &format!("auth checksum {hex}")).1.total, 0);
}

fn lockfile(name: &str) -> String {
    common::fixture_text(&format!("lockfiles/{name}"))
}

#[test]
fn lockfiles_under_their_own_names_are_untouched() {
    for name in [
        "package-lock.json",
        "Cargo.lock",
        "yarn.lock",
        "pnpm-lock.yaml",
        "go.sum",
        "poetry.lock",
    ] {
        let (_, c) = red(name, &lockfile(name));
        assert_eq!(c.total, 0, "{name}: {c:?}");
    }
}

#[test]
fn hashes_with_a_context_word_are_untouched_under_any_name() {
    // The same text under a neutral name leans on the line contexts and the
    // sha512- prefix alone. go.sum has no context words, so it is not listed.
    for name in [
        "package-lock.json",
        "Cargo.lock",
        "yarn.lock",
        "pnpm-lock.yaml",
        "poetry.lock",
    ] {
        let (_, c) = red("vendor/deps.txt", &lockfile(name));
        assert_eq!(c.total, 0, "{name}: {c:?}");
    }
    let (_, c) = red("vendor/deps.txt", &lockfile("go.sum"));
    assert!(c.total > 0, "go.sum relies on the file-name allowlist");
}

#[test]
fn source_files_of_this_crate_and_the_docs_have_no_false_positives() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    for dir in [
        "src",
        "tests/fixtures/lang",
        "../../docs",
        "../../legacy/crates/turn-primitives/src",
    ] {
        let Ok(rd) = fs::read_dir(base.join(dir)) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() {
                files.push(p);
            }
        }
    }
    files.push(base.join("README.md"));
    let mut checked = 0;
    for p in files {
        let Ok(text) = fs::read_to_string(&p) else {
            continue;
        };
        let name = p.file_name().unwrap().to_str().unwrap();
        // The legacy file and the redaction sources contain secret-shaped
        // *test data* on purpose; the named rules may fire there. Only the
        // entropy pass is under test.
        let (_, c) = red(name, &text);
        let entropy = c.by_rule.get("high_entropy").copied().unwrap_or(0);
        assert_eq!(entropy, 0, "false positive in {}", p.display());
        checked += 1;
    }
    assert!(checked >= 5, "corpus too small: {checked}");
}

#[test]
fn counts_placeholders_in_output() {
    let r = Redactor::embedded().unwrap();
    let mut c = Redactions::default();
    r.count_placeholders(
        "a [REDACTED:jwt] b [REDACTED:jwt] [REDACTED:high_entropy] [REDACTED: x",
        &mut c,
    );
    assert_eq!(c.total, 3);
    assert_eq!(c.by_rule["jwt"], 2);
}

#[test]
fn bad_rules_are_rejected() {
    assert!(Redactor::from_json("{}").is_err());
    let bad_pattern = r#"{"schema_version":1,"placeholder":"[R:{rule}]","placeholder_prefix":"[R:","rules":[{"id":"x","pattern":"("}],
        "entropy":{"enabled":false,"rule_id":"e","min_length":32,"threshold_bits":4.2,"require_classes":3,
        "path_like":{"min_slashes":2,"min_wordlike_fraction":0.5},
        "hex":{"min_length":32,"threshold_bits":3.0,"sensitive_contexts":[]},
        "allow":{"line_contexts":[],"token_prefixes":[],"token_patterns":[],"skip_files":[]}}}"#;
    assert!(Redactor::from_json(bad_pattern).is_err());
}

fn fragment() -> impl Strategy<Value = String> {
    prop_oneof![
        "[ -~]{0,40}",
        "[A-Za-z0-9+/_-]{20,80}",
        Just("sk-ant-api03-abcdefghijklmnop".to_owned()),
        Just("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----".to_owned()),
        Just("-----BEGIN PRIVATE KEY-----\ntruncated".to_owned()),
        Just("password = \"hunter2hunter2\"".to_owned()),
        Just("Bearer abcdefghijklmnopqrstuvwxyz".to_owned()),
        Just("postgres://u:pw1234@h/db".to_owned()),
        Just("\n".to_owned()),
        Just("[REDACTED:jwt]".to_owned()),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { failure_persistence: None, ..ProptestConfig::with_cases(300) })]

    #[test]
    fn redaction_is_idempotent_and_keeps_lines(parts in proptest::collection::vec(fragment(), 0..12)) {
        let text = parts.join(if parts.len() % 2 == 0 { " " } else { "\n" });
        let (once, _) = red("a.txt", &text);
        let (twice, c2) = red("a.txt", &once);
        prop_assert_eq!(&once, &twice);
        prop_assert_eq!(c2.total, 0);
        prop_assert_eq!(once.matches('\n').count(), text.matches('\n').count());
    }

    #[test]
    fn arbitrary_text_is_idempotent(text in any::<String>()) {
        let (once, _) = red("a.txt", &text);
        let (twice, _) = red("a.txt", &once);
        prop_assert_eq!(once, twice);
    }
}

#[test]
fn the_log_redactor_masks_secrets_in_json_log_lines() {
    use hx_proto::log::Redactor as _;
    let log = hx_pack::LogRedactor::embedded().unwrap();
    let line = r#"{"level":"INFO","fields":{"message":"called","method":"sk-ant-api03-abcdefghijklmnopqrstuv"}}"#;
    let out = log.redact(line);
    assert!(
        !out.contains("abcdefghij") && out.contains("[REDACTED:anthropic_key]"),
        "{out}"
    );
    let clean = r#"{"level":"INFO","fields":{"message":"hx serving on stdio","version":"0.1.0"}}"#;
    assert!(
        matches!(log.redact(clean), std::borrow::Cow::Borrowed(_)),
        "clean lines are not copied"
    );
}
