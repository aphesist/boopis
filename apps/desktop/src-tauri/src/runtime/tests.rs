//! Unpacking the runtime: refused on a hash mismatch, switched atomically, idempotent, cleaned up. The archives here are
//! tiny but real `.tar.zst` files made with the same crates the host reads them with.

use super::*;

const HERMES: &str = "bin/hermes";
const PYTHON: &str = "tools/python-3.14.9-linux-x64/bin/python3";

fn tar_zst(files: &[(&str, &[u8], u32)]) -> Vec<u8> {
    let mut tar = tar::Builder::new(Vec::new());
    for (path, body, mode) in files {
        let mut h = tar::Header::new_gnu();
        h.set_size(body.len() as u64);
        h.set_mode(*mode);
        h.set_mtime(0);
        tar.append_data(&mut h, path, *body).unwrap();
    }
    // a symlink, as the interpreter's `python3 -> python3.14`
    let mut h = tar::Header::new_gnu();
    h.set_entry_type(tar::EntryType::Symlink);
    h.set_size(0);
    h.set_mode(0o777);
    tar.append_link(&mut h, "tools/link", "bin/hermes").unwrap();
    zstd::encode_all(tar.into_inner().unwrap().as_slice(), 3).unwrap()
}

pub(crate) fn standard(version: &str) -> Vec<u8> {
    tar_zst(&[
        (
            HERMES,
            format!("#!/bin/sh\necho {version}\n").as_bytes(),
            0o755,
        ),
        (PYTHON, b"py", 0o755),
        ("manifest.json", b"{}", 0o644),
    ])
}

/// A directory holding `runtime.json` and the archive `bytes`, whose manifest names `claimed_sha` (the real hash when `None`).
pub(crate) fn bundle(
    dir: &Path,
    version: &str,
    bytes: &[u8],
    claimed_sha: Option<&str>,
) -> Runtime {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("rt.tar.zst"), bytes).unwrap();
    let sha = claimed_sha.map_or_else(|| hex::encode(Sha256::digest(bytes)), str::to_owned);
    let manifest = Manifest {
        schema: SCHEMA,
        hermes_version: version.into(),
        python_version: "3.14.9".into(),
        target: "linux-x64".into(),
        hermes: HERMES.into(),
        python: PYTHON.into(),
        archive: Archive {
            name: "rt.tar.zst".into(),
            sha256: sha,
            size: bytes.len() as u64,
        },
        unpacked_size: 1_000_000,
    };
    std::fs::write(
        dir.join(MANIFEST_FILE),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    Runtime::read(dir).unwrap()
}

fn install(rt: &Runtime, runtimes: &Path) -> Result<(Layout, Outcome)> {
    rt.install(runtimes, &mut |_| {})
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn unpacks_into_a_directory_named_by_version_and_hash() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &standard("a"), None);
    let runtimes = tmp.path().join("data/runtime");
    let (layout, outcome) = install(&rt, &runtimes).unwrap();
    assert_eq!(outcome, Outcome::Unpacked);
    let id = rt.manifest().id();
    assert!(
        id.starts_with("0.23.2-") && id.len() == "0.23.2-".len() + 8,
        "{id}"
    );
    assert_eq!(layout.root, runtimes.join(&id));
    assert!(layout.hermes.is_file() && layout.python.is_file());
    assert!(rt.is_installed(&runtimes));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&layout.hermes)
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111, "the launcher stays executable");
        assert!(
            std::fs::symlink_metadata(layout.root.join("tools/link"))
                .unwrap()
                .is_symlink()
        );
    }
    assert_eq!(
        names(&runtimes),
        vec![".lock".to_owned(), id],
        "no temporary directory is left"
    );
}

#[test]
fn a_hash_mismatch_is_refused_and_installs_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let wrong = "0".repeat(64);
    let rt = bundle(
        &tmp.path().join("res"),
        "0.23.2",
        &standard("a"),
        Some(&wrong),
    );
    let runtimes = tmp.path().join("runtime");
    let err = install(&rt, &runtimes).unwrap_err();
    assert_eq!(err.code(), "hx.setup.runtime_hash_mismatch");
    assert!(err.to_string().contains("nothing was installed"), "{err}");
    assert_eq!(
        names(&runtimes),
        vec![".lock".to_owned()],
        "neither the final nor a temporary directory"
    );
    assert!(!rt.is_installed(&runtimes));
}

#[test]
fn a_tampered_archive_of_the_right_size_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let good = standard("a");
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &good, None);
    let mut bad = good.clone();
    let last = bad.len() - 1;
    bad[last] ^= 0xff; // same size, different bytes: the size check passes, the hash does not
    std::fs::write(tmp.path().join("res/rt.tar.zst"), &bad).unwrap();
    let runtimes = tmp.path().join("runtime");
    let err = install(&rt, &runtimes).unwrap_err();
    assert!(
        matches!(
            err.code(),
            "hx.setup.runtime_hash_mismatch" | "hx.setup.runtime_corrupt"
        ),
        "{err}"
    );
    assert_eq!(names(&runtimes), vec![".lock".to_owned()]);
}

#[test]
fn a_missing_or_resized_archive_says_so() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &standard("a"), None);
    let runtimes = tmp.path().join("runtime");
    std::fs::write(tmp.path().join("res/rt.tar.zst"), b"short").unwrap();
    assert_eq!(
        install(&rt, &runtimes).unwrap_err().code(),
        "hx.setup.runtime_missing"
    );
    std::fs::remove_file(tmp.path().join("res/rt.tar.zst")).unwrap();
    let err = install(&rt, &runtimes).unwrap_err();
    assert_eq!(err.code(), "hx.setup.runtime_missing");
    assert!(err.to_string().contains("reinstall the app"));
}

#[test]
fn running_it_again_changes_nothing_and_does_not_read_the_archive() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &standard("a"), None);
    let runtimes = tmp.path().join("runtime");
    let (layout, _) = install(&rt, &runtimes).unwrap();
    let marker = layout.root.join(MARKER_FILE);
    let before = std::fs::metadata(&marker).unwrap().modified().unwrap();
    std::fs::remove_file(tmp.path().join("res/rt.tar.zst")).unwrap(); // a second unpack could not even start
    let (again, outcome) = install(&rt, &runtimes).unwrap();
    assert_eq!((again, outcome), (layout, Outcome::Current));
    assert_eq!(
        std::fs::metadata(&marker).unwrap().modified().unwrap(),
        before
    );
}

#[test]
fn an_unfinished_unpack_is_not_an_install_and_is_cleared_on_the_next_run() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &standard("a"), None);
    let runtimes = tmp.path().join("runtime");
    let id = rt.manifest().id();
    // what a crash leaves: a temporary directory, and a final directory with files but no marker
    std::fs::create_dir_all(runtimes.join(format!("{TMP_PREFIX}{id}-1/half"))).unwrap();
    std::fs::create_dir_all(runtimes.join(&id).join("bin")).unwrap();
    std::fs::write(runtimes.join(&id).join(HERMES), "stale").unwrap();
    assert!(!rt.is_installed(&runtimes), "no marker, no install");
    let (layout, outcome) = install(&rt, &runtimes).unwrap();
    assert_eq!(outcome, Outcome::Unpacked);
    assert_ne!(std::fs::read_to_string(&layout.hermes).unwrap(), "stale");
    assert_eq!(names(&runtimes), vec![".lock".to_owned(), id]);
}

#[test]
fn old_versions_are_removed_only_after_the_new_one_is_in_place_and_only_ours() {
    let tmp = tempfile::tempdir().unwrap();
    let runtimes = tmp.path().join("runtime");
    let v1 = bundle(&tmp.path().join("r1"), "0.23.2", &standard("one"), None);
    let v2 = bundle(&tmp.path().join("r2"), "0.24.0", &standard("two"), None);
    let (old, _) = install(&v1, &runtimes).unwrap();
    let (new, _) = install(&v2, &runtimes).unwrap();
    assert!(
        old.root.is_dir() && new.root.is_dir(),
        "installing never removes the old one"
    );
    std::fs::create_dir_all(runtimes.join("something-else")).unwrap(); // not ours: no marker
    std::fs::create_dir_all(runtimes.join(format!("{TMP_PREFIX}abandoned"))).unwrap();
    let removed = remove_old(&runtimes, &new.root);
    assert_eq!(removed.len(), 2, "{removed:?}");
    assert!(!old.root.exists() && new.root.is_dir());
    assert!(
        runtimes.join("something-else").is_dir(),
        "a directory without our marker is left alone"
    );
    assert!(
        remove_old(&runtimes, &new.root).is_empty(),
        "nothing more to remove"
    );
}

#[test]
fn an_entry_outside_the_root_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    // `tar::Builder` will not write a `..` path, so the header is filled in by hand
    let mut header = tar::Header::new_gnu();
    header.as_old_mut().name[..9].copy_from_slice(b"../escape");
    header.set_size(1);
    header.set_mode(0o644);
    header.set_cksum();
    let mut raw = header.as_bytes().to_vec();
    raw.extend_from_slice(&[b'x'; 1]);
    raw.resize(raw.len() + 511, 0);
    raw.extend_from_slice(&[0; 1024]);
    let bytes = zstd::encode_all(raw.as_slice(), 3).unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &bytes, None);
    let runtimes = tmp.path().join("runtime");
    let err = install(&rt, &runtimes).unwrap_err();
    assert_eq!(err.code(), "hx.setup.runtime_corrupt", "{err}");
    assert!(!tmp.path().join("escape").exists());
    assert_eq!(names(&runtimes), vec![".lock".to_owned()]);
}

#[test]
fn an_archive_without_the_launcher_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let bytes = tar_zst(&[("manifest.json", b"{}", 0o644)]);
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &bytes, None);
    let runtimes = tmp.path().join("runtime");
    assert_eq!(
        install(&rt, &runtimes).unwrap_err().code(),
        "hx.setup.runtime_corrupt"
    );
    assert_eq!(names(&runtimes), vec![".lock".to_owned()]);
}

#[test]
fn progress_reaches_one_hundred_percent() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &standard("a"), None);
    let mut seen = Vec::new();
    rt.install(&tmp.path().join("runtime"), &mut |p| seen.push(p.percent()))
        .unwrap();
    assert_eq!(seen.last(), Some(&100));
    assert!(seen.windows(2).all(|w| w[0] <= w[1]), "{seen:?}");
}

#[test]
fn the_manifest_is_validated() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &standard("a"), None);
    let ok = rt.manifest().clone();
    let mutate = |f: &dyn Fn(&mut Manifest)| {
        let mut m = ok.clone();
        f(&mut m);
        m.validate().unwrap_err()
    };
    for e in [
        mutate(&|m| m.schema = 2),
        mutate(&|m| m.hermes_version = "../x".into()),
        mutate(&|m| m.hermes_version = String::new()),
        mutate(&|m| m.archive.sha256 = "ABC".into()),
        mutate(&|m| m.archive.name = "../rt.tar.zst".into()),
        mutate(&|m| m.archive.name = "a/b.tar.zst".into()),
        mutate(&|m| m.hermes = "/bin/hermes".into()),
        mutate(&|m| m.python = "tools/../../python3".into()),
    ] {
        assert_eq!(e.code(), "hx.setup.runtime_manifest_invalid");
    }
    assert!(
        Runtime::locate(Some(tmp.path())).unwrap().is_none(),
        "no runtime directory: this build carries none"
    );
    std::fs::write(tmp.path().join("res/runtime.json"), "{").unwrap();
    assert!(Runtime::read(&tmp.path().join("res")).is_err());
    let located = tmp.path().join("app");
    std::fs::create_dir_all(located.join("runtime")).unwrap();
    std::fs::write(located.join("runtime/runtime.json"), "{").unwrap();
    assert!(
        Runtime::locate(Some(&located)).is_err(),
        "a broken manifest is an error, not an absent runtime"
    );
}

#[test]
fn the_source_is_the_bundle_unless_asked_otherwise() {
    assert_eq!(Source::resolve(None, None), Source::Bundled);
    assert_eq!(Source::resolve(None, Some("existing")), Source::Existing);
    assert_eq!(
        Source::resolve(Some("Bundled"), Some("existing")),
        Source::Bundled,
        "the environment wins"
    );
    assert_eq!(
        Source::resolve(Some("nonsense"), Some("existing")),
        Source::Existing
    );
    assert_eq!(Source::resolve(Some(""), Some("nonsense")), Source::Bundled);
}

#[test]
fn a_build_that_carries_a_runtime_uses_it_unless_the_user_chose_their_own_hermes() {
    // This is what a packaged app (an AppImage) is: the runtime is in the resource directory. The release smoke runs
    // such an app against an e2e Hermes, so it must say `existing`, or the host unpacks the bundle and ignores it.
    let tmp = tempfile::tempdir().unwrap();
    let res = tmp.path().join("res");
    bundle(&res.join("runtime"), "0.23.2", &standard("0.23.2"), None);
    let data = || Ok(tmp.path().join("data"));

    let (plan, error) = plan_for(Source::Bundled, Some(&res), data());
    assert!(
        plan.is_some() && error.is_none(),
        "the carried runtime is the default"
    );

    let (plan, error) = plan_for(Source::Existing, Some(&res), data());
    assert!(
        plan.is_none() && error.is_none(),
        "HYPOTAXIS_HERMES=existing leaves the runtime alone"
    );

    let (plan, error) = plan_for(Source::Bundled, Some(&tmp.path().join("none")), data());
    assert!(
        plan.is_none() && error.is_none(),
        "a build without one uses the Hermes on the machine"
    );
}
