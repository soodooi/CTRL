// Launch the source-pinned Hermes ACP release probe with CTRL's active BYOK
// provider credential. The credential is resolved by the production registry
// and exists only in the exact Node probe subprocess environment; it is never
// printed, passed through argv, or written by this launcher.
// (ADR-002 substrate § provider v68; ADR-004 cap § updater v9)

use std::{
    path::{Path, PathBuf},
    process::{Command, ExitCode, Stdio},
};

const SAFE_PARENT_ENV: [&str; 9] = [
    "HOME",
    "PATH",
    "TMPDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "UV_CACHE_DIR",
];

struct EphemeralHermesHome(PathBuf);

impl EphemeralHermesHome {
    fn create() -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("ctrl-hermes-probe-{}", std::process::id()));
        std::fs::create_dir(&path)
            .map_err(|error| format!("create isolated Hermes home {}: {error}", path.display()))?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for EphemeralHermesHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn main() -> ExitCode {
    let registry = ctrl_lib::kernel::provider::ProviderRegistry::load();
    let provider_env = registry.agent_probe_env();
    let runtime_complete = match provider_env
        .get("HERMES_INFERENCE_PROVIDER")
        .map(String::as_str)
    {
        Some("anthropic") => provider_env.contains_key("ANTHROPIC_API_KEY"),
        Some("openrouter") => provider_env.contains_key("OPENROUTER_API_KEY"),
        Some("custom") => provider_env.contains_key("OPENAI_API_KEY"),
        _ => false,
    };
    if !runtime_complete || !provider_env.contains_key("HERMES_MODEL") {
        eprintln!("error: the active Irisy provider has no complete BYOK runtime configuration");
        return ExitCode::FAILURE;
    }
    let hermes_home = match EphemeralHermesHome::create() {
        Ok(home) => home,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::FAILURE;
        }
    };

    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a repository parent");
    let script = root.join("scripts/probes/hermes-acp-probe.mjs");
    let node = std::env::var_os("CTRL_NODE_BIN").unwrap_or_else(|| "node".into());

    let mut command = Command::new(node);
    command
        .arg(script)
        .args(std::env::args_os().skip(1))
        .current_dir(root)
        .env_clear()
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    for key in SAFE_PARENT_ENV {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command.env("HERMES_HOME", hermes_home.path());
    command.envs(provider_env);

    match command.status() {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("error: failed to launch Hermes ACP probe: {error}");
            ExitCode::FAILURE
        }
    }
}
