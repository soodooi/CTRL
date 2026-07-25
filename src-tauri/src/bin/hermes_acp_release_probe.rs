// Launch the source-pinned Hermes ACP release probe with CTRL's active BYOK
// provider credential. The credential is resolved by the production registry
// and exists only in the exact Node probe subprocess environment; it is never
// printed, passed through argv, or written by this launcher. Generic custom
// endpoints are named only inside the ephemeral Hermes home so Hermes cannot
// reinterpret an explicit selection through its OpenRouter catalogue.
// (ADR-002 substrate § provider v68; ADR-004 cap § auto-update v10)

use std::{
    collections::BTreeMap,
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

struct EphemeralHermesHome {
    path: Option<PathBuf>,
}

impl EphemeralHermesHome {
    fn create() -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("ctrl-hermes-probe-{}", std::process::id()));
        std::fs::create_dir(&path)
            .map_err(|error| format!("create isolated Hermes home {}: {error}", path.display()))?;
        Ok(Self { path: Some(path) })
    }

    fn path(&self) -> &Path {
        self.path
            .as_deref()
            .expect("Hermes home is available before explicit cleanup")
    }

    fn cleanup(&mut self) -> Result<(), String> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        std::fs::remove_dir_all(path)
            .map_err(|error| format!("remove isolated Hermes home {}: {error}", path.display()))?;
        self.path = None;
        Ok(())
    }
}

impl Drop for EphemeralHermesHome {
    fn drop(&mut self) {
        if let Some(path) = self.path.as_ref() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

#[derive(serde::Serialize)]
struct HermesProbeModel<'a> {
    default: &'a str,
    provider: &'static str,
}

#[derive(serde::Serialize)]
struct HermesProbeProvider<'a> {
    base_url: &'a str,
    key_env: &'static str,
    default_model: &'a str,
    transport: &'static str,
}

#[derive(serde::Serialize)]
struct HermesProbeConfig<'a> {
    model: HermesProbeModel<'a>,
    providers: BTreeMap<&'static str, HermesProbeProvider<'a>>,
}

/// Give Hermes an unambiguous named custom-provider identity without writing
/// the credential. Hermes resolves `key_env` only inside the child process.
/// Normal completion verifies descriptor removal; `Drop` is best-effort for
/// early returns, and abrupt process termination can leave non-secret residue.
/// (ADR-004 cap § auto-update v10)
fn configure_custom_provider(
    home: &Path,
    provider_env: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    if provider_env
        .get("HERMES_INFERENCE_PROVIDER")
        .map(String::as_str)
        != Some("custom")
    {
        return Ok(());
    }

    const PROVIDER_NAME: &str = "ctrl-release-probe";
    let endpoint = provider_env
        .get("CUSTOM_BASE_URL")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| "custom Hermes probe provider has no endpoint".to_string())?;
    let model = provider_env
        .get("HERMES_MODEL")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| "custom Hermes probe provider has no model".to_string())?;

    let mut providers = BTreeMap::new();
    providers.insert(
        PROVIDER_NAME,
        HermesProbeProvider {
            base_url: &endpoint,
            key_env: "OPENAI_API_KEY",
            default_model: &model,
            transport: "chat_completions",
        },
    );
    let config = HermesProbeConfig {
        model: HermesProbeModel {
            default: &model,
            provider: PROVIDER_NAME,
        },
        providers,
    };
    let yaml = serde_yaml::to_string(&config)
        .map_err(|error| format!("serialize isolated Hermes config: {error}"))?;
    std::fs::write(home.join("config.yaml"), yaml)
        .map_err(|error| format!("write isolated Hermes config: {error}"))?;
    provider_env.retain(|_, value| value != &endpoint);
    provider_env.insert(
        "HERMES_ACP_MODEL_ID".into(),
        format!("custom:{PROVIDER_NAME}:{model}"),
    );
    provider_env.insert("HERMES_PROBE_UPSTREAM_BASE_URL".into(), endpoint);
    Ok(())
}

fn main() -> ExitCode {
    let registry = ctrl_lib::kernel::provider::ProviderRegistry::load();
    let mut provider_env = registry.agent_probe_env();
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
    let mut hermes_home = match EphemeralHermesHome::create() {
        Ok(home) => home,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::FAILURE;
        }
    };
    if let Err(error) = configure_custom_provider(hermes_home.path(), &mut provider_env) {
        eprintln!("error: {error}");
        return ExitCode::FAILURE;
    }

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

    let status = command.status();
    if let Err(error) = hermes_home.cleanup() {
        eprintln!("error: {error}");
        return ExitCode::FAILURE;
    }
    match status {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1) as u8),
        Err(error) => {
            eprintln!("error: failed to launch Hermes ACP probe: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_home(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ctrl-hermes-probe-test-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&path).expect("create test home");
        path
    }

    fn custom_env() -> BTreeMap<String, String> {
        BTreeMap::from([
            ("HERMES_INFERENCE_PROVIDER".into(), "custom".into()),
            (
                "CUSTOM_BASE_URL".into(),
                "https://api.example.test/v4".into(),
            ),
            (
                "OPENAI_BASE_URL".into(),
                "https://api.example.test/v4".into(),
            ),
            ("HERMES_MODEL".into(), "glm-test".into()),
            ("OPENAI_API_KEY".into(), "super-secret-probe-key".into()),
        ])
    }

    #[test]
    fn custom_provider_writes_named_non_secret_config_and_exact_model_id() {
        let home = test_home("custom");
        let mut env = custom_env();

        configure_custom_provider(&home, &mut env).expect("configure custom provider");

        let yaml = std::fs::read_to_string(home.join("config.yaml")).expect("read config");
        assert!(yaml.contains("ctrl-release-probe"));
        assert!(yaml.contains("https://api.example.test/v4"));
        assert!(yaml.contains("default_model: glm-test"));
        assert!(yaml.contains("key_env: OPENAI_API_KEY"));
        assert!(yaml.contains("transport: chat_completions"));
        assert!(!yaml.contains("super-secret-probe-key"));
        assert_eq!(
            env.get("HERMES_ACP_MODEL_ID").map(String::as_str),
            Some("custom:ctrl-release-probe:glm-test")
        );
        assert_eq!(
            env.get("HERMES_PROBE_UPSTREAM_BASE_URL")
                .map(String::as_str),
            Some("https://api.example.test/v4")
        );
        assert!(!env.contains_key("CUSTOM_BASE_URL"));
        assert!(!env.contains_key("OPENAI_BASE_URL"));

        std::fs::remove_dir_all(home).expect("remove test home");
    }

    #[test]
    fn standard_providers_do_not_write_custom_config_or_model_override() {
        for provider in ["anthropic", "openrouter"] {
            let home = test_home(provider);
            let mut env = BTreeMap::from([
                ("HERMES_INFERENCE_PROVIDER".into(), provider.into()),
                ("HERMES_MODEL".into(), "model-test".into()),
            ]);

            configure_custom_provider(&home, &mut env).expect("standard provider no-op");

            assert!(!home.join("config.yaml").exists());
            assert!(!env.contains_key("HERMES_ACP_MODEL_ID"));
            std::fs::remove_dir_all(home).expect("remove test home");
        }
    }

    #[test]
    fn custom_provider_rejects_missing_endpoint() {
        let home = test_home("missing-endpoint");
        let mut env = custom_env();
        env.remove("CUSTOM_BASE_URL");

        let error = configure_custom_provider(&home, &mut env).expect_err("missing endpoint fails");

        assert_eq!(error, "custom Hermes probe provider has no endpoint");
        assert!(!home.join("config.yaml").exists());
        std::fs::remove_dir_all(home).expect("remove test home");
    }

    #[test]
    fn custom_provider_rejects_missing_model() {
        let home = test_home("missing-model");
        let mut env = custom_env();
        env.remove("HERMES_MODEL");

        let error = configure_custom_provider(&home, &mut env).expect_err("missing model fails");

        assert_eq!(error, "custom Hermes probe provider has no model");
        assert!(!home.join("config.yaml").exists());
        std::fs::remove_dir_all(home).expect("remove test home");
    }
}
