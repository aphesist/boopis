//! The `AppContainer`: a per-run profile and SID, the ACL entries that grant it the policy's
//! paths, the capability SIDs for the network, and the cleanup that undoes all of it.
//!
//! The container SID is the confinement. A process created with this SID (through
//! `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`) gets a low-box token: low integrity, no
//! privileges beyond bypass-traverse, and every access check must pass for the container SID as
//! well as for the user. A file the container SID has no ACE on is unreadable, an object with
//! only a read ACE is unwritable, and without a capability SID there is no network.
#![allow(
    unsafe_code,
    reason = "Win32 security APIs (AppContainer, ACLs, SIDs); every block is commented"
)]

use std::ffi::c_void;
use std::io;
use std::path::Path;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, EXPLICIT_ACCESS_W, GRANT_ACCESS, GetNamedSecurityInfoW,
    NO_MULTIPLE_TRUSTEE, REVOKE_ACCESS, SE_FILE_OBJECT, SetEntriesInAclW, SetNamedSecurityInfoW,
    TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows_sys::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, FreeSid, NO_INHERITANCE, PSECURITY_DESCRIPTOR, PSID,
    SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows_sys::Win32::System::SystemServices::SE_GROUP_ENABLED;

use super::sys::wide;
use crate::winpolicy::{AclGrant, NetworkPlan};

/// `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)`.
const E_ALREADY_EXISTS: i32 = 0x8007_00B7_u32.cast_signed();

/// A granted ACL entry, remembered so it can be revoked.
struct Applied {
    path: Vec<u16>,
}

/// An `AppContainer` profile with its grants. Dropping it revokes the grants and deletes the
/// profile, so nothing outlives the run except through a crash (see the README: orphaned
/// entries name a random SID that no later run can have).
pub(super) struct Container {
    name: Vec<u16>,
    sid: PSID,
    capability_sids: Vec<PSID>,
    // Kept in the form the process-creation attribute needs, valid as long as `self` lives.
    capabilities: Vec<SID_AND_ATTRIBUTES>,
    applied: Vec<Applied>,
    profile_created: bool,
}

// SAFETY: the SIDs are heap blocks owned by this struct and used only through `&self`/`&mut self`
// with no thread affinity; Win32 SIDs are plain data.
unsafe impl Send for Container {}

fn hresult(hr: i32, what: &str) -> io::Error {
    io::Error::other(format!("{what} failed: HRESULT {hr:#010x}"))
}

fn win32(code: u32, what: &str) -> io::Error {
    io::Error::other(format!("{what} failed: Win32 error {code}"))
}

impl Container {
    /// Creates the profile named `name` and the capability SIDs for the network plan.
    pub(super) fn create(name: &str, network: &NetworkPlan) -> io::Result<Self> {
        let name = wide(std::ffi::OsStr::new(name));
        let display = wide(std::ffi::OsStr::new("hx-sandbox"));
        let mut sid: PSID = null_mut();
        // SAFETY: all three strings are NUL-terminated and live across the call; no capabilities
        // are passed at creation (they are supplied per process); `sid` is a valid out-pointer.
        let hr = unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                display.as_ptr(),
                display.as_ptr(),
                null(),
                0,
                &raw mut sid,
            )
        };
        let mut profile_created = true;
        if hr == E_ALREADY_EXISTS {
            profile_created = false;
            // SAFETY: as above.
            let hr =
                unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &raw mut sid) };
            if hr < 0 {
                return Err(hresult(hr, "DeriveAppContainerSidFromAppContainerName"));
            }
        } else if hr < 0 {
            return Err(hresult(hr, "CreateAppContainerProfile"));
        }

        let mut container = Self {
            name,
            sid,
            capability_sids: Vec::new(),
            capabilities: Vec::new(),
            applied: Vec::new(),
            profile_created,
        };
        for text in &network.capabilities {
            let wide_text = wide(std::ffi::OsStr::new(text));
            let mut cap: PSID = null_mut();
            // SAFETY: NUL-terminated string; `cap` is a valid out-pointer. The result is freed
            // with LocalFree in Drop.
            if unsafe { ConvertStringSidToSidW(wide_text.as_ptr(), &raw mut cap) } == 0 {
                return Err(io::Error::last_os_error()); // Drop cleans up what exists so far
            }
            container.capability_sids.push(cap);
            container.capabilities.push(SID_AND_ATTRIBUTES {
                Sid: cap,
                Attributes: SE_GROUP_ENABLED as u32,
            });
        }
        Ok(container)
    }

    /// The structure `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` takes. It borrows from `self`,
    /// so `self` must outlive the `CreateProcess` call.
    pub(super) fn security_capabilities(&mut self) -> SECURITY_CAPABILITIES {
        SECURITY_CAPABILITIES {
            AppContainerSid: self.sid,
            Capabilities: if self.capabilities.is_empty() {
                null_mut()
            } else {
                self.capabilities.as_mut_ptr()
            },
            CapabilityCount: u32::try_from(self.capabilities.len()).unwrap_or(0),
            Reserved: 0,
        }
    }

    /// Adds one ACE for the container SID.
    pub(super) fn grant(&mut self, grant: &AclGrant) -> io::Result<()> {
        let path = wide(grant.path.as_os_str());
        let inherit = if grant.inherit {
            SUB_CONTAINERS_AND_OBJECTS_INHERIT
        } else {
            NO_INHERITANCE
        };
        // SAFETY: `path` is NUL-terminated and `self.sid` is a live SID.
        unsafe { edit_dacl(&path, self.sid, GRANT_ACCESS, grant.right.mask(), inherit) }.map_err(
            |code| {
                win32(
                    code,
                    &format!("granting access on {}", display(&grant.path)),
                )
            },
        )?;
        self.applied.push(Applied { path });
        Ok(())
    }
}

fn display(path: &Path) -> String {
    path.display().to_string()
}

/// Reads the DACL of `path`, applies one entry for `sid`, and writes it back. With inheritance
/// flags set, Windows propagates the entry to existing children.
///
/// # Safety
/// `path` must be NUL-terminated and `sid` a valid SID.
unsafe fn edit_dacl(
    path: &[u16],
    sid: PSID,
    mode: i32,
    mask: u32,
    inherit: u32,
) -> Result<(), u32> {
    let mut old: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: valid path and out-pointers; the returned descriptor is freed below.
    let rc = unsafe {
        GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &raw mut old,
            null_mut(),
            &raw mut descriptor,
        )
    };
    if rc != 0 {
        return Err(rc);
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: mode,
        grfInheritance: inherit,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast(),
        },
    };
    let mut new: *mut ACL = null_mut();
    // SAFETY: `entry` is valid for one entry; `old` points into `descriptor`, still alive.
    let rc = unsafe { SetEntriesInAclW(1, &raw const entry, old, &raw mut new) };
    // SAFETY: `descriptor` came from GetNamedSecurityInfoW; `new` is a separate allocation.
    unsafe { LocalFree(descriptor.cast()) };
    if rc != 0 {
        return Err(rc);
    }
    // SAFETY: `path` is NUL-terminated (SetNamedSecurityInfoW takes it as non-const but does not
    // modify it); `new` is a valid ACL.
    let rc = unsafe {
        SetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            new,
            null(),
        )
    };
    // SAFETY: `new` came from SetEntriesInAclW.
    unsafe { LocalFree(new.cast()) };
    if rc == 0 { Ok(()) } else { Err(rc) }
}

impl Drop for Container {
    fn drop(&mut self) {
        for applied in &self.applied {
            // SAFETY: the path is NUL-terminated and `self.sid` is still live.
            if let Err(code) =
                unsafe { edit_dacl(&applied.path, self.sid, REVOKE_ACCESS, 0, NO_INHERITANCE) }
            {
                tracing::warn!(
                    code,
                    "could not revoke the sandbox's access entry; it names a SID no later run can have"
                );
            }
        }
        if self.profile_created {
            // SAFETY: `self.name` is NUL-terminated.
            let hr = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
            if hr < 0 {
                tracing::warn!(hr, "could not delete the AppContainer profile");
            }
        }
        for cap in self.capability_sids.drain(..) {
            // SAFETY: from ConvertStringSidToSidW, freed exactly once.
            unsafe { LocalFree(cap.cast::<c_void>()) };
        }
        if !self.sid.is_null() {
            // SAFETY: from CreateAppContainerProfile / Derive..., freed exactly once with FreeSid.
            unsafe { FreeSid(self.sid) };
        }
    }
}

impl Container {
    /// Runs `f` with the container's SID.
    pub(super) fn with_sid<T>(&self, f: impl FnOnce(PSID) -> io::Result<T>) -> io::Result<T> {
        f(self.sid)
    }
}
