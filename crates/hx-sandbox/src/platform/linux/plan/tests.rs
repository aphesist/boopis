use super::*;
use crate::policy::{Degraded, NetworkPolicy};
use crate::report::Status;
use std::path::PathBuf;
use std::time::Duration;

fn probe(
    abi: std::result::Result<u32, String>,
    enforces: bool,
    seccomp: bool,
    netns: NsAccess,
) -> Probe {
    Probe {
        kernel: "test".into(),
        landlock_abi: abi,
        landlock_enforces: enforces,
        seccomp_enforces: seccomp,
        netns,
        pidns: netns,
        cgroup: Err("no cgroup in this synthetic probe".into()),
        subreaper: Ok(()),
        cap_last: 40,
        can_drop_bounding: false,
        is_root: false,
    }
}

fn policy(net: NetworkPolicy, degraded: Degraded) -> ResolvedPolicy {
    ResolvedPolicy {
        ro: vec![],
        rw: vec![],
        network: net,
        env: vec![],
        cwd: PathBuf::from("/"),
        timeout: Duration::from_secs(1),
        output_cap: 1,
        kill_grace: Duration::ZERO,
        degraded,
        resources: crate::normalize::ResolvedLimits::default(),
    }
}

fn full() -> Probe {
    probe(Ok(7), true, true, NsAccess::Direct)
}

#[test]
fn everything_available_is_enforced() {
    let p = make(&full(), &policy(NetworkPolicy::Off, Degraded::default())).unwrap();
    assert_eq!(p.landlock_abi, Some(7));
    assert_eq!(p.fs.status, Status::Enforced);
    assert_eq!(p.network.status, Status::Enforced);
    assert_eq!(p.socket_mode, Some(SocketMode::Off));
    assert!(p.netns.is_none());
}

#[test]
fn old_or_missing_landlock_is_unavailable_unless_degraded() {
    for pr in [
        probe(Err("ENOSYS".into()), false, true, NsAccess::Direct),
        probe(Ok(1), true, true, NsAccess::Direct),
        probe(Ok(7), false, true, NsAccess::Direct),
    ] {
        let err = make(&pr, &policy(NetworkPolicy::Off, Degraded::default())).unwrap_err();
        assert!(
            matches!(
                err,
                Error::Unavailable {
                    dimension: Dimension::Fs,
                    ..
                }
            ),
            "{err}"
        );
        let ok = make(
            &pr,
            &policy(
                NetworkPolicy::Off,
                Degraded {
                    fs: true,
                    ..Degraded::default()
                },
            ),
        )
        .unwrap();
        assert_eq!(ok.fs.status, Status::Degraded);
        assert!(ok.landlock_abi.is_none());
        assert!(ok.fs.mechanisms.is_empty());
    }
}

#[test]
fn loopback_needs_a_netns() {
    let pr = probe(Ok(7), true, true, NsAccess::None);
    let strict = policy(NetworkPolicy::Loopback, Degraded::default());
    assert!(matches!(
        make(&pr, &strict),
        Err(Error::Unavailable {
            dimension: Dimension::Network,
            ..
        })
    ));
    let loose = policy(
        NetworkPolicy::Loopback,
        Degraded {
            network: true,
            ..Degraded::default()
        },
    );
    let p = make(&pr, &loose).unwrap();
    assert_eq!(p.network.status, Status::Degraded);
    assert!(p.netns.is_none());
    assert_eq!(
        p.socket_mode,
        Some(SocketMode::Off),
        "degrading falls back to network off"
    );
    assert!(
        p.network
            .detail
            .unwrap()
            .contains("network: off (loopback unavailable")
    );

    let ok = make(&probe(Ok(7), true, true, NsAccess::ViaUserns), &strict).unwrap();
    assert_eq!(ok.network.status, Status::Enforced);
    assert_eq!(ok.netns, Some(NsAccess::ViaUserns));
    assert_eq!(ok.socket_mode, Some(SocketMode::Loopback));
}

#[test]
fn allowlist_is_never_silently_enforced() {
    let al = NetworkPolicy::Allowlist(vec!["pypi.org".into()]);
    assert!(make(&full(), &policy(al.clone(), Degraded::default())).is_err());
    let p = make(
        &full(),
        &policy(
            al,
            Degraded {
                network: true,
                ..Degraded::default()
            },
        ),
    )
    .unwrap();
    assert_eq!(p.network.status, Status::Degraded);
    assert_eq!(
        p.socket_mode,
        Some(SocketMode::Off),
        "a degraded allowlist is network off"
    );
    assert!(p.network.mechanisms.contains(&"seccomp".to_owned()));
    assert!(
        p.network
            .detail
            .unwrap()
            .contains("network: off (allowlist of 1 host(s) unavailable")
    );
}

#[test]
fn network_off_without_seccomp_is_unavailable() {
    let pr = probe(Ok(7), true, false, NsAccess::Direct);
    assert!(make(&pr, &policy(NetworkPolicy::Off, Degraded::default())).is_err());
    let p = make(
        &pr,
        &policy(
            NetworkPolicy::Off,
            Degraded {
                network: true,
                ..Degraded::default()
            },
        ),
    )
    .unwrap();
    assert_eq!(p.network.status, Status::Degraded);
}

#[test]
fn network_on_is_reported_unrestricted() {
    let p = make(&full(), &policy(NetworkPolicy::On, Degraded::default())).unwrap();
    assert_eq!(p.network.status, Status::Unrestricted);
    assert_eq!(p.socket_mode, Some(SocketMode::Open));
}

#[test]
fn a_pid_namespace_is_planned_whenever_one_is_available() {
    let p = make(&full(), &policy(NetworkPolicy::On, Degraded::default())).unwrap();
    assert_eq!(p.pidns, Some(NsAccess::Direct));
    let none = probe(Ok(7), true, true, NsAccess::None);
    let p = make(&none, &policy(NetworkPolicy::On, Degraded::default())).unwrap();
    assert_eq!(p.pidns, None);
}

fn tree_probe(pidns: NsAccess, cgroup: bool, subreaper: bool) -> Probe {
    Probe {
        pidns,
        cgroup: if cgroup {
            Ok(PathBuf::from("/sys/fs/cgroup/delegated"))
        } else {
            Err("not delegated".into())
        },
        subreaper: if subreaper {
            Ok(())
        } else {
            Err("no subreaper".into())
        },
        ..full()
    }
}

#[test]
fn the_tree_is_ended_by_the_best_mechanism_the_host_has() {
    let pol = policy(NetworkPolicy::Off, Degraded::default());
    let tree = |pidns, cgroup, subreaper| {
        make(&tree_probe(pidns, cgroup, subreaper), &pol)
            .unwrap()
            .tree
    };
    assert_eq!(
        tree(NsAccess::Direct, true, true),
        TreeMethod::PidNamespace(NsAccess::Direct)
    );
    assert_eq!(
        tree(NsAccess::ViaUserns, false, true),
        TreeMethod::PidNamespace(NsAccess::ViaUserns)
    );
    assert_eq!(tree(NsAccess::None, true, true), TreeMethod::Cgroup);
    assert_eq!(tree(NsAccess::None, false, true), TreeMethod::Subreaper);
}

#[test]
fn a_host_with_nothing_but_the_process_group_refuses_unless_degraded() {
    let probe = tree_probe(NsAccess::None, false, false);
    let err = make(&probe, &policy(NetworkPolicy::Off, Degraded::default())).unwrap_err();
    assert!(
        matches!(
            err,
            Error::Unavailable {
                dimension: Dimension::Process,
                ..
            }
        ),
        "{err}"
    );
    let degraded = Degraded {
        process: true,
        ..Degraded::default()
    };
    let plan = make(&probe, &policy(NetworkPolicy::Off, degraded)).unwrap();
    assert_eq!(plan.tree, TreeMethod::GroupOnly);
    assert!(plan.pidns.is_none());
}
