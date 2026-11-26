//! The rules over a made-up process table (the spec's acceptance tests 7 to 12).

use std::collections::HashMap;
use std::net::SocketAddr;

use super::{ENGINE_LAUNCH_ENV, Pinned, Rule, Table, Unproven, Verdict, judge};

#[derive(Default, Clone)]
struct P {
    parent: Option<u32>,
    start: Option<u64>,
    env: Option<Vec<String>>,
    group: Option<String>,
}

struct Fake {
    procs: HashMap<u32, P>,
    holders: Result<Vec<u32>, Unproven>,
}

impl Table for Fake {
    fn holders(&self, _c: SocketAddr, _s: SocketAddr) -> Result<Vec<u32>, Unproven> {
        self.holders.clone()
    }
    fn start(&self, pid: u32) -> Option<u64> {
        self.procs.get(&pid)?.start
    }
    fn parent(&self, pid: u32) -> Option<u32> {
        self.procs.get(&pid)?.parent
    }
    fn has_var(&self, pid: u32, name: &str) -> Option<bool> {
        let env = self.procs.get(&pid)?.env.as_ref()?;
        Some(env.iter().any(|e| e.starts_with(&format!("{name}="))))
    }
    fn cgroup(&self, pid: u32) -> Option<String> {
        self.procs.get(&pid)?.group.clone()
    }
}

const HOST: u32 = 50;
const GATEWAY: u32 = 100;

fn proc(parent: u32, start: u64) -> P {
    P {
        parent: Some(parent),
        start: Some(start),
        env: Some(vec!["HOME=/home/u".into()]),
        group: Some("/user.slice/user-1000.slice/session-2.scope".into()),
    }
}

/// init, the host, a gateway (started at 10) with a tool (200) and its child (201), and an owner's client (300).
fn table() -> Fake {
    let mut procs = HashMap::new();
    procs.insert(1, proc(0, 1));
    procs.insert(HOST, proc(1, 5));
    procs.insert(GATEWAY, proc(1, 10));
    procs.insert(200, proc(GATEWAY, 20));
    procs.insert(201, proc(200, 21));
    procs.insert(300, proc(1, 30));
    Fake {
        procs,
        holders: Ok(vec![300]),
    }
}

fn gateway() -> Vec<Pinned> {
    vec![Pinned {
        pid: GATEWAY,
        start: Some(10),
    }]
}

fn addr(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

fn run(t: &Fake, gateways: &[Pinned]) -> Verdict {
    judge(t, gateways, HOST, addr(40000), addr(8765))
}

#[test]
fn a_client_outside_the_engine_s_tree_and_without_the_marker_is_the_owner() {
    assert_eq!(run(&table(), &gateway()), Verdict::Owner);
}

#[test]
fn a_descendant_of_the_recorded_gateway_is_a_bot() {
    let mut t = table();
    t.holders = Ok(vec![201]);
    assert_eq!(run(&t, &gateway()), Verdict::Bot(Rule::Ancestry));
    t.holders = Ok(vec![GATEWAY]);
    assert_eq!(run(&t, &gateway()), Verdict::Bot(Rule::Ancestry));
}

#[test]
fn any_holder_counts_so_a_passed_descriptor_is_still_seen() {
    let mut t = table();
    t.holders = Ok(vec![300, 201]);
    assert_eq!(run(&t, &gateway()), Verdict::Bot(Rule::Ancestry));
}

#[test]
fn a_recycled_gateway_pid_is_not_the_gateway() {
    let mut t = table();
    t.holders = Ok(vec![201]);
    let old = [Pinned {
        pid: GATEWAY,
        start: Some(9),
    }];
    assert_eq!(run(&t, &old), Verdict::Owner);
}

#[test]
fn a_process_re_parented_to_init_but_started_with_the_marker_is_a_bot() {
    let mut t = table();
    let mut orphan = proc(1, 40);
    orphan.env = Some(vec![format!("{ENGINE_LAUNCH_ENV}=n0nce"), "HOME=/h".into()]);
    t.procs.insert(400, orphan);
    t.holders = Ok(vec![400]);
    assert_eq!(run(&t, &gateway()), Verdict::Bot(Rule::Environment));
    // any value: a child of an earlier run's gateway carries an earlier nonce
    t.procs.get_mut(&400).unwrap().env = Some(vec![format!("{ENGINE_LAUNCH_ENV}=")]);
    assert_eq!(run(&t, &gateway()), Verdict::Bot(Rule::Environment));
}

#[test]
fn a_process_in_the_gateway_s_own_cgroup_is_a_bot() {
    let mut t = table();
    let unit =
        "/user.slice/user-1000.slice/user@1000.service/app.slice/hermes-gateway.service".to_owned();
    t.procs.get_mut(&GATEWAY).unwrap().group = Some(unit.clone());
    let mut escaped = proc(1, 41);
    escaped.group = Some(unit);
    t.procs.insert(401, escaped);
    t.holders = Ok(vec![401]);
    assert_eq!(run(&t, &gateway()), Verdict::Bot(Rule::Group));
}

#[test]
fn a_cgroup_shared_with_the_host_or_a_login_session_says_nothing() {
    let mut t = table();
    // the gateway and the owner's client share the login session's scope (the fixture), and the host's own group
    assert_eq!(run(&t, &gateway()), Verdict::Owner);
    let shared = "/user.slice/user-1000.slice/user@1000.service/app.slice/boopis.scope".to_owned();
    for pid in [HOST, GATEWAY, 300] {
        t.procs.get_mut(&pid).unwrap().group = Some(shared.clone());
    }
    assert_eq!(run(&t, &gateway()), Verdict::Owner);
}

#[test]
fn before_a_gateway_is_recorded_everything_is_refused() {
    assert_eq!(run(&table(), &[]), Verdict::Unproven(Unproven::NoGateway));
}

#[test]
fn a_connection_the_table_cannot_find_or_that_nothing_holds_is_refused() {
    let mut t = table();
    t.holders = Err(Unproven::NotFound);
    assert_eq!(run(&t, &gateway()), Verdict::Unproven(Unproven::NotFound));
    t.holders = Ok(vec![]);
    assert_eq!(run(&t, &gateway()), Verdict::Unproven(Unproven::NotFound));
    t.holders = Err(Unproven::Unsupported);
    assert_eq!(
        run(&t, &gateway()),
        Verdict::Unproven(Unproven::Unsupported)
    );
}

#[test]
fn a_holder_that_cannot_be_read_is_refused() {
    let mut t = table();
    t.procs.get_mut(&300).unwrap().env = None;
    assert_eq!(run(&t, &gateway()), Verdict::Unproven(Unproven::Unreadable));
    let mut t = table();
    t.procs.get_mut(&300).unwrap().parent = None;
    assert_eq!(run(&t, &gateway()), Verdict::Unproven(Unproven::Unreadable));
    let mut t = table();
    t.holders = Ok(vec![999]); // gone between the table and the look
    assert_eq!(run(&t, &gateway()), Verdict::Unproven(Unproven::Unreadable));
}

#[test]
fn a_parent_chain_that_loops_is_refused() {
    let mut t = table();
    t.procs.insert(500, proc(500, 50));
    t.holders = Ok(vec![500]);
    assert_eq!(run(&t, &gateway()), Verdict::Unproven(Unproven::Unreadable));
}

#[test]
fn an_owner_only_command_knows_a_bot_caller_by_its_marker_or_an_ancestor_s() {
    use super::bot_caller;
    let mut t = table();
    assert_eq!(bot_caller(&t, false, 300), None, "the owner's terminal");
    assert_eq!(bot_caller(&t, true, 300), Some(Rule::Environment));
    // the gateway was launched with the marker; its tool cleared its own environment (env -i)
    t.procs.get_mut(&GATEWAY).unwrap().env = Some(vec![format!("{ENGINE_LAUNCH_ENV}=n0nce")]);
    assert_eq!(bot_caller(&t, false, 201), Some(Rule::Ancestry));
    assert_eq!(bot_caller(&t, false, 300), None);
    // an ancestor that cannot be read says nothing either way
    t.procs.get_mut(&200).unwrap().parent = None;
    assert_eq!(bot_caller(&t, false, 201), None);
}

#[test]
fn the_words_the_audit_records() {
    assert_eq!(Rule::Ancestry.word(), "ancestry");
    assert_eq!(Rule::Environment.word(), "environment");
    assert_eq!(Rule::Group.word(), "group");
    assert_eq!(Unproven::Timeout.word(), "lookup_timeout");
    assert!(Verdict::Owner.is_owner() && !Verdict::Bot(Rule::Group).is_owner());
}

#[cfg(target_os = "linux")]
mod proc_tables {
    use super::super::linux::{group_of, inode_of, parse_addr};
    use super::addr;

    #[test]
    fn an_ipv4_row_is_read_in_the_kernel_s_native_order() {
        let ip = std::net::Ipv4Addr::LOCALHOST;
        let word = u32::from_ne_bytes(ip.octets());
        let text = format!("{word:08X}:9C40");
        assert_eq!(parse_addr(&text), Some(addr(40000)));
    }

    #[test]
    fn the_established_row_from_client_to_server_gives_the_inode() {
        let lo = u32::from_ne_bytes([127, 0, 0, 1]);
        let table = format!(
            "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
             0: {lo:08X}:223D 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1\n\
             1: {lo:08X}:9C40 {lo:08X}:223D 01 00000000:00000000 00:00000000 00000000  1000        0 222 1\n\
             2: {lo:08X}:223D {lo:08X}:9C40 01 00000000:00000000 00:00000000 00000000  1000        0 333 1\n\
             3: {lo:08X}:9C41 {lo:08X}:223D 06 00000000:00000000 00:00000000 00000000  1000        0 0 1\n"
        );
        assert_eq!(inode_of(&table, addr(40000), addr(8765)), Some(222));
        assert_eq!(inode_of(&table, addr(8765), addr(40000)), Some(333));
        assert_eq!(
            inode_of(&table, addr(40001), addr(8765)),
            None,
            "TIME_WAIT is no holder"
        );
    }

    #[test]
    fn an_ipv4_mapped_ipv6_row_names_the_same_endpoint() {
        let w = |b: [u8; 4]| format!("{:08X}", u32::from_ne_bytes(b));
        let mapped = format!(
            "{}{}{}{}",
            w([0; 4]),
            w([0; 4]),
            w([0, 0, 0xff, 0xff]),
            w([127, 0, 0, 1])
        );
        let table = format!("header\n 0: {mapped}:9C40 {mapped}:223D 01 0:0 0:0 0 1000 0 444 1\n");
        assert_eq!(inode_of(&table, addr(40000), addr(8765)), Some(444));
    }

    #[test]
    fn the_cgroup_is_the_v2_path() {
        assert_eq!(
            group_of("0::/user.slice/x.scope\n").as_deref(),
            Some("/user.slice/x.scope")
        );
        assert_eq!(group_of("12:pids:/a\n0::/b\n").as_deref(), Some("/b"));
        assert_eq!(group_of("\n"), None);
    }
}
