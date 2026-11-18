use super::*;
use crate::normalize::{ResolvedPath, ResolvedPolicy};
use crate::policy::Degraded;
use std::path::PathBuf;
use std::time::Duration;

fn grant(path: &str, is_dir: bool) -> ResolvedPath {
    ResolvedPath {
        requested: path.into(),
        path: path.into(),
        is_dir,
    }
}

fn policy(network: NetworkPolicy) -> ResolvedPolicy {
    ResolvedPolicy {
        ro: vec![grant("/Users/me/work", true)],
        rw: vec![grant("/private/tmp/scratch", true)],
        network,
        env: vec![],
        cwd: PathBuf::from("/Users/me/work"),
        timeout: Duration::from_secs(1),
        output_cap: 1,
        kill_grace: Duration::ZERO,
        degraded: Degraded::default(),
    }
}

#[test]
fn the_profile_is_closed_by_default_and_declares_a_version_first() {
    let p = build(&policy(NetworkPolicy::Off));
    assert!(p.text.contains("(version 1)"));
    let version = p.text.find("(version 1)").unwrap();
    let deny = p.text.find("(deny default)").unwrap();
    let first_allow = p.text.find("(allow ").unwrap();
    assert!(
        version < deny && deny < first_allow,
        "version, then deny default, then allows"
    );
}

#[test]
fn grants_are_parameters_not_text() {
    // Hostile path characters can never reach the profile text, because only parameter
    // names do.
    let mut pol = policy(NetworkPolicy::Off);
    pol.ro = vec![grant("/Users/me/we\"ird) (allow default)", true)];
    let p = build(&pol);
    assert!(!p.text.contains("we\"ird"));
    assert!(
        !p.text.contains("allow default)\n"),
        "the injected rule must not appear"
    );
    assert!(p.params.contains(&(
        "RO_0".to_owned(),
        "/Users/me/we\"ird) (allow default)".to_owned()
    )));
    assert!(p.text.contains(r#"(subpath (param "RO_0"))"#));
}

#[test]
fn read_only_grants_cannot_write_and_read_write_grants_can() {
    let p = build(&policy(NetworkPolicy::Off));
    let read_only_line = p
        .text
        .lines()
        .find(|l| l.contains(r#"(param "RO_0")"#))
        .unwrap();
    let read_write_line = p
        .text
        .lines()
        .find(|l| l.contains(r#"(param "RW_0")"#))
        .unwrap();
    assert!(read_only_line.contains("file-read*") && !read_only_line.contains("file-write"));
    assert!(read_write_line.contains("file-read*") && read_write_line.contains("file-write*"));
    // No unconditional write or read grant anywhere else outside the base devices.
    assert!(!p.text.contains("(allow file-write*)"));
    assert!(!p.text.contains("(allow file-read*)"));
}

#[test]
fn network_off_allows_no_network_rules_beyond_syslog() {
    let p = build(&policy(NetworkPolicy::Off));
    assert!(!p.text.contains("(allow network*)"));
    assert!(!p.text.contains("localhost"));
    let outbound: Vec<&str> = p
        .text
        .lines()
        .filter(|l| l.starts_with("(allow network"))
        .collect();
    // The only network rule is the one-literal syslog socket in the platform defaults.
    assert_eq!(
        outbound,
        [r#"(allow network-outbound (literal "/private/var/run/syslog"))"#]
    );
}

#[test]
fn loopback_allows_only_localhost() {
    let p = build(&policy(NetworkPolicy::Loopback));
    assert!(
        p.text
            .contains(r#"(allow network-outbound (remote ip "localhost:*"))"#)
    );
    assert!(
        p.text
            .contains(r#"(allow network-bind (local ip "localhost:*"))"#)
    );
    assert!(!p.text.contains("(allow network*)"));
}

#[test]
fn network_on_allows_everything() {
    let p = build(&policy(NetworkPolicy::On));
    assert!(p.text.contains("(allow network*)"));
}

#[test]
fn exec_args_put_the_program_after_double_dash() {
    let p = build(&policy(NetworkPolicy::Off));
    let args = p.exec_args(
        Path::new("/usr/bin/python3"),
        &["-c".into(), "print(1)".into()],
    );
    assert_eq!(args[0], "-p");
    assert!(args.iter().any(|a| a == "-DRO_0=/Users/me/work"));
    assert!(args.iter().any(|a| a == "-DRW_0=/private/tmp/scratch"));
    let dd = args.iter().position(|a| a == "--").unwrap();
    assert_eq!(&args[dd + 1..], ["/usr/bin/python3", "-c", "print(1)"]);
    // Every -D comes before the separator.
    assert!(
        args.iter()
            .enumerate()
            .filter(|(_, a)| a.to_string_lossy().starts_with("-D"))
            .all(|(i, _)| i < dd)
    );
}

/// Counts parentheses outside strings and `;` comments.
fn depth_after(text: &str) -> Option<i64> {
    let mut depth = 0i64;
    for line in text.lines() {
        let mut in_str = false;
        let mut prev = ' ';
        for c in line.chars() {
            match c {
                '"' if prev != '\\' => in_str = !in_str,
                ';' if !in_str => break,
                '(' if !in_str => depth += 1,
                ')' if !in_str => {
                    depth -= 1;
                    if depth < 0 {
                        return None;
                    }
                }
                _ => {}
            }
            prev = c;
        }
        if in_str {
            return None; // a string must not span lines
        }
    }
    Some(depth)
}

#[test]
fn every_variant_is_balanced() {
    for net in [
        NetworkPolicy::Off,
        NetworkPolicy::Loopback,
        NetworkPolicy::On,
    ] {
        let p = build(&policy(net.clone()));
        assert_eq!(depth_after(&p.text), Some(0), "{net:?}");
    }
    assert_eq!(depth_after("(a (b)"), Some(1));
    assert_eq!(depth_after("(a))"), None);
}
