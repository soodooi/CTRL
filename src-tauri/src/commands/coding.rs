// commands/coding — Pi binary path resolver.
//
// ADR-002 substrate § brain v13 (2026-06-07, retracts v11 §3.11): the
// Coding L1 chip spawns Pi natively via cs_spawn with no provider
// wrapper. Pi reads its own ~/.pi/agent/models.json + settings.json to
// pick provider, model, and skills — CTRL does not pre-resolve them.
//
// All this Tauri command does is tell the PWA the absolute path of the
// bundled Pi binary (~/.ctrl/pi/node_modules/.bin/pi), since the PWA
// cannot expand ~ or read $HOME. Everything else is Pi-native.
//
// bao 2026-06-07 calibration "use what Pi already provides": the
// coding.primary SSOT slot, CodingSpawnSpec, credential injection,
// fallback chain, and inline error page are all REMOVED. Pi already
// does these. ADR-002 v13 records the retract.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PiBinaryPath {
    /// Absolute path to the bundled `pi` CLI. Falls back to "pi" (PATH
    /// lookup) when the bundled install hasn't been provisioned yet.
    pub path: String,
}

#[tauri::command]
pub fn pi_binary_path() -> PiBinaryPath {
    PiBinaryPath {
        path: resolve_pi_path(),
    }
}

fn resolve_pi_path() -> String {
    if let Some(home) = std::env::var_os("HOME") {
        let bundled = std::path::PathBuf::from(home)
            .join(".ctrl")
            .join("pi")
            .join("node_modules")
            .join(".bin")
            .join("pi");
        if bundled.exists() {
            return bundled.to_string_lossy().into_owned();
        }
    }
    "pi".to_string()
}
