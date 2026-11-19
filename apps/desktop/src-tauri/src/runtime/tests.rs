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

/// A manifest for an archive of `size` bytes with this hash.
pub(crate) fn manifest_for(version: &str, sha256: String, size: u64) -> Manifest {
    Manifest {
        schema: SCHEMA,
        hermes_version: version.into(),
        python_version: "3.14.9".into(),
        target: "linux-x64".into(),
        hermes: HERMES.into(),
        python: PYTHON.into(),
        archive: Archive {
            name: "rt.tar.zst".into(),
            sha256,
            size,
        },
        unpacked_size: 1_000_000,
        entries: 0,
    }
}

/// A directory holding `runtime.json` and the archive `bytes`, whose manifest names `claimed_sha` (the real hash when `None`).
pub(crate) fn bundle(
    dir: &Path,
    version: &str,
    bytes: &[u8],
    claimed_sha: Option<&str>,
) -> Runtime {
    bundle_with(dir, version, bytes, claimed_sha, |_| {})
}

/// [`bundle`], letting `adjust` change the manifest (its recorded size or entry count).
fn bundle_with(
    dir: &Path,
    version: &str,
    bytes: &[u8],
    claimed_sha: Option<&str>,
    adjust: impl FnOnce(&mut Manifest),
) -> Runtime {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("rt.tar.zst"), bytes).unwrap();
    let sha = claimed_sha.map_or_else(|| hex::encode(Sha256::digest(bytes)), str::to_owned);
    let mut manifest = manifest_for(version, sha, bytes.len() as u64);
    adjust(&mut manifest);
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
    rt.install(&tmp.path().join("runtime"), &mut |p| seen.push(p))
        .unwrap();
    for phase in [Pass::Verify, Pass::Unpack] {
        let of: Vec<u8> = seen
            .iter()
            .filter(|p| p.phase == phase)
            .map(|p| p.percent())
            .collect();
        assert_eq!(of.last(), Some(&100), "{phase:?}: {of:?}");
        assert!(of.windows(2).all(|w| w[0] < w[1]), "{phase:?}: {of:?}");
    }
}

#[test]
fn progress_names_the_pass_and_counts_bytes_of_the_manifests_size() {
    let tmp = tempfile::tempdir().unwrap();
    let bytes = standard("a");
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &bytes, None);
    let mut seen = Vec::new();
    rt.install(&tmp.path().join("runtime"), &mut |p| seen.push(p))
        .unwrap();
    let total = rt.manifest().archive.size;
    assert_eq!(total, bytes.len() as u64);
    assert!(
        seen.iter().all(|p| p.total == total && p.read <= total),
        "{seen:?}"
    );
    // the archive is hashed before it is opened, so every Verify report comes before the first Unpack one
    let first_unpack = seen.iter().position(|p| p.phase == Pass::Unpack).unwrap();
    assert!(seen[..first_unpack].iter().all(|p| p.phase == Pass::Verify));
    assert!(seen[first_unpack..].iter().all(|p| p.phase == Pass::Unpack));
    assert_eq!(
        seen[first_unpack - 1].read,
        total,
        "verification ends at the whole archive"
    );
}

#[test]
fn a_runtime_that_is_already_unpacked_reports_no_progress() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &standard("a"), None);
    let runtimes = tmp.path().join("runtime");
    rt.install(&runtimes, &mut |_| {}).unwrap();
    let mut seen = 0;
    let (_, outcome) = rt.install(&runtimes, &mut |_| seen += 1).unwrap();
    assert_eq!((outcome, seen), (Outcome::Current, 0));
}

#[test]
fn a_hash_mismatch_is_reported_as_verifying_and_never_as_unpacking() {
    let tmp = tempfile::tempdir().unwrap();
    let rt = bundle(
        &tmp.path().join("res"),
        "0.23.2",
        &standard("a"),
        Some(&"f".repeat(64)),
    );
    let mut seen = Vec::new();
    let e = rt
        .install(&tmp.path().join("runtime"), &mut |p| seen.push(p))
        .unwrap_err();
    assert_eq!(e.code(), "hx.setup.runtime_hash_mismatch");
    assert!(!seen.is_empty() && seen.iter().all(|p| p.phase == Pass::Verify));
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
        mutate(&|m| m.unpacked_size = 0),
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

/// A runtime's launchers plus whatever `extra` appends to the tar, as a `.tar.zst`.
fn tar_zst_plus(extra: impl FnOnce(&mut tar::Builder<Vec<u8>>)) -> Vec<u8> {
    let mut tar = tar::Builder::new(Vec::new());
    for (path, body) in [(HERMES, &b"#!/bin/sh\n"[..]), (PYTHON, b"py")] {
        let mut h = tar::Header::new_gnu();
        h.set_size(body.len() as u64);
        h.set_mode(0o755);
        h.set_mtime(0);
        tar.append_data(&mut h, path, body).unwrap();
    }
    extra(&mut tar);
    zstd::encode_all(tar.into_inner().unwrap().as_slice(), 3).unwrap()
}

fn append(
    tar: &mut tar::Builder<Vec<u8>>,
    path: &str,
    kind: tar::EntryType,
    mode: u32,
    body: &[u8],
) {
    let mut h = tar::Header::new_gnu();
    h.set_entry_type(kind);
    h.set_size(body.len() as u64);
    h.set_mode(mode);
    h.set_mtime(0);
    tar.append_data(&mut h, path, body).unwrap();
}

#[test]
fn the_hash_is_checked_before_anything_is_extracted() {
    // The archive holds a FIFO, which the extraction step refuses with `runtime_corrupt`. With a wrong hash the error is
    // the hash's, and no unpack progress was ever reported: the tar was never opened. With the right hash it is the FIFO's.
    let tmp = tempfile::tempdir().unwrap();
    let bytes = tar_zst_plus(|t| append(t, "pipe", tar::EntryType::Fifo, 0o644, b""));
    let runtimes = tmp.path().join("runtime");
    let wrong = "1".repeat(64);
    let rt = bundle(&tmp.path().join("bad"), "0.23.2", &bytes, Some(&wrong));
    let mut unpacked = 0;
    let err = rt
        .install(&runtimes, &mut |p| {
            unpacked += usize::from(p.phase == Pass::Unpack);
        })
        .unwrap_err();
    assert_eq!(err.code(), "hx.setup.runtime_hash_mismatch", "{err}");
    assert_eq!(unpacked, 0, "nothing was read as a tar");
    assert_eq!(names(&runtimes), vec![".lock".to_owned()]);

    let rt = bundle(&tmp.path().join("good"), "0.23.2", &bytes, None);
    assert_eq!(
        install(&rt, &runtimes).unwrap_err().code(),
        "hx.setup.runtime_corrupt"
    );
}

#[test]
fn an_unpack_past_the_manifests_size_is_refused_before_it_is_written() {
    let tmp = tempfile::tempdir().unwrap();
    // 20 MB of zeros compress to almost nothing; the manifest allows 1 MB plus the 16 MB margin.
    let bytes = tar_zst_plus(|t| {
        append(
            t,
            "big.bin",
            tar::EntryType::Regular,
            0o644,
            &vec![0u8; 20_000_000],
        );
    });
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &bytes, None);
    let runtimes = tmp.path().join("runtime");
    let err = install(&rt, &runtimes).unwrap_err();
    assert_eq!(err.code(), "hx.setup.runtime_corrupt", "{err}");
    assert!(err.to_string().contains("MB its manifest allows"), "{err}");
    assert_eq!(
        names(&runtimes),
        vec![".lock".to_owned()],
        "nothing is left"
    );

    // The same archive inside a manifest that records its size is fine.
    let rt = bundle_with(&tmp.path().join("ok"), "0.23.2", &bytes, None, |m| {
        m.unpacked_size = 20_000_000;
    });
    install(&rt, &runtimes).unwrap();
}

#[test]
fn an_unpack_with_more_entries_than_the_manifest_records_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let bytes = tar_zst_plus(|t| {
        for i in 0..200 {
            append(t, &format!("spam/{i}"), tar::EntryType::Regular, 0o644, b"");
        }
    });
    let rt = bundle_with(&tmp.path().join("res"), "0.23.2", &bytes, None, |m| {
        m.entries = 10;
    });
    let runtimes = tmp.path().join("runtime");
    let err = install(&rt, &runtimes).unwrap_err();
    assert_eq!(err.code(), "hx.setup.runtime_corrupt", "{err}");
    assert!(
        err.to_string().contains("entries its manifest allows"),
        "{err}"
    );
    assert_eq!(names(&runtimes), vec![".lock".to_owned()]);
    // With the count recorded (plus the margin) it unpacks.
    let rt = bundle_with(&tmp.path().join("ok"), "0.23.2", &bytes, None, |m| {
        m.entries = 202;
    });
    install(&rt, &runtimes).unwrap();
}

#[test]
fn device_nodes_and_pipes_are_refused_and_never_created() {
    for kind in [
        tar::EntryType::Char,
        tar::EntryType::Block,
        tar::EntryType::Fifo,
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let bytes = tar_zst_plus(|t| append(t, "dev/node", kind, 0o666, b""));
        let rt = bundle(&tmp.path().join("res"), "0.23.2", &bytes, None);
        let runtimes = tmp.path().join("runtime");
        let err = install(&rt, &runtimes).unwrap_err();
        assert_eq!(err.code(), "hx.setup.runtime_corrupt", "{kind:?}: {err}");
        assert!(err.to_string().contains("special file"), "{err}");
        assert_eq!(names(&runtimes), vec![".lock".to_owned()], "{kind:?}");
    }
}

#[cfg(unix)]
#[test]
fn setuid_setgid_and_sticky_bits_are_dropped_and_the_rest_kept() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let bytes = tar_zst_plus(|t| {
        append(t, "bin/suid", tar::EntryType::Regular, 0o4755, b"x");
        append(t, "bin/sgid", tar::EntryType::Regular, 0o2750, b"x");
        append(t, "bin/both", tar::EntryType::Regular, 0o6711, b"x");
        append(t, "bin/private", tar::EntryType::Regular, 0o600, b"x");
        append(t, "tmpdir/", tar::EntryType::Directory, 0o1777, b"");
        append(t, "shared/", tar::EntryType::Directory, 0o2775, b"");
    });
    let rt = bundle(&tmp.path().join("res"), "0.23.2", &bytes, None);
    let (layout, _) = install(&rt, &tmp.path().join("runtime")).unwrap();
    let mode = |p: &str| {
        std::fs::metadata(layout.root.join(p))
            .unwrap()
            .permissions()
            .mode()
            & 0o7777
    };
    assert_eq!(mode("bin/suid"), 0o755);
    assert_eq!(mode("bin/sgid"), 0o750);
    assert_eq!(mode("bin/both"), 0o711);
    assert_eq!(mode("bin/private"), 0o600);
    assert_eq!(mode("tmpdir"), 0o777);
    assert_eq!(mode("shared"), 0o775);
    assert_eq!(mode(HERMES), 0o755, "the launcher stays executable");
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
        "BOOPIS_HERMES=existing leaves the runtime alone"
    );

    let (plan, error) = plan_for(Source::Bundled, Some(&tmp.path().join("none")), data());
    assert!(
        plan.is_none() && error.is_none(),
        "a build without one uses the Hermes on the machine"
    );
}

// ── the advanced setting "Use my own Hermes" ────────────────────────────────────────────────────────────────────────

#[test]
fn the_saved_source_is_read_back_from_the_settings_file_as_it_was_written() {
    for source in [Source::Bundled, Source::Existing] {
        // the file the Tauri store writes: the app's settings under "app", the Hermes choice at the top
        let file =
            serde_json::json!({"app": {"version": 1}, "hermes_source": source_value(source)})
                .to_string();
        let saved = stored_source(&file);
        assert_eq!(saved.as_deref(), Some(source.word()));
        assert_eq!(Source::resolve(None, saved.as_deref()), source);
    }
    // an absent, unreadable or unknown value is no saved choice, and the bundled runtime stays
    for file in ["{}", "not json", r#"{"hermes_source": 3}"#] {
        assert_eq!(stored_source(file), None, "{file}");
    }
    assert_eq!(Source::resolve(None, Some("elsewhere")), Source::Bundled);
}

#[test]
fn the_view_says_what_is_saved_what_wins_and_what_runs_now() {
    // nothing saved: the bundled runtime, and no restart for a choice nobody made
    let v = SourceView::new(None, None, Source::Bundled, true);
    assert_eq!((v.saved, v.from_env, v.next), (None, None, Source::Bundled));
    assert!(!v.restart_needed());
    // saved "existing" while the bundled one runs: it takes effect at the next start, so a restart is due
    let v = SourceView::new(None, Some("existing"), Source::Bundled, true);
    assert_eq!(
        (v.saved, v.next, v.running),
        (Some(Source::Existing), Source::Existing, Source::Bundled)
    );
    assert!(v.restart_needed());
    // after that restart, the same saved value is what runs: nothing is due
    assert!(!SourceView::new(None, Some("existing"), Source::Existing, true).restart_needed());
    // BOOPIS_HERMES wins over the saved choice, so saving the other one changes nothing and asks for no restart
    let v = SourceView::new(Some("EXISTING"), Some("bundled"), Source::Existing, true);
    assert_eq!(
        (v.from_env, v.saved, v.next),
        (
            Some(Source::Existing),
            Some(Source::Bundled),
            Source::Existing
        )
    );
    assert!(!v.restart_needed());
    // a value in the variable that means nothing is ignored, as at start-up
    assert_eq!(
        SourceView::new(Some("later"), None, Source::Bundled, true).from_env,
        None
    );
    // a build with no runtime of its own has nothing to restart for
    assert!(!SourceView::new(None, Some("existing"), Source::Bundled, false).restart_needed());
}

#[test]
fn the_choice_crosses_the_ipc_as_a_lowercase_word() {
    assert_eq!(
        serde_json::to_string(&Source::Existing).unwrap(),
        "\"existing\""
    );
    assert_eq!(
        serde_json::from_str::<Source>("\"bundled\"").unwrap(),
        Source::Bundled
    );
    assert!(serde_json::from_str::<Source>("\"Elsewhere\"").is_err());
}

/// The Windows runtime (`scripts/build-runtime.sh --target windows-x86_64`, cross-built on Linux) passes the host's own
/// verification and unpack: hash, size and entry caps, the launchers where the manifest says. `HX_WINDOWS_RUNTIME` is the
/// directory holding its `runtime.json` and archive; without it the test says it skipped. It checks the bytes, not that
/// Windows runs them (there is no Windows here): the launcher and the interpreter must be PE files.
#[test]
fn the_windows_runtime_archive_verifies_with_the_hosts_own_unpack() {
    let Some(dir) = std::env::var_os("HX_WINDOWS_RUNTIME").map(PathBuf::from) else {
        eprintln!(
            "skipped: set HX_WINDOWS_RUNTIME to the directory scripts/build-runtime.sh --target windows-x86_64 made"
        );
        return;
    };
    let rt = Runtime::read(&dir).unwrap();
    let m = rt.manifest();
    assert_eq!(m.target, "win32-x64");
    assert!(
        m.hermes.ends_with(".exe") && m.python.ends_with("python.exe"),
        "{m:?}"
    );
    let tmp = tempfile::tempdir().unwrap();
    let runtimes = tmp.path().join("runtimes");
    let mut seen = Vec::new();
    let (layout, outcome) = rt.install(&runtimes, &mut |p| seen.push(p)).unwrap();
    assert_eq!(outcome, Outcome::Unpacked);
    // both passes ran, each to the end of the archive
    assert!(
        seen.iter()
            .any(|p| p.phase == Pass::Verify && p.read == p.total)
    );
    assert!(
        seen.iter()
            .any(|p| p.phase == Pass::Unpack && p.read == p.total)
    );
    for exe in [&layout.hermes, &layout.python] {
        let head = std::fs::read(exe).unwrap();
        assert_eq!(&head[..2], b"MZ", "{} is not a PE file", exe.display());
    }
    for rel in [
        "manifest.json",
        "enabled-features.json",
        "pm-runtime/pm-runtime.json",
        "venv/pyvenv.cfg",
    ] {
        assert!(layout.root.join(rel).is_file(), "{rel}");
    }
    assert!(layout.root.join("hermes-agent/hermes_cli").is_dir());
    assert!(layout.root.join("venv/Lib/site-packages").is_dir());
    // nothing of the build machine, and nothing left over
    assert_eq!(names(&runtimes), [".lock".to_owned(), m.id()]);
    // idempotent
    let (_, again) = rt.install(&runtimes, &mut |_| {}).unwrap();
    assert_eq!(again, Outcome::Current);
}
