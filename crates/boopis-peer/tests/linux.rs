//! The lookup over real processes and a real loopback connection (Linux; the spec's acceptance test 14): a client the
//! "gateway" started is a bot by ancestry, one started with the engine's marker is a bot by environment, and the test
//! process itself, outside the gateway's tree, is the owner.
#![cfg(target_os = "linux")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a test fails loudly"
)]

use std::io::Read as _;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};

use boopis_peer::{ENGINE_LAUNCH_ENV, Os, Pinned, Rule, Table, Verdict, judge};

struct Killed(Child);

impl Drop for Killed {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn listener() -> (TcpListener, SocketAddr) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    (l, addr)
}

/// A "gateway" (bash) whose child connects to `server` with bash's own `/dev/tcp` and waits. Returns the gateway and the
/// client's address as the server sees it.
fn gateway_with_client(
    l: &TcpListener,
    server: SocketAddr,
    env: &[(&str, &str)],
) -> (Killed, SocketAddr) {
    let script = format!(
        "bash -c 'exec 3<>/dev/tcp/127.0.0.1/{}; sleep 20'; true",
        server.port()
    );
    let mut cmd = Command::new("bash");
    cmd.arg("-c")
        .arg(script)
        .stdin(Stdio::null())
        .env_remove(ENGINE_LAUNCH_ENV);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let child = Killed(cmd.spawn().unwrap());
    let (stream, client) = l.accept().unwrap();
    std::mem::forget(stream); // keep the server's end open while the lookup runs
    (child, client)
}

fn pinned(pid: u32) -> Pinned {
    Pinned {
        pid,
        start: Os.start(pid),
    }
}

#[test]
fn a_client_the_gateway_started_is_a_bot_and_the_owner_s_own_is_not() {
    let (l, server) = listener();
    let (gw, client) = gateway_with_client(&l, server, &[]);
    let gateway = pinned(gw.0.id());
    assert!(gateway.start.is_some());
    let holders = Os.holders(client, server).unwrap();
    assert!(
        !holders.is_empty() && !holders.contains(&std::process::id()),
        "{holders:?}"
    );
    assert_eq!(
        judge(&Os, &[gateway], std::process::id(), client, server),
        Verdict::Bot(Rule::Ancestry)
    );

    // the test process itself, beside the gateway rather than under it
    let mine = TcpStream::connect(server).unwrap();
    let (_peer, seen) = l.accept().unwrap();
    assert_eq!(seen, mine.local_addr().unwrap());
    assert_eq!(Os.holders(seen, server).unwrap(), vec![std::process::id()]);
    assert_eq!(
        judge(&Os, &[gateway], std::process::id(), seen, server),
        Verdict::Owner
    );
}

#[test]
fn a_client_started_with_the_engine_s_marker_is_a_bot_whoever_its_parent_is() {
    let (l, server) = listener();
    let (_unrelated, _) = gateway_with_client(&l, server, &[]);
    let sleeper = Killed(Command::new("sleep").arg("20").spawn().unwrap());
    let (_gw, client) = gateway_with_client(&l, server, &[(ENGINE_LAUNCH_ENV, "n0nce")]);
    assert_eq!(
        judge(
            &Os,
            &[pinned(sleeper.0.id())],
            std::process::id(),
            client,
            server
        ),
        Verdict::Bot(Rule::Environment)
    );
}

#[test]
fn a_connection_that_is_not_there_is_not_found() {
    let (_l, server) = listener();
    let nobody = SocketAddr::from(([127, 0, 0, 1], 1));
    assert!(Os.holders(nobody, server).is_err());
    let me = pinned(std::process::id());
    assert!(!judge(&Os, &[me], std::process::id(), nobody, server).is_owner());
}

#[test]
fn this_process_reads_as_itself() {
    let me = std::process::id();
    assert!(Os.start(me).is_some());
    assert!(Os.parent(me).is_some());
    assert_eq!(
        Os.has_var(me, "BOOPIS_SURELY_NOT_SET_ANYWHERE"),
        Some(false)
    );
    let mut text = String::new();
    std::fs::File::open("/proc/self/cgroup")
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    assert_eq!(Os.cgroup(me).is_some(), !text.trim().is_empty());
}
