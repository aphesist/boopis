use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::io::{Read, Write};
use std::os::unix::fs::symlink;

use super::*;

fn request(dir: &Path) -> ChannelRequest {
    ChannelRequest {
        env: "HX_CHANNEL_FD".to_owned(),
        dir: Some(dir.to_path_buf()),
        accept_timeout_ms: Some(10_000),
    }
}

fn mode(path: &Path) -> u32 {
    std::fs::metadata(path).unwrap().permissions().mode() & 0o7777
}

fn err_text(r: Result<impl Sized>) -> String {
    r.err().expect("should have been refused").to_string()
}

#[test]
fn a_missing_directory_is_created_private() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("a").join("chan");
    check_dir(&dir).unwrap();
    assert_eq!(mode(&dir), 0o700);
    // and accepted again once it exists
    check_dir(&dir).unwrap();
}

#[test]
fn a_directory_open_to_group_or_others_is_refused_and_left_alone() {
    let tmp = tempfile::tempdir().unwrap();
    for bad in [0o750, 0o705, 0o755, 0o770, 0o777, 0o500, 0o600] {
        let dir = tmp.path().join(format!("m{bad:o}"));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(bad)).unwrap();
        let why = err_text(check_dir(&dir));
        assert!(why.contains("mode 0700"), "{bad:o}: {why}");
        // The caller's directory is not ours to change.
        assert_eq!(mode(&dir), bad, "{bad:o} was changed");
    }
}

#[test]
fn a_symlink_is_refused_even_to_a_good_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let real = tmp.path().join("real");
    std::fs::create_dir(&real).unwrap();
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o700)).unwrap();
    let link = tmp.path().join("link");
    symlink(&real, &link).unwrap();
    let why = err_text(check_dir(&link));
    assert!(why.contains("symbolic link"), "{why}");
    // a dangling link too
    let dangling = tmp.path().join("dangling");
    symlink(tmp.path().join("nowhere"), &dangling).unwrap();
    assert!(err_text(check_dir(&dangling)).contains("symbolic link"));
    // and the open of the channel stops there, binding nothing
    assert!(open_err(&link).contains("symbolic link"));
    assert!(!real.join("channel.sock").exists());
}

fn open_err(dir: &Path) -> String {
    err_text(open(&request(dir)))
}

#[test]
fn a_plain_file_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("file");
    std::fs::write(&file, "x").unwrap();
    assert!(err_text(check_dir(&file)).contains("not a directory"));
}

#[test]
fn a_directory_owned_by_someone_else_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("theirs");
    std::fs::create_dir(&dir).unwrap();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    // Only root can give a directory away (and to a user that is not root itself); elsewhere
    // there is nothing to test.
    if crate::platform::current_uid() != 0
        || std::os::unix::fs::chown(&dir, Some(65534), Some(65534)).is_err()
    {
        eprintln!("SKIPPED: cannot chown, so no directory of another owner can be made");
        return;
    }
    let why = err_text(check_dir(&dir));
    assert!(why.contains("not by the current user"), "{why}");
    assert!(open_err(&dir).contains("not by the current user"));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_socket_lands_in_a_checked_directory_with_private_modes() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("chan");
    let channel = open(&request(&dir)).unwrap();
    assert_eq!(mode(&dir), 0o700);
    assert_eq!(mode(&dir.join("channel.sock")), 0o600);
    assert_eq!(
        channel.info.path,
        dir.join("channel.sock").to_string_lossy()
    );
}

/// Reads until EOF or an error: a refused connection is closed by the bridge.
#[cfg(target_os = "linux")]
fn closed_by_peer(mut stream: std::os::unix::net::UnixStream) -> bool {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    let mut byte = [0u8; 1];
    matches!(stream.read(&mut byte), Ok(0) | Err(_))
        && stream.read(&mut byte).map_or(true, |n| n == 0)
}

#[cfg(target_os = "linux")]
#[tokio::test(flavor = "multi_thread")]
async fn a_connection_from_the_program_s_own_tree_is_refused_and_the_next_one_is_served() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("chan");
    let mut channel = open(&request(&dir)).unwrap();
    let path = dir.join("channel.sock");
    let child_end = std::os::unix::net::UnixStream::from(channel.take_child_end());

    // Before the child's pid is known nobody is served.
    assert!(closed_by_peer(
        std::os::unix::net::UnixStream::connect(&path).unwrap()
    ));

    // This test process stands in for the sandboxed program: it is refused, and the listener
    // stays open for whoever comes next instead of being used up.
    channel.set_child_pid(std::process::id());
    assert!(closed_by_peer(
        std::os::unix::net::UnixStream::connect(&path).unwrap()
    ));

    // The program is somebody else now, so this process is the plugin and gets the channel.
    channel.set_child_pid(4_000_000);
    let mut plugin = std::os::unix::net::UnixStream::connect(&path).unwrap();
    plugin.write_all(b"ping").unwrap();
    let mut child_end = child_end;
    child_end
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    let mut got = [0u8; 4];
    child_end.read_exact(&mut got).unwrap();
    assert_eq!(&got, b"ping");
}

#[test]
fn the_tree_walk_finds_the_program_its_descendants_and_its_session() {
    // pid -> (parent, session)
    let table: HashMap<i32, (i32, i32)> = HashMap::from([
        (100, (1, 100)), // the program, leader of its session
        (101, (100, 100)),
        (102, (101, 100)),
        (200, (1, 100)), // orphaned to init, still in the session
        (300, (1, 300)), // an escapee that left through setsid, parent gone: not provable
        (400, (1, 400)), // the plugin
        (401, (400, 400)),
    ]);
    let rel = |pid: i32| table.get(&pid).copied();
    for peer in [100, 101, 102, 200] {
        assert!(in_tree(peer, 100, rel), "{peer} belongs to 100");
    }
    for peer in [400, 401, 1, 999] {
        assert!(!in_tree(peer, 100, rel), "{peer} does not belong to 100");
    }
    // A cycle in the table cannot hang the walk.
    let cyclic = |pid: i32| Some((pid + 1, 7));
    assert!(!in_tree(5, 100, cyclic));
    assert!(!in_tree(5, u32::MAX, rel));
}
