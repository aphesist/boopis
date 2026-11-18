use super::*;
use crate::normalize::{ResolvedPath, ResolvedPolicy};
use crate::policy::Degraded;
use proptest::prelude::*;
use std::time::Duration;

/// A reference implementation of `CommandLineToArgvW` for arguments after the program name,
/// following its documented rules, to check `quote_arg` against.
fn parse_args(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut args = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && (chars[i] == ' ' || chars[i] == '\t') {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let mut arg = String::new();
        let mut in_quotes = false;
        while i < chars.len() {
            let c = chars[i];
            if c == '\\' {
                let mut n = 0;
                while i < chars.len() && chars[i] == '\\' {
                    n += 1;
                    i += 1;
                }
                if i < chars.len() && chars[i] == '"' {
                    arg.extend(std::iter::repeat_n('\\', n / 2));
                    if n % 2 == 1 {
                        arg.push('"');
                        i += 1;
                    }
                } else {
                    arg.extend(std::iter::repeat_n('\\', n));
                }
            } else if c == '"' {
                in_quotes = !in_quotes;
                i += 1;
            } else if (c == ' ' || c == '\t') && !in_quotes {
                break;
            } else {
                arg.push(c);
                i += 1;
            }
        }
        args.push(arg);
    }
    args
}

#[test]
fn quoting_known_cases() {
    assert_eq!(quote_arg("simple"), "simple");
    assert_eq!(quote_arg(""), "\"\"");
    assert_eq!(quote_arg("two words"), "\"two words\"");
    assert_eq!(quote_arg(r#"say "hi""#), r#""say \"hi\"""#);
    assert_eq!(quote_arg(r"C:\dir with space\"), r#""C:\dir with space\\""#);
    assert_eq!(quote_arg(r"C:\plain\path"), r"C:\plain\path");
    assert_eq!(
        quote_arg("a&b|c>d"),
        "a&b|c>d",
        "metacharacters are inert without a shell"
    );
}

#[test]
fn command_line_rejects_nul_and_quotes_the_program() {
    assert!(command_line("p", &["a\0b".into()]).is_err());
    let line = command_line(r"C:\Program Files\tool.exe", &["x y".into()]).unwrap();
    assert_eq!(line, r#""C:\Program Files\tool.exe" "x y""#);
}

proptest! {
    #[test]
    fn quoting_round_trips_through_the_parser(args in proptest::collection::vec(
        proptest::string::string_regex(r#"[a-zA-Z0-9 \t"\\é&|^%!]{0,12}"#).unwrap(), 0..6))
    {
        let line = args.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" ");
        prop_assert_eq!(parse_args(&line), args);
    }

    #[test]
    fn an_argument_never_splits_into_several(arg in proptest::string::string_regex(r#"[ \t"\\a]{0,16}"#).unwrap()) {
        let parsed = parse_args(&quote_arg(&arg));
        prop_assert_eq!(parsed, vec![arg]);
    }
}

#[test]
fn env_block_is_sorted_double_nul_terminated() {
    let env = vec![
        (OsString::from("b"), OsString::from("2")),
        (OsString::from("A"), OsString::from("1")),
    ];
    let block = env_block(&env);
    let text = String::from_utf16(&block).unwrap();
    assert_eq!(text, "A=1\0b=2\0\0");
    assert_eq!(env_block(&[]), vec![0, 0]);
}

#[test]
fn env_values_may_contain_equals_and_unicode() {
    let block = env_block(&[(OsString::from("K"), OsString::from("a=b é"))]);
    assert_eq!(String::from_utf16(&block).unwrap(), "K=a=b é\0\0");
}

fn policy(network: NetworkPolicy) -> ResolvedPolicy {
    let g = |p: &str, d| ResolvedPath {
        requested: p.into(),
        path: p.into(),
        is_dir: d,
    };
    ResolvedPolicy {
        ro: vec![g(r"C:\work", true), g(r"C:\tools\tool.exe", false)],
        rw: vec![g(r"C:\scratch", true)],
        network,
        env: vec![],
        cwd: r"C:\work".into(),
        timeout: Duration::from_secs(1),
        output_cap: 1,
        kill_grace: Duration::ZERO,
        degraded: Degraded::default(),
        resources: crate::normalize::ResolvedLimits::default(),
    }
}

#[test]
fn acl_grants_map_ro_and_rw_and_never_grant_acl_control() {
    let grants = acl_grants(&policy(NetworkPolicy::Off));
    assert_eq!(grants.len(), 3);
    assert_eq!(
        grants[0],
        AclGrant {
            path: r"C:\work".into(),
            right: Right::ReadExecute,
            inherit: true
        }
    );
    assert!(!grants[1].inherit, "a single file has nothing to inherit");
    assert_eq!(grants[2].right, Right::Modify);
    for g in &grants {
        assert_eq!(
            g.right.mask() & mask::ACL_CONTROL,
            0,
            "{g:?} must not allow rewriting the ACL"
        );
    }
    assert_eq!(
        Right::ReadExecute.mask() & 0x0002,
        0,
        "read-only must not include FILE_WRITE_DATA"
    );
    assert_ne!(Right::Modify.mask() & 0x0002, 0);
    assert_ne!(
        Right::Modify.mask() & 0x0001_0000,
        0,
        "DELETE is part of modify"
    );
    assert_ne!(
        Right::Modify.mask() & 0x0040,
        0,
        "FILE_DELETE_CHILD is part of modify"
    );
}

#[test]
fn network_modes_map_to_capabilities() {
    let off = network_plan(&NetworkPolicy::Off).unwrap();
    assert!(off.capabilities.is_empty() && !off.loopback_exempt);
    let lo = network_plan(&NetworkPolicy::Loopback).unwrap();
    assert!(lo.capabilities.is_empty() && lo.loopback_exempt);
    let on = network_plan(&NetworkPolicy::On).unwrap();
    assert!(on.capabilities.contains(&"S-1-15-3-1"));
    assert!(network_plan(&NetworkPolicy::Allowlist(vec!["x.org".into()])).is_err());
}

#[test]
fn container_names_fit_and_are_distinct() {
    let a = container_name([1; 16]);
    let b = container_name([2; 16]);
    assert!(a.len() <= 64, "{}", a.len());
    assert_ne!(a, b);
    assert!(a.starts_with("hx-sandbox."));
    assert!(
        a.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
    );
}

#[test]
fn job_limits_include_the_clipboard_and_desktop() {
    assert_eq!(JOB_UI_LIMITS, 0xFF);
}
