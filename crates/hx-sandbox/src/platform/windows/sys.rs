//! Small Win32 helpers shared by the Windows backend.
#![allow(
    unsafe_code,
    reason = "Win32 calls with no safe std equivalent; every block is commented"
)]

use std::ffi::OsStr;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};

use windows_sys::Win32::Foundation::{HANDLE, HANDLE_FLAG_INHERIT, SetHandleInformation};

/// A NUL-terminated UTF-16 copy of `s`.
pub(super) fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

/// Takes ownership of a handle returned by a Win32 call, or the last OS error when it is
/// null or `INVALID_HANDLE_VALUE`.
pub(super) fn own(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle as isize == -1 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the handle was just returned by a successful Win32 call and nothing else owns it.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle as RawHandle) })
}

/// Sets or clears the inheritable flag on a handle.
pub(super) fn set_inheritable(handle: &OwnedHandle, inheritable: bool) -> io::Result<()> {
    let flag = if inheritable { HANDLE_FLAG_INHERIT } else { 0 };
    // SAFETY: the handle is open for the duration of the call.
    let ok = unsafe {
        SetHandleInformation(handle.as_raw_handle() as HANDLE, HANDLE_FLAG_INHERIT, flag)
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// The raw handle as the type Win32 calls expect.
pub(super) fn raw(handle: &OwnedHandle) -> HANDLE {
    handle.as_raw_handle() as HANDLE
}

/// Blocks until the process exits and returns its exit code.
pub(super) fn wait_for_exit(process: &OwnedHandle) -> io::Result<u32> {
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, INFINITE, WaitForSingleObject,
    };
    let handle = raw(process);
    // SAFETY: the handle is open for the duration of the call; INFINITE waits for the exit.
    unsafe { WaitForSingleObject(handle, INFINITE) };
    let mut code = 0u32;
    // SAFETY: a valid handle and a valid out-pointer.
    if unsafe { GetExitCodeProcess(handle, &raw mut code) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(code)
}
