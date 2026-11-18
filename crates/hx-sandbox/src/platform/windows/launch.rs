//! Creating the child: pipes, the job object, and `CreateProcessW` with the `AppContainer`
//! attribute, suspended until it is inside the job.
#![allow(
    unsafe_code,
    reason = "Win32 process, pipe and job-object APIs; every block is commented"
)]

use std::ffi::{OsStr, c_void};
use std::io;
use std::mem::{size_of, zeroed};
use std::os::windows::io::OwnedHandle;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE, HANDLE};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation, SetInformationJobObject,
    TerminateJobObject,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
    DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, InitializeProcThreadAttributeList,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION, ResumeThread,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute,
};

use super::sys::{own, raw, set_inheritable, wide};
use crate::winpolicy::JOB_UI_LIMITS;
use windows_sys::Win32::Security::SECURITY_CAPABILITIES;

/// A kill-on-close job object with UI restrictions.
pub(super) fn create_job() -> io::Result<OwnedHandle> {
    // SAFETY: null attributes and name create an anonymous job.
    let job = own(unsafe { CreateJobObjectW(null(), null()) })?;

    // SAFETY: an all-zero struct is a valid starting value for both information classes.
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: the pointer and size describe `limits` exactly.
    let ok = unsafe {
        SetInformationJobObject(
            raw(&job),
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast::<c_void>(),
            u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).unwrap_or(0),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }

    let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
        UIRestrictionsClass: JOB_UI_LIMITS,
    };
    // SAFETY: the pointer and size describe `ui` exactly.
    let ok = unsafe {
        SetInformationJobObject(
            raw(&job),
            JobObjectBasicUIRestrictions,
            (&raw const ui).cast::<c_void>(),
            u32::try_from(size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>()).unwrap_or(0),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(job)
}

/// Ends every process in the job.
pub(super) fn terminate_job(job: &OwnedHandle) {
    // SAFETY: the job handle is open. Exit code 1 marks a killed tree.
    unsafe {
        TerminateJobObject(raw(job), 1);
    }
}

/// Ends one process (used only when no job could be assigned).
pub(super) fn terminate_process(process: &OwnedHandle) {
    // SAFETY: the process handle is open.
    unsafe {
        TerminateProcess(raw(process), 1);
    }
}

/// A pipe: `(read_end, write_end)`, both inheritable by default.
fn pipe() -> io::Result<(OwnedHandle, OwnedHandle)> {
    let attrs = SECURITY_ATTRIBUTES {
        nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(0),
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let (mut read, mut write): (HANDLE, HANDLE) = (null_mut(), null_mut());
    // SAFETY: valid out-pointers and attributes; default buffer size.
    if unsafe { CreatePipe(&raw mut read, &raw mut write, &raw const attrs, 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((own(read)?, own(write)?))
}

/// An inheritable handle to the null device, for stdin.
fn null_device() -> io::Result<OwnedHandle> {
    let attrs = SECURITY_ATTRIBUTES {
        nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(0),
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let name = wide(OsStr::new("NUL"));
    // SAFETY: NUL-terminated name and valid attributes.
    own(unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &raw const attrs,
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    })
}

/// The parent's ends of the child's stdio.
pub(super) struct ParentPipes {
    pub stdin: Option<OwnedHandle>,
    pub stdout: OwnedHandle,
    pub stderr: OwnedHandle,
}

/// Everything `CreateProcessW` needs.
pub(super) struct Request<'a> {
    pub program: &'a [u16],
    pub command_line: Vec<u16>,
    pub cwd: &'a [u16],
    pub env_block: &'a [u16],
    pub capabilities: SECURITY_CAPABILITIES,
    pub job: Option<&'a OwnedHandle>,
    pub piped_stdin: bool,
    pub inherit: Option<OwnedHandle>,
}

/// A started, resumed process.
pub(super) struct Started {
    pub process: OwnedHandle,
    pub pid: u32,
    pub pipes: ParentPipes,
    pub in_job: bool,
}

/// Why a start failed.
pub(super) enum StartError {
    /// The program could not be started (not found, no access, bad image).
    Program(io::Error),
    /// The sandbox could not be built.
    Setup {
        step: &'static str,
        source: io::Error,
    },
}

const ERROR_FILE_NOT_FOUND: i32 = 2;
const ERROR_PATH_NOT_FOUND: i32 = 3;
const ERROR_ACCESS_DENIED: i32 = 5;
const ERROR_BAD_EXE_FORMAT: i32 = 193;

fn setup(step: &'static str) -> impl FnOnce(io::Error) -> StartError {
    move |source| StartError::Setup { step, source }
}

#[allow(
    clippy::too_many_lines,
    reason = "one linear sequence of Win32 calls whose attribute-list and handle lifetimes share locals; splitting it would mean passing them all around"
)]
/// Starts the process suspended inside the `AppContainer`, assigns it to the job, resumes it.
pub(super) fn start(mut request: Request<'_>) -> Result<Started, StartError> {
    let (child_in, parent_in) = if request.piped_stdin {
        let (read, write) = pipe().map_err(setup("create stdin pipe"))?;
        (read, Some(write))
    } else {
        (null_device().map_err(setup("open null device"))?, None)
    };
    let (parent_out, child_out) = pipe().map_err(setup("create stdout pipe"))?;
    let (parent_err, child_err) = pipe().map_err(setup("create stderr pipe"))?;
    // The parent's ends must not leak into the child.
    for end in parent_in.iter().chain([&parent_out, &parent_err]) {
        set_inheritable(end, false).map_err(setup("mark pipe ends private"))?;
    }
    if let Some(extra) = &request.inherit {
        set_inheritable(extra, true).map_err(setup("mark inherited handle"))?;
    }

    // The exact set of handles the child may inherit: stdio and the one extra.
    let mut handles: Vec<HANDLE> = vec![raw(&child_in), raw(&child_out), raw(&child_err)];
    if let Some(extra) = &request.inherit {
        handles.push(raw(extra));
    }

    let mut size = 0usize;
    // SAFETY: querying the required size with a null list is the documented first call.
    unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &raw mut size) };
    // 8-byte aligned storage for the attribute list.
    let mut storage = vec![0u64; size.div_ceil(8)];
    let list: LPPROC_THREAD_ATTRIBUTE_LIST = storage.as_mut_ptr().cast();
    // SAFETY: `storage` is at least `size` bytes and 8-byte aligned.
    if unsafe { InitializeProcThreadAttributeList(list, 2, 0, &raw mut size) } == 0 {
        return Err(setup("initialise attribute list")(
            io::Error::last_os_error(),
        ));
    }
    let list_guard = AttributeListGuard(list);

    // SAFETY: the attribute value pointers stay valid until after CreateProcessW below, because
    // `request.capabilities` and `handles` live until the end of this function.
    let ok = unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            (&raw mut request.capabilities).cast::<c_void>(),
            size_of::<SECURITY_CAPABILITIES>(),
            null_mut(),
            null(),
        )
    };
    if ok == 0 {
        return Err(setup("attach AppContainer capabilities")(
            io::Error::last_os_error(),
        ));
    }
    // SAFETY: as above, for the handle list.
    let ok = unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            handles.as_mut_ptr().cast::<c_void>(),
            handles.len() * size_of::<HANDLE>(),
            null_mut(),
            null(),
        )
    };
    if ok == 0 {
        return Err(setup("restrict inherited handles")(
            io::Error::last_os_error(),
        ));
    }

    // SAFETY: an all-zero STARTUPINFOEXW is valid before the fields below are set.
    let mut info: STARTUPINFOEXW = unsafe { zeroed() };
    info.StartupInfo.cb = u32::try_from(size_of::<STARTUPINFOEXW>()).unwrap_or(0);
    info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    info.StartupInfo.hStdInput = raw(&child_in);
    info.StartupInfo.hStdOutput = raw(&child_out);
    info.StartupInfo.hStdError = raw(&child_err);
    info.lpAttributeList = list;
    // SAFETY: an all-zero PROCESS_INFORMATION is a valid out-buffer.
    let mut process_info: PROCESS_INFORMATION = unsafe { zeroed() };

    // SAFETY: every pointer is valid and NUL-terminated where required; the command line is a
    // mutable buffer as CreateProcessW demands; the environment block is double-NUL terminated.
    let ok = unsafe {
        CreateProcessW(
            request.program.as_ptr(),
            request.command_line.as_mut_ptr(),
            null(),
            null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT
                | CREATE_SUSPENDED
                | CREATE_UNICODE_ENVIRONMENT
                | CREATE_NO_WINDOW,
            request.env_block.as_ptr().cast::<c_void>(),
            request.cwd.as_ptr(),
            (&raw const info).cast(),
            &raw mut process_info,
        )
    };
    drop(list_guard);
    if ok == 0 {
        let err = io::Error::last_os_error();
        return Err(match err.raw_os_error() {
            Some(
                ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND | ERROR_ACCESS_DENIED
                | ERROR_BAD_EXE_FORMAT,
            ) => StartError::Program(err),
            _ => StartError::Setup {
                step: "CreateProcessW",
                source: err,
            },
        });
    }
    let process = own(process_info.hProcess).map_err(setup("own process handle"))?;
    let thread = own(process_info.hThread).map_err(setup("own thread handle"))?;

    // Inside the job before it runs a single instruction, or the tree could escape the kill.
    let mut in_job = false;
    if let Some(job) = request.job {
        // SAFETY: both handles are open.
        in_job = unsafe { AssignProcessToJobObject(raw(job), raw(&process)) } != 0;
        if !in_job {
            let err = io::Error::last_os_error();
            terminate_process(&process);
            return Err(StartError::Setup {
                step: "AssignProcessToJobObject",
                source: err,
            });
        }
    }
    // SAFETY: the thread handle is open and the thread is suspended.
    if unsafe { ResumeThread(raw(&thread)) } == u32::MAX {
        let err = io::Error::last_os_error();
        terminate_process(&process);
        return Err(StartError::Setup {
            step: "ResumeThread",
            source: err,
        });
    }
    drop(thread);
    // The child holds its own copies; closing ours lets the pipes report EOF when it exits.
    drop((child_in, child_out, child_err, request.inherit.take()));

    Ok(Started {
        process,
        pid: process_info.dwProcessId,
        pipes: ParentPipes {
            stdin: parent_in,
            stdout: parent_out,
            stderr: parent_err,
        },
        in_job,
    })
}

struct AttributeListGuard(LPPROC_THREAD_ATTRIBUTE_LIST);

impl Drop for AttributeListGuard {
    fn drop(&mut self) {
        // SAFETY: the list was initialised by InitializeProcThreadAttributeList and not yet deleted.
        unsafe { DeleteProcThreadAttributeList(self.0) };
    }
}
