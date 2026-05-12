//! Raw C ABI for Windows P/Invoke and other languages without UniFFI support.
//!
//! All exports prefixed `ctrl_native_*` so cbindgen filters them. Return code
//! convention:
//!   0   = success
//!  -1   = null pointer / invalid input
//!  -2   = UTF-8 decode failure
//!  -3   = kernel error (see error_get_last for message)
//!  -99  = unexpected internal
//!
//! Strings out are heap-allocated CString; caller MUST call `ctrl_native_string_free`
//! once consumed. Strings in are borrowed; caller retains ownership.

use std::cell::RefCell;
use std::ffi::{c_char, CStr, CString};

use crate::ffi::{self, KernelError};

thread_local! {
    static LAST_ERROR: RefCell<Option<String>> = const { RefCell::new(None) };
}

fn record_error(err: impl ToString) {
    LAST_ERROR.with(|cell| *cell.borrow_mut() = Some(err.to_string()));
}

fn err_to_code(err: KernelError) -> i32 {
    record_error(&err);
    -3
}

/// Returns the last error message recorded on this thread. Caller must
/// `ctrl_native_string_free` the returned pointer (if non-null).
#[no_mangle]
pub unsafe extern "C" fn ctrl_native_error_get_last() -> *mut c_char {
    LAST_ERROR.with(|cell| {
        cell.borrow()
            .as_ref()
            .and_then(|s| CString::new(s.as_str()).ok())
            .map(|c| c.into_raw())
            .unwrap_or(std::ptr::null_mut())
    })
}

/// Free a string returned by any other `ctrl_native_*` function.
#[no_mangle]
pub unsafe extern "C" fn ctrl_native_string_free(p: *mut c_char) {
    if !p.is_null() {
        drop(CString::from_raw(p));
    }
}

unsafe fn cstr_to_string(p: *const c_char) -> Result<String, i32> {
    if p.is_null() {
        return Err(-1);
    }
    CStr::from_ptr(p)
        .to_str()
        .map(|s| s.to_string())
        .map_err(|e| {
            record_error(e);
            -2
        })
}

fn out_string(s: String, out: *mut *mut c_char) -> i32 {
    let c = match CString::new(s) {
        Ok(c) => c,
        Err(e) => {
            record_error(e);
            return -99;
        }
    };
    unsafe {
        if !out.is_null() {
            *out = c.into_raw();
        }
    }
    0
}

// ---- Kernel lifecycle -------------------------------------------------------

/// Initialize the L1 kernel runtime. Must be called once at app start.
/// `data_dir`: UTF-8 NUL-terminated path to local data dir.
#[no_mangle]
pub unsafe extern "C" fn ctrl_native_kernel_boot(data_dir: *const c_char) -> i32 {
    let dir = match cstr_to_string(data_dir) {
        Ok(s) => s,
        Err(code) => return code,
    };
    ffi::kernel_boot(dir).map(|_| 0).unwrap_or_else(err_to_code)
}

/// Returns JSON-encoded kernel health snapshot. Caller frees `out`.
#[no_mangle]
pub unsafe extern "C" fn ctrl_native_kernel_health(out: *mut *mut c_char) -> i32 {
    match ffi::kernel_health() {
        Ok(s) => out_string(s, out),
        Err(e) => err_to_code(e),
    }
}

// ---- MCP --------------------------------------------------------------------

#[no_mangle]
pub unsafe extern "C" fn ctrl_native_mcp_register(descriptor_json: *const c_char) -> i32 {
    let json = match cstr_to_string(descriptor_json) {
        Ok(s) => s,
        Err(code) => return code,
    };
    ffi::mcp_register(json).map(|_| 0).unwrap_or_else(err_to_code)
}

#[no_mangle]
pub unsafe extern "C" fn ctrl_native_mcp_connect(server_id: *const c_char) -> i32 {
    let id = match cstr_to_string(server_id) {
        Ok(s) => s,
        Err(code) => return code,
    };
    ffi::mcp_connect(id).map(|_| 0).unwrap_or_else(err_to_code)
}

#[no_mangle]
pub unsafe extern "C" fn ctrl_native_mcp_list_tools(
    server_id: *const c_char,
    out: *mut *mut c_char,
) -> i32 {
    let id = match cstr_to_string(server_id) {
        Ok(s) => s,
        Err(code) => return code,
    };
    match ffi::mcp_list_tools(id) {
        Ok(s) => out_string(s, out),
        Err(e) => err_to_code(e),
    }
}

#[no_mangle]
pub unsafe extern "C" fn ctrl_native_mcp_invoke(
    server_id: *const c_char,
    tool_name: *const c_char,
    arguments_json: *const c_char,
    out: *mut *mut c_char,
) -> i32 {
    let id = match cstr_to_string(server_id) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let tool = match cstr_to_string(tool_name) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let args = match cstr_to_string(arguments_json) {
        Ok(s) => s,
        Err(code) => return code,
    };
    match ffi::mcp_invoke(id, tool, args) {
        Ok(s) => out_string(s, out),
        Err(e) => err_to_code(e),
    }
}

#[no_mangle]
pub unsafe extern "C" fn ctrl_native_mcp_list_installed(out: *mut *mut c_char) -> i32 {
    match ffi::mcp_list_installed() {
        Ok(s) => out_string(s, out),
        Err(e) => err_to_code(e),
    }
}

#[no_mangle]
pub unsafe extern "C" fn ctrl_native_mcp_disconnect(server_id: *const c_char) -> i32 {
    let id = match cstr_to_string(server_id) {
        Ok(s) => s,
        Err(code) => return code,
    };
    ffi::mcp_disconnect(id).map(|_| 0).unwrap_or_else(err_to_code)
}
