// Headless kernel — boots the L1 runtime and serves the :17873 gate (with the
// dev-only /debug endpoints in debug builds) WITHOUT the Tauri window. For CI +
// autonomous smoke tests (scripts/debug/), and local testing when the desktop app
// isn't running. NOT part of the shipped app bundle.
//
// Usage:
//   cargo run --manifest-path src-tauri/Cargo.toml --bin ctrl_kernel
//   CTRL_KERNEL_ADDR=127.0.0.1:17999 cargo run ... --bin ctrl_kernel   (alt port)
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let runtime = Arc::new(
        ctrl_lib::kernel::runtime::KernelRuntime::boot_default()
            .map_err(|e| anyhow::anyhow!("kernel boot failed: {e:?}"))?,
    );
    let addr = std::env::var("CTRL_KERNEL_ADDR").unwrap_or_else(|_| "127.0.0.1:17873".to_string());
    let handle = ctrl_lib::kernel::mcp_server::serve(runtime, None, &addr).await?;
    eprintln!("headless kernel: gate on http://{addr}/mcp (kill the process to stop)");
    // Keep the process (and the served gate) alive until the process is killed.
    let _ = handle;
    std::future::pending::<()>().await;
    Ok(())
}
