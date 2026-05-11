// Sandbox — WASM-based isolation for L3 userland actors.
//
// Uses wasmtime as the runtime. Capability injection via host import table:
// each WASM instance only sees host functions corresponding to its declared
// Capability tokens. No ambient authority.
//
// P2.1 skeleton — full sandbox runtime in P2.7. v1 launch may skip WASM
// for first-party keycaps (per ADR-001 §11 deferred decisions), but the
// type surface is reserved here.

use crate::kernel::capability::Capability;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub memory_mb: u32,
    pub fuel: u64,
    pub deadline_ms: u64,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            memory_mb: 64,
            fuel: 10_000_000,
            deadline_ms: 30_000,
        }
    }
}

pub struct WasmSandbox {
    pub config: SandboxConfig,
    pub capability: Capability,
}

impl WasmSandbox {
    pub fn new(config: SandboxConfig, capability: Capability) -> Self {
        Self { config, capability }
    }
}
