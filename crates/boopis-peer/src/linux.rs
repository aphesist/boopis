//! The Linux table: `/proc`. Reads only; nothing here can change a process.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use super::{Os, Table, Unproven};

/// An established TCP connection in `/proc/net/tcp*` (`st` 01).
const ESTABLISHED: &str = "01";
/// The longest `/proc/<pid>/environ` read: a larger one is unreadable for this purpose (fail closed).
const MAX_ENVIRON: u64 = 1024 * 1024;

impl Table for Os {
    fn holders(&self, client: SocketAddr, server: SocketAddr) -> Result<Vec<u32>, Unproven> {
        let mut inode = None;
        for file in ["/proc/net/tcp", "/proc/net/tcp6"] {
            if let Ok(text) = std::fs::read_to_string(file)
                && let Some(found) = inode_of(&text, client, server)
            {
                inode = Some(found);
                break;
            }
        }
        let inode = inode.ok_or(Unproven::NotFound)?;
        Ok(holders_of(inode))
    }

    fn start(&self, pid: u32) -> Option<u64> {
        // field 22, index 19 of what follows the command name
        stat_tail(pid)?.get(19)?.parse().ok()
    }

    fn parent(&self, pid: u32) -> Option<u32> {
        stat_tail(pid)?.get(1)?.parse().ok()
    }

    fn has_var(&self, pid: u32, name: &str) -> Option<bool> {
        use std::io::Read as _;
        let file = std::fs::File::open(format!("/proc/{pid}/environ")).ok()?;
        let mut raw = Vec::new();
        file.take(MAX_ENVIRON + 1).read_to_end(&mut raw).ok()?;
        if raw.len() as u64 > MAX_ENVIRON {
            return None;
        }
        let prefix = format!("{name}=");
        Some(
            raw.split(|b| *b == 0)
                .any(|e| e.starts_with(prefix.as_bytes())),
        )
    }

    fn cgroup(&self, pid: u32) -> Option<String> {
        let text = std::fs::read_to_string(format!("/proc/{pid}/cgroup")).ok()?;
        group_of(&text)
    }
}

/// The fields of `/proc/<pid>/stat` after the command name (which may hold spaces and `)`), from field 3 on.
fn stat_tail(pid: u32) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let after = text.get(text.rfind(')')? + 1..)?;
    Some(after.split_whitespace().map(str::to_owned).collect())
}

/// The cgroup v2 path (`0::<path>`), else the whole file trimmed (a v1-only system).
pub(crate) fn group_of(text: &str) -> Option<String> {
    let v2 = text.lines().find_map(|l| l.strip_prefix("0::"));
    let group = v2.map_or_else(|| text.trim(), str::trim);
    (!group.is_empty()).then(|| group.to_owned())
}

/// The inode of the socket whose local end is `client` and remote end `server`, in an established row of a
/// `/proc/net/tcp` or `tcp6` table.
pub(crate) fn inode_of(table: &str, client: SocketAddr, server: SocketAddr) -> Option<u64> {
    for line in table.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // sl local_address rem_address st tx:rx tr:when retrnsmt uid timeout inode
        if cols.len() < 10 || cols[3] != ESTABLISHED {
            continue;
        }
        let (Some(local), Some(remote)) = (parse_addr(cols[1]), parse_addr(cols[2])) else {
            continue;
        };
        if same(local, client) && same(remote, server) {
            return cols[9].parse().ok().filter(|i| *i != 0);
        }
    }
    None
}

/// Two addresses that name the same endpoint, an IPv4 address and its IPv4-mapped IPv6 form alike.
fn same(a: SocketAddr, b: SocketAddr) -> bool {
    a.port() == b.port() && canonical(a.ip()) == canonical(b.ip())
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
        v4 @ IpAddr::V4(_) => v4,
    }
}

/// `0100007F:1F90` (an IPv4 address as the kernel's native-endian word, then the port) or the 32-digit IPv6 form (four
/// such words).
pub(crate) fn parse_addr(text: &str) -> Option<SocketAddr> {
    let (addr, port) = text.split_once(':')?;
    let port = u16::from_str_radix(port, 16).ok()?;
    let ip = match addr.len() {
        8 => IpAddr::V4(Ipv4Addr::from(word(addr)?)),
        32 => {
            let mut bytes = [0u8; 16];
            for (i, chunk) in bytes.chunks_mut(4).enumerate() {
                chunk.copy_from_slice(&word(addr.get(i * 8..i * 8 + 8)?)?);
            }
            IpAddr::V6(Ipv6Addr::from(bytes))
        }
        _ => return None,
    };
    Some(SocketAddr::new(ip, port))
}

/// Eight hex digits printed from a native-endian 32-bit word, back to the bytes in memory order.
fn word(hex: &str) -> Option<[u8; 4]> {
    u32::from_str_radix(hex, 16).ok().map(u32::to_ne_bytes)
}

/// Every process whose descriptors include `socket:[inode]`. Processes this user cannot look into are skipped: they are
/// another user's, and a bot runs as the owner. A descriptor passed or inherited is still seen, in each holder.
fn holders_of(inode: u64) -> Vec<u32> {
    let want = format!("socket:[{inode}]");
    let Ok(procs) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in procs.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|n| n.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(fds) = std::fs::read_dir(entry.path().join("fd")) else {
            continue;
        };
        if fds
            .flatten()
            .any(|fd| std::fs::read_link(fd.path()).is_ok_and(|t| t.as_os_str() == want.as_str()))
        {
            found.push(pid);
        }
    }
    found
}
