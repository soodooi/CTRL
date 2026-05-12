// FFI module — exposes Rust kernel to platform-native UIs:
//   * UniFFI bindings (Swift / Kotlin / Python via Mozilla official)  — see ctrl.udl
//   * Raw C ABI for C# / C++ (cbindgen → ctrl_native.h)               — see ffi/native.rs
//
// Both paths call into the same sync wrappers defined here. UI shells call
// platform-appropriate binding; Rust core block_on's a Tokio runtime
// internally to drive async kernel methods.

pub mod native;

use crate::kernel::mcp_host::McpServerDescriptor;
use crate::kernel::runtime::KernelRuntime;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::runtime::Runtime as TokioRuntime;

// Global kernel runtime + Tokio executor for async FFI calls.
// One-time initialization in `kernel_boot`. UI calls block_on() the Tokio
// runtime to drive async kernel methods from the sync FFI surface.
static KERNEL: OnceLock<Arc<KernelRuntime>> = OnceLock::new();
static TOKIO: OnceLock<TokioRuntime> = OnceLock::new();

#[derive(Debug, Clone, thiserror::Error)]
pub enum KernelError {
    #[error("kernel not initialized; call kernel_boot first")]
    NotInitialized,
    #[error("kernel already initialized")]
    AlreadyInitialized,
    #[error("kernel boot failed: {0}")]
    BootFailed(String),
    #[error("mcp error: {0}")]
    McpError(String),
    #[error("internal error: {0}")]
    InternalError(String),
}

impl From<crate::kernel::mcp_host::McpHostError> for KernelError {
    fn from(e: crate::kernel::mcp_host::McpHostError) -> Self {
        KernelError::McpError(e.to_string())
    }
}

impl From<crate::kernel::runtime::KernelBootError> for KernelError {
    fn from(e: crate::kernel::runtime::KernelBootError) -> Self {
        KernelError::BootFailed(e.to_string())
    }
}

#[derive(Debug, Serialize)]
struct HealthSnapshot {
    ok: bool,
    mcp_servers_registered: usize,
    note: &'static str,
}

fn kernel() -> Result<Arc<KernelRuntime>, KernelError> {
    KERNEL.get().cloned().ok_or(KernelError::NotInitialized)
}

fn tokio_rt() -> Result<&'static TokioRuntime, KernelError> {
    TOKIO.get().ok_or(KernelError::NotInitialized)
}

// -- FFI entry points (sync, called by WinUI / SwiftUI via uniffi stubs) --

pub fn kernel_boot(data_dir: String) -> Result<(), KernelError> {
    if KERNEL.get().is_some() {
        return Err(KernelError::AlreadyInitialized);
    }
    let rt = KernelRuntime::boot(PathBuf::from(data_dir))?;
    KERNEL
        .set(Arc::new(rt))
        .map_err(|_| KernelError::AlreadyInitialized)?;

    let tokio_rt = TokioRuntime::new().map_err(|e| KernelError::BootFailed(e.to_string()))?;
    let _ = TOKIO.set(tokio_rt);
    Ok(())
}

pub fn kernel_health() -> Result<String, KernelError> {
    let k = kernel()?;
    let rt = tokio_rt()?;
    let installed = rt.block_on(k.mcp_host.list_installed());
    let snap = HealthSnapshot {
        ok: true,
        mcp_servers_registered: installed.len(),
        note: "L1 Kernel online via UniFFI bridge",
    };
    serde_json::to_string(&snap).map_err(|e| KernelError::InternalError(e.to_string()))
}

pub fn mcp_register(descriptor_json: String) -> Result<(), KernelError> {
    let k = kernel()?;
    let rt = tokio_rt()?;
    let desc: McpServerDescriptor = serde_json::from_str(&descriptor_json)
        .map_err(|e| KernelError::InternalError(e.to_string()))?;
    rt.block_on(k.mcp_host.register(desc));
    Ok(())
}

pub fn mcp_connect(server_id: String) -> Result<(), KernelError> {
    let k = kernel()?;
    let rt = tokio_rt()?;
    rt.block_on(k.mcp_host.connect(&server_id))
        .map_err(Into::into)
}

pub fn mcp_list_tools(server_id: String) -> Result<String, KernelError> {
    let k = kernel()?;
    let rt = tokio_rt()?;
    let tools = rt.block_on(k.mcp_host.list_tools(&server_id))?;
    serde_json::to_string(&tools).map_err(|e| KernelError::InternalError(e.to_string()))
}

pub fn mcp_invoke(
    server_id: String,
    tool_name: String,
    arguments_json: String,
) -> Result<String, KernelError> {
    let k = kernel()?;
    let rt = tokio_rt()?;
    let args: serde_json::Value = serde_json::from_str(&arguments_json)
        .map_err(|e| KernelError::InternalError(e.to_string()))?;
    let result = rt.block_on(k.mcp_host.invoke(&server_id, &tool_name, args))?;
    serde_json::to_string(&result).map_err(|e| KernelError::InternalError(e.to_string()))
}

pub fn mcp_list_installed() -> Result<String, KernelError> {
    let k = kernel()?;
    let rt = tokio_rt()?;
    let installed = rt.block_on(k.mcp_host.list_installed());
    serde_json::to_string(&installed).map_err(|e| KernelError::InternalError(e.to_string()))
}

pub fn mcp_disconnect(server_id: String) -> Result<(), KernelError> {
    let k = kernel()?;
    let rt = tokio_rt()?;
    rt.block_on(k.mcp_host.disconnect(&server_id))
        .map_err(Into::into)
}
