use super::*;
use proptest::prelude::*;
use std::fs;
use std::os::unix::fs::symlink;

fn lookup_none(_: &OsStr) -> Option<OsString> {
    None
}

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn base(cwd: &Path) -> SandboxPolicy {
    SandboxPolicy::new(cwd)
}

#[test]
fn relative_and_missing_paths_are_rejected() {
    let t = tmp();
    let mut p = base(t.path()).with_ro([t.path()]);
    p.rw_paths.push(PathBuf::from("relative/dir"));
    assert!(
        matches!(p.resolve_with_env(&lookup_none), Err(Error::InvalidPolicy(m)) if m.contains("not absolute"))
    );
    p.rw_paths = vec![t.path().join("nope")];
    assert!(
        matches!(p.resolve_with_env(&lookup_none), Err(Error::InvalidPolicy(m)) if m.contains("cannot be resolved"))
    );
}

#[test]
fn ro_inside_rw_is_rejected_but_rw_inside_ro_is_kept() {
    let t = tmp();
    let work = t.path().join("work");
    let target = work.join("target");
    fs::create_dir_all(&target).unwrap();

    let bad = base(&work).with_rw([&work]).with_ro([&target]);
    let err = bad.resolve_with_env(&lookup_none).unwrap_err();
    assert!(err.to_string().contains("lies inside writable"), "{err}");

    let good = base(&work).with_ro([&work]).with_rw([&target]);
    let r = good.resolve_with_env(&lookup_none).unwrap();
    assert_eq!(r.ro.len(), 1);
    assert_eq!(r.rw.len(), 1);
    assert!(
        r.is_writable(
            &fs::canonicalize(target.join("x.o"))
                .unwrap_or_else(|_| fs::canonicalize(&target).unwrap().join("x.o"))
        )
    );
    assert!(!r.is_writable(&fs::canonicalize(&work).unwrap()));
}

#[test]
fn same_path_in_both_lists_is_writable_once() {
    let t = tmp();
    let r = base(t.path())
        .with_ro([t.path()])
        .with_rw([t.path()])
        .resolve_with_env(&lookup_none)
        .unwrap();
    assert!(r.ro.is_empty());
    assert_eq!(r.rw.len(), 1);
}

#[test]
fn redundant_children_are_dropped() {
    let t = tmp();
    let a = t.path().join("a");
    let ab = a.join("b");
    fs::create_dir_all(&ab).unwrap();
    let r = base(&a)
        .with_ro([&a, &ab, &a])
        .resolve_with_env(&lookup_none)
        .unwrap();
    assert_eq!(r.ro.len(), 1);
    assert_eq!(r.ro[0].path, fs::canonicalize(&a).unwrap());
}

#[test]
fn filesystem_root_is_never_writable() {
    let t = tmp();
    let err = base(t.path())
        .with_ro([t.path()])
        .with_rw(["/"])
        .resolve_with_env(&lookup_none)
        .unwrap_err();
    assert!(err.to_string().contains("root"), "{err}");
}

#[test]
fn cwd_must_be_inside_a_grant_and_a_directory() {
    let t = tmp();
    let other = tmp();
    let err = base(other.path())
        .with_ro([t.path()])
        .resolve_with_env(&lookup_none)
        .unwrap_err();
    assert!(err.to_string().contains("not inside"), "{err}");
    let file = t.path().join("f");
    fs::write(&file, b"x").unwrap();
    let err = base(&file)
        .with_ro([t.path()])
        .resolve_with_env(&lookup_none)
        .unwrap_err();
    assert!(err.to_string().contains("not a directory"), "{err}");
}

#[test]
fn limits_are_validated() {
    let t = tmp();
    let ok = base(t.path()).with_ro([t.path()]);
    for mutate in [
        (|p: &mut SandboxPolicy| p.timeout_ms = 0) as fn(&mut SandboxPolicy),
        |p| p.timeout_ms = limits::MAX_TIMEOUT_MS + 1,
        |p| p.output_cap_bytes = 0,
        |p| p.output_cap_bytes = limits::MAX_OUTPUT_CAP_BYTES + 1,
        |p| p.kill_grace_ms = limits::MAX_KILL_GRACE_MS + 1,
    ] {
        let mut p = ok.clone();
        mutate(&mut p);
        assert!(matches!(
            p.resolve_with_env(&lookup_none),
            Err(Error::InvalidPolicy(_))
        ));
    }
}

#[test]
fn env_is_allowlist_plus_set_and_set_wins() {
    let t = tmp();
    let mut p = base(t.path())
        .with_ro([t.path()])
        .with_env("PATH", "/custom")
        .with_env("X", "1");
    p.env_allowlist = vec!["PATH".into(), "HOME".into(), "MISSING".into()];
    let parent = |n: &OsStr| match n.to_str().unwrap() {
        "PATH" => Some(OsString::from("/usr/bin")),
        "HOME" => Some(OsString::from("/root")),
        "SECRET_KEY" => Some(OsString::from("hunter2")),
        _ => None,
    };
    let r = p.resolve_with_env(&parent).unwrap();
    let get = |k: &str| {
        r.env
            .iter()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.to_str().unwrap().to_owned())
    };
    assert_eq!(get("PATH").as_deref(), Some("/custom"));
    assert_eq!(get("HOME").as_deref(), Some("/root"));
    assert_eq!(get("X").as_deref(), Some("1"));
    assert_eq!(get("SECRET_KEY"), None);
    assert_eq!(get("MISSING"), None);
    assert_eq!(r.env.len(), 3);
}

#[test]
fn bad_env_names_are_rejected() {
    let t = tmp();
    for bad in ["", "A=B", "A\0B"] {
        let mut p = base(t.path()).with_ro([t.path()]);
        p.env_allowlist = vec![bad.to_owned()];
        assert!(p.resolve_with_env(&lookup_none).is_err(), "{bad:?}");
    }
    let p = base(t.path()).with_ro([t.path()]).with_env("A", "x\0y");
    assert!(p.resolve_with_env(&lookup_none).is_err());
}

#[test]
fn allowlist_normalisation() {
    let n = |hosts: &[&str]| {
        normalize_network(&NetworkPolicy::Allowlist(
            hosts.iter().map(|s| (*s).to_owned()).collect(),
        ))
    };
    assert_eq!(n(&[]).unwrap(), NetworkPolicy::Off);
    assert_eq!(
        n(&["localhost", "127.0.0.1", "[::1]"]).unwrap(),
        NetworkPolicy::Loopback
    );
    assert_eq!(
        n(&["PyPI.org", "pypi.org", "files.pythonhosted.org"]).unwrap(),
        NetworkPolicy::Allowlist(vec!["files.pythonhosted.org".into(), "pypi.org".into()])
    );
    assert_eq!(
        n(&["localhost", "pypi.org"]).unwrap(),
        NetworkPolicy::Allowlist(vec!["localhost".into(), "pypi.org".into()])
    );
    for bad in [
        "https://x.org",
        "x.org/path",
        "*.x.org",
        "x.org:443",
        "",
        "-x.org",
        "a b",
    ] {
        assert!(n(&[bad]).is_err(), "{bad:?} should be rejected");
    }
}

#[test]
fn simple_network_modes_pass_through() {
    for m in [
        NetworkPolicy::Off,
        NetworkPolicy::Loopback,
        NetworkPolicy::On,
    ] {
        assert_eq!(normalize_network(&m).unwrap(), m);
    }
}

#[test]
fn verbatim_prefix_stripping() {
    assert_eq!(simplify_verbatim_str(r"\\?\C:\work\x"), r"C:\work\x");
    assert_eq!(
        simplify_verbatim_str(r"\\?\UNC\srv\share\x"),
        r"\\srv\share\x"
    );
    assert_eq!(
        simplify_verbatim_str(r"\\?\Volume{1234}\x"),
        r"\\?\Volume{1234}\x"
    );
    assert_eq!(simplify_verbatim_str(r"C:\plain"), r"C:\plain");
}

#[test]
fn symlinked_policy_path_resolves_to_its_target() {
    let t = tmp();
    let real = t.path().join("real");
    let secret = t.path().join("secret");
    fs::create_dir_all(&real).unwrap();
    fs::create_dir_all(&secret).unwrap();
    symlink(&secret, real.join("escape")).unwrap();
    let r = base(&real)
        .with_ro([&real])
        .with_rw([real.join("escape")])
        .resolve_with_env(&lookup_none)
        .unwrap();
    // The grant is on the target, and the caller can see that and refuse it.
    assert_eq!(r.rw[0].path, fs::canonicalize(&secret).unwrap());
    assert!(r.ensure_rw_within(std::slice::from_ref(&real)).is_err());
    assert!(r.ensure_rw_within(&[t.path().to_path_buf()]).is_ok());
}

// --- property tests -------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Hop {
    Dir(u8),
    Link(u8),
    Up,
    Cur,
}

fn hop() -> impl Strategy<Value = Hop> {
    prop_oneof![
        (0u8..3).prop_map(Hop::Dir),
        (0u8..3).prop_map(Hop::Link),
        Just(Hop::Up),
        Just(Hop::Cur),
    ]
}

/// Builds `root/d0..d2` (each with child dirs `d0..d2`) and links `l0..l2` in `root`, where
/// `l{i}` points alternately to an absolute path, a relative one and a `..` chain.
fn make_tree(root: &Path) {
    for i in 0..3 {
        for j in 0..3 {
            fs::create_dir_all(root.join(format!("d{i}/d{j}"))).unwrap();
        }
    }
    symlink(root.join("d1"), root.join("l0")).unwrap();
    symlink("d2/d0", root.join("l1")).unwrap();
    symlink("d0/../d1/d2", root.join("l2")).unwrap();
    // Links that live deeper and climb back out.
    symlink("../l0", root.join("d0/d1/up")).ok();
}

fn spell(root: &Path, hops: &[Hop]) -> PathBuf {
    let mut p = root.to_path_buf();
    for h in hops {
        match h {
            Hop::Dir(i) => p.push(format!("d{i}")),
            Hop::Link(i) => p.push(format!("l{i}")),
            Hop::Up => p.push(".."),
            Hop::Cur => p.push("."),
        }
    }
    p
}

fn has_symlink_component(path: &Path) -> bool {
    let mut cur = PathBuf::new();
    path.components().any(|c| {
        cur.push(c);
        fs::symlink_metadata(&cur).is_ok_and(|m| m.file_type().is_symlink())
    })
}

proptest! {
    #[test]
    fn resolved_paths_are_canonical_and_idempotent(hops in proptest::collection::vec(hop(), 1..7)) {
        let t = tmp();
        let root = fs::canonicalize(t.path()).unwrap();
        make_tree(&root);
        let spelled = spell(&root, &hops);
        prop_assume!(fs::canonicalize(&spelled).is_ok_and(|c| c.is_dir()));

        let policy = base(&root).with_ro([&root]).with_rw([&spelled]);
        let first = policy.resolve_with_env(&lookup_none);
        // Either the combination is rejected as ro-inside-rw, or the result is canonical.
        if let Ok(r) = first {
            for g in r.ro.iter().chain(&r.rw) {
                prop_assert!(g.path.is_absolute());
                prop_assert!(!g.path.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir)));
                prop_assert!(!has_symlink_component(&g.path), "{:?}", g.path);
                prop_assert_eq!(&g.path, &fs::canonicalize(&g.requested).unwrap());
            }
            // Resolving the resolved paths again changes nothing.
            let again = base(&root)
                .with_ro(r.ro.iter().map(|g| g.path.clone()))
                .with_rw(r.rw.iter().map(|g| g.path.clone()))
                .resolve_with_env(&lookup_none)
                .unwrap();
            prop_assert_eq!(
                again.rw.iter().map(|g| &g.path).collect::<Vec<_>>(),
                r.rw.iter().map(|g| &g.path).collect::<Vec<_>>()
            );
            // Containment is decided on real locations: a spelling that wanders through links
            // is inside `root` only if its target is.
            prop_assert!(r.ensure_rw_within(std::slice::from_ref(&root)).is_ok());
        }
    }

    #[test]
    fn a_symlink_never_widens_the_grant(link_to in 0u8..3, sub in 0u8..3) {
        // rw = root/scratch, which holds a link to root/d{link_to}. The resolved grant stays
        // root/scratch: links inside a grant are not followed into new grants at policy time.
        let t = tmp();
        let root = fs::canonicalize(t.path()).unwrap();
        make_tree(&root);
        let scratch = root.join("scratch");
        fs::create_dir(&scratch).unwrap();
        symlink(root.join(format!("d{link_to}")), scratch.join("out")).unwrap();
        let r = base(&root).with_ro([&root]).with_rw([scratch.join(format!("../scratch/./{}", if sub == 0 { "" } else { "." }))])
            .resolve_with_env(&lookup_none)
            .unwrap();
        prop_assert_eq!(r.rw.len(), 1);
        prop_assert_eq!(&r.rw[0].path, &scratch);
    }
}
