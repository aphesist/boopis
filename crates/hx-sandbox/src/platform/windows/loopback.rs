//! Loopback for an `AppContainer`. Windows blocks an `AppContainer` from reaching `127.0.0.1` unless
//! its SID is on the machine-wide loopback-exemption list (what `CheckNetIsolation
//! LoopbackExempt -a` edits). Editing that list needs an elevated caller, and the list is global,
//! so each run adds its own random SID and removes it again.
#![allow(
    unsafe_code,
    reason = "Win32 network-isolation and token APIs; every block is commented"
)]

use std::ffi::c_void;
use std::io;
use std::mem::size_of;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::NetworkManagement::WindowsFirewall::{
    NetworkIsolationGetAppContainerConfig, NetworkIsolationSetAppContainerConfig,
};
use windows_sys::Win32::Security::{
    EqualSid, GetLengthSid, GetTokenInformation, PSID, SID_AND_ATTRIBUTES, TOKEN_ELEVATION,
    TOKEN_QUERY, TokenElevation,
};
use windows_sys::Win32::System::Memory::{GetProcessHeap, HeapFree};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// Whether this process runs elevated (an administrator with the full token).
pub(super) fn is_elevated() -> bool {
    let mut token: HANDLE = null_mut();
    // SAFETY: the pseudo-handle for the current process is always valid; `token` is an out-pointer.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) } == 0 {
        return false;
    }
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut returned = 0u32;
    // SAFETY: the buffer and its size describe `elevation`; `token` is open.
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            (&raw mut elevation).cast::<c_void>(),
            u32::try_from(size_of::<TOKEN_ELEVATION>()).unwrap_or(0),
            &raw mut returned,
        )
    };
    // SAFETY: `token` was opened above.
    unsafe { CloseHandle(token) };
    ok != 0 && elevation.TokenIsElevated != 0
}

/// A copy of a SID's bytes, so the exemption can be removed after the original is freed.
struct SidBytes(Vec<u8>);

impl SidBytes {
    fn copy(sid: PSID) -> Self {
        // SAFETY: `sid` is a valid SID; GetLengthSid reports its size and the copy stays inside it.
        let len = unsafe { GetLengthSid(sid) } as usize;
        // SAFETY: `len` bytes are readable at `sid`.
        Self(unsafe { std::slice::from_raw_parts(sid.cast::<u8>(), len) }.to_vec())
    }

    fn psid(&self) -> PSID {
        self.0.as_ptr().cast_mut().cast()
    }
}

/// The current exemption list, as entries borrowed from the buffer Windows allocated.
struct Config {
    entries: *mut SID_AND_ATTRIBUTES,
    count: u32,
}

impl Config {
    fn read() -> io::Result<Self> {
        let mut count = 0u32;
        let mut entries: *mut SID_AND_ATTRIBUTES = null_mut();
        // SAFETY: valid out-pointers; the buffer is freed in Drop.
        let rc = unsafe { NetworkIsolationGetAppContainerConfig(&raw mut count, &raw mut entries) };
        if rc != 0 {
            return Err(io::Error::other(format!(
                "NetworkIsolationGetAppContainerConfig failed: {rc}"
            )));
        }
        Ok(Self { entries, count })
    }

    fn slice(&self) -> &[SID_AND_ATTRIBUTES] {
        if self.entries.is_null() || self.count == 0 {
            &[]
        } else {
            // SAFETY: Windows returned `count` entries at `entries`, alive until Drop.
            unsafe { std::slice::from_raw_parts(self.entries, self.count as usize) }
        }
    }
}

impl Drop for Config {
    fn drop(&mut self) {
        if !self.entries.is_null() {
            // SAFETY: the buffer was allocated by Windows on the process heap for this call.
            unsafe { HeapFree(GetProcessHeap(), 0, self.entries.cast()) };
        }
    }
}

fn set(entries: &[SID_AND_ATTRIBUTES]) -> io::Result<()> {
    // SAFETY: `entries` is a valid array of `len` entries whose SIDs outlive the call.
    let rc = unsafe {
        NetworkIsolationSetAppContainerConfig(
            u32::try_from(entries.len()).unwrap_or(0),
            entries.as_ptr(),
        )
    };
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "NetworkIsolationSetAppContainerConfig failed: {rc}"
        )))
    }
}

/// An exemption that removes itself.
pub(super) struct Exemption {
    sid: SidBytes,
}

impl Exemption {
    /// Adds `sid` to the loopback-exemption list.
    pub(super) fn add(sid: PSID) -> io::Result<Self> {
        let mine = SidBytes::copy(sid);
        let config = Config::read()?;
        let mut all: Vec<SID_AND_ATTRIBUTES> = config.slice().to_vec();
        all.push(SID_AND_ATTRIBUTES {
            Sid: mine.psid(),
            Attributes: 0,
        });
        set(&all)?;
        Ok(Self { sid: mine })
    }
}

impl Drop for Exemption {
    fn drop(&mut self) {
        let Ok(config) = Config::read() else { return };
        let keep: Vec<SID_AND_ATTRIBUTES> = config
            .slice()
            .iter()
            // SAFETY: both SIDs are valid; EqualSid only reads them.
            .filter(|e| unsafe { EqualSid(e.Sid, self.sid.psid()) } == 0)
            .copied()
            .collect();
        if let Err(error) = set(&keep) {
            tracing::warn!(%error, "could not remove the loopback exemption for a finished sandbox");
        }
    }
}
