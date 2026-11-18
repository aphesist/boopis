//! Async views of the child's anonymous pipes. Anonymous pipes cannot be read with overlapped
//! I/O, so a dedicated thread per pipe moves bytes through an in-memory duplex stream. The
//! thread ends when the pipe closes (the child and everything it spawned are gone).

use std::io::{Read, Write};
use std::os::windows::io::OwnedHandle;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::platform::{BoxRead, BoxWrite};

const BUFFER: usize = 64 * 1024;

/// Streams the pipe's bytes to the returned reader.
pub(super) fn reader(pipe: OwnedHandle) -> BoxRead {
    let (mut tx, rx) = tokio::io::duplex(BUFFER);
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        let mut file = std::fs::File::from(pipe);
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match file.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if runtime.block_on(tx.write_all(&buf[..n])).is_err() {
                        break; // the reader was dropped
                    }
                }
            }
        }
        // Dropping `tx` signals EOF to the async side.
    });
    Box::new(rx)
}

/// Streams what is written to the returned writer into the pipe; dropping it closes stdin.
pub(super) fn writer(pipe: OwnedHandle) -> BoxWrite {
    let (tx, mut rx) = tokio::io::duplex(BUFFER);
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        let mut file = std::fs::File::from(pipe);
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match runtime.block_on(rx.read(&mut buf)) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if file.write_all(&buf[..n]).is_err() {
                        break; // the child closed its stdin
                    }
                }
            }
        }
    });
    Box::new(tx)
}
