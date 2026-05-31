//! Tauri command surface for `~/.ctrl/config.toml` provider configuration.
//!
//! Bao asked (2026-05-24) for a Settings → Provider tab in PWA; daedalus
//! builds the UI but the kernel needs typed commands that wrap the same
//! logic `bin/setup_llm_key` did at the CLI:
//!
//!   1. write API key to macOS Keychain (service `app.ctrl.spike`, account = provider name)
//!   2. update `~/.ctrl/config.toml` `[providers.<name>]` entry (api_key + optional base_url + default_model)
//!
//! Why not let PWA `fs_write` config.toml + `keychain_store_key`?
//! - Hand-edited TOML round-trip is error-prone (escape, array of tables, comment loss).
//! - keychain set requires Security framework access (Rust side only).
//! - Capability gating: `fs_write` on the whole vault is too coarse; typed
//!   commands let the broker gate `config.write` specifically.
//!
//! Amended 2026-05-28: ADR-005's "Anthropic absent" lock only governed
//! the default-shipped CTRL runtime — BYOK Anthropic + `claude` CLI
//! subscription paths are first-class once the user opts in. This
//! surface enumerates every provider the kernel's llm_adapters/mod.rs
//! knows how to register; UI gates whether the user wants to fill any.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use std::time::Instant;

use crate::kernel::provider::legacy_config::{
    default_config_path, load_from, ProviderEntry,
};

const KEYRING_SERVICE: &str = "app.ctrl.spike";

/// Providers the kernel knows how to register adapters for. Adding a
/// new provider here is intentional: it surfaces in PWA Settings and
/// must have a matching branch in `llm_adapters::register_default_adapters`.
const KNOWN_PROVIDERS: &[KnownProvider] = &[
    KnownProvider {
        name: "volc",
        display_name: "Volcano Ark (Doubao)",
        default_base_url: "https://ark.cn-beijing.volces.com/api/v3",
        default_model: "doubao-1-5-pro-32k-250115",
    },
    KnownProvider {
        name: "openai",
        display_name: "OpenAI",
        default_base_url: "https://api.openai.com/v1",
        default_model: "gpt-4o-mini",
    },
    KnownProvider {
        name: "ollama",
        display_name: "Ollama (local)",
        default_base_url: "http://localhost:11434/v1",
        default_model: "qwen2.5",
    },
    KnownProvider {
        name: "minimax",
        display_name: "MiniMax (BYOK)",
        default_base_url: "https://api.minimax.chat/v1",
        default_model: "MiniMax-Text-01",
    },
    KnownProvider {
        name: "anthropic",
        display_name: "Anthropic (BYOK API key)",
        default_base_url: "https://api.anthropic.com",
        default_model: "claude-sonnet-4-6-fast",
    },
    KnownProvider {
        name: "deepseek",
        display_name: "DeepSeek (BYOK)",
        default_base_url: "https://api.deepseek.com/v1",
        default_model: "deepseek-chat",
    },
    KnownProvider {
        name: "gemini",
        display_name: "Google Gemini (BYOK)",
        default_base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        default_model: "gemini-2.5-flash",
    },
    KnownProvider {
        name: "groq",
        display_name: "Groq (BYOK)",
        default_base_url: "https://api.groq.com/openai/v1",
        default_model: "llama-3.3-70b-versatile",
    },
    KnownProvider {
        name: "claude-cli",
        display_name: "Claude CLI (subscription)",
        // base_url is N/A for the CLI subprocess adapter; placeholder
        // here keeps the KnownProvider struct uniform. The PWA Settings
        // panel should render this row with a "Detected at: <path>" hint
        // instead of an editable base_url field.
        default_base_url: "subprocess://claude",
        default_model: "sonnet",
    },
];

#[derive(Debug, Clone, Copy)]
struct KnownProvider {
    name: &'static str,
    display_name: &'static str,
    default_base_url: &'static str,
    default_model: &'static str,
}

#[derive(Debug, Serialize)]
pub struct ProviderInfo {
    pub name: String,
    pub display_name: String,
    pub base_url: String,
    pub default_model: String,
    /// `api_key` field present and non-empty in `~/.ctrl/config.toml`.
    pub has_key_in_config: bool,
    /// `keyring::Entry::new(KEYRING_SERVICE, name).get_password()` succeeds.
    pub has_key_in_keychain: bool,
    /// True iff a key is reachable from either source = adapter would
    /// register on next kernel boot.
    pub is_active: bool,
}

/// Read `~/.ctrl/config.toml` + Keychain, return a `ProviderInfo` per
/// known provider. PWA Settings → Provider tab uses this to render the
/// list with per-provider status badges.
#[tauri::command]
pub async fn config_list_providers() -> Result<Vec<ProviderInfo>, String> {
    let config = match default_config_path() {
        Some(p) => load_from(&p).unwrap_or_default(),
        None => Default::default(),
    };

    let mut out = Vec::with_capacity(KNOWN_PROVIDERS.len());
    for known in KNOWN_PROVIDERS {
        let entry: Option<ProviderEntry> = match known.name {
            "volc" => config.providers.volc.clone(),
            "openai" => config.providers.openai.clone(),
            "ollama" => config.providers.ollama.clone(),
            "minimax" => config.providers.minimax.clone(),
            "anthropic" => config.providers.anthropic.clone(),
            "deepseek" => config.providers.deepseek.clone(),
            "gemini" => config.providers.gemini.clone(),
            "groq" => config.providers.groq.clone(),
            "claude-cli" => config.providers.claude_cli.clone(),
            _ => None,
        };
        let (base_url, default_model, has_key_in_config) = match &entry {
            Some(e) => (
                if e.base_url.is_empty() { known.default_base_url.to_string() } else { e.base_url.clone() },
                if e.default_model.is_empty() { known.default_model.to_string() } else { e.default_model.clone() },
                !e.api_key.trim().is_empty(),
            ),
            None => (
                known.default_base_url.to_string(),
                known.default_model.to_string(),
                false,
            ),
        };
        let has_key_in_keychain = keyring_has_password(known.name);
        out.push(ProviderInfo {
            name: known.name.to_string(),
            display_name: known.display_name.to_string(),
            base_url,
            default_model,
            has_key_in_config,
            has_key_in_keychain,
            is_active: has_key_in_config || has_key_in_keychain,
        });
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
pub struct SetProviderKeyArgs {
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub default_model: Option<String>,
}

/// Set (or update) the API key + optional overrides for a provider.
///
/// Dual-write semantics (intentional, matches `bin/setup_llm_key` + the
/// boot-time adapter loader): keychain gets the secret, config.toml gets
/// the structured entry. On the next CTRL restart the adapter loader
/// finds the key in config.toml first (preferred path); the keychain is
/// the fallback / legacy path. Keeping both in sync means no
/// "configured-but-not-active" footgun.
#[tauri::command]
pub async fn config_set_provider_key(args: SetProviderKeyArgs) -> Result<(), String> {
    let known = lookup_known_provider(&args.provider)?;
    if args.api_key.trim().is_empty() {
        return Err("api_key cannot be empty — use config_delete_provider to remove".into());
    }

    // 1) Keychain — mirror what setup_llm_key does so the keyring entry
    //    matches the runtime read path's ACL expectations.
    let entry = keyring::Entry::new(KEYRING_SERVICE, &args.provider)
        .map_err(|e| format!("keyring entry: {e}"))?;
    entry
        .set_password(&args.api_key)
        .map_err(|e| format!("keyring write: {e}"))?;
    // Read-back verification — if write succeeded but read errored, the
    // adapter loader's keychain fallback would silently fail at boot.
    entry
        .get_password()
        .map_err(|e| format!("keyring readback: {e}"))?;

    // 2) config.toml — round-trip via `toml::Value` so we never corrupt
    //    unrelated sections the user (or another keycap) may have added.
    let base_url = args
        .base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| known.default_base_url.to_string());
    let default_model = args
        .default_model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| known.default_model.to_string());

    update_config_toml(&args.provider, |entry_table| {
        entry_table.insert(
            "api_key".to_string(),
            toml::Value::String(args.api_key.clone()),
        );
        entry_table.insert("base_url".to_string(), toml::Value::String(base_url.clone()));
        entry_table.insert(
            "default_model".to_string(),
            toml::Value::String(default_model.clone()),
        );
        // `enabled` is deprecated (see local_config.rs ProviderEntry doc);
        // we explicitly do NOT write it so the user's file stays clean.
    })?;

    tracing::info!(provider = %args.provider, "config_set_provider_key ok");
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct TestProviderArgs {
    pub provider: String,
}

#[derive(Debug, Serialize)]
pub struct TestProviderResult {
    pub success: bool,
    pub message: String,
    pub elapsed_ms: u64,
    pub model_count: Option<usize>,
}

/// Smoke-test a provider's key by calling its OpenAI-shape `/models`
/// endpoint with the configured Bearer key. 5-second timeout — PWA shows
/// the result in the Settings panel.
///
/// Uses the key from config.toml first, falls back to keychain — mirrors
/// the boot-time precedence so "test passes here" ⇒ "adapter will load".
#[tauri::command]
pub async fn config_test_provider(
    args: TestProviderArgs,
) -> Result<TestProviderResult, String> {
    let known = lookup_known_provider(&args.provider)?;
    let started = Instant::now();

    let (api_key, base_url) = resolve_credentials(&args.provider, known)?;
    if api_key.is_empty() {
        return Ok(TestProviderResult {
            success: false,
            message: "no api_key configured (config.toml + keychain both empty)".into(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            model_count: None,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("reqwest client: {e}"))?;
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let resp = match client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(TestProviderResult {
                success: false,
                message: format!("request failed: {e}"),
                elapsed_ms: started.elapsed().as_millis() as u64,
                model_count: None,
            });
        }
    };

    let status = resp.status();
    let elapsed_ms = started.elapsed().as_millis() as u64;
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(TestProviderResult {
            success: false,
            message: format!("HTTP {status}: {}", body.chars().take(200).collect::<String>()),
            elapsed_ms,
            model_count: None,
        });
    }
    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return Ok(TestProviderResult {
                success: false,
                message: format!("response body not JSON: {e}"),
                elapsed_ms,
                model_count: None,
            });
        }
    };
    let model_count = body
        .get("data")
        .and_then(|v| v.as_array())
        .map(|a| a.len());
    Ok(TestProviderResult {
        success: true,
        message: format!("HTTP {status} · {}", url),
        elapsed_ms,
        model_count,
    })
}

#[derive(Debug, Deserialize)]
pub struct DeleteProviderArgs {
    pub provider: String,
}

/// Remove a provider's credentials: clear keychain entry + remove the
/// `[providers.<name>]` block from config.toml. Idempotent — silent when
/// nothing's there.
#[tauri::command]
pub async fn config_delete_provider(args: DeleteProviderArgs) -> Result<(), String> {
    let _ = lookup_known_provider(&args.provider)?;

    // 1) Keychain — `delete_password` errors when entry doesn't exist; we
    //    treat both Ok and NotFound as success (idempotent).
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &args.provider) {
        let _ = entry.delete_credential();
    }

    // 2) config.toml — drop the [providers.<name>] block entirely.
    let path = match default_config_path() {
        Some(p) => p,
        None => return Ok(()), // HOME unset = no config to mutate
    };
    if !path.exists() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read config.toml: {e}"))?;
    let mut doc: toml::Value =
        toml::from_str(&raw).map_err(|e| format!("parse config.toml: {e}"))?;
    if let Some(providers) = doc
        .as_table_mut()
        .and_then(|t| t.get_mut("providers"))
        .and_then(|v| v.as_table_mut())
    {
        providers.remove(&args.provider);
    }
    let serialized =
        toml::to_string_pretty(&doc).map_err(|e| format!("serialize config.toml: {e}"))?;
    write_atomic(&path, &serialized)?;
    tracing::info!(provider = %args.provider, "config_delete_provider ok");
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn lookup_known_provider(name: &str) -> Result<&'static KnownProvider, String> {
    KNOWN_PROVIDERS
        .iter()
        .find(|k| k.name == name)
        .ok_or_else(|| {
            let known: Vec<&str> = KNOWN_PROVIDERS.iter().map(|k| k.name).collect();
            format!(
                "unknown provider {name:?}; supported: {}",
                known.join(", ")
            )
        })
}

fn keyring_has_password(account: &str) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

/// Resolve the credentials adapter loader uses: config.toml api_key
/// takes precedence; falls back to keychain. Matches kernel boot-time
/// precedence in llm_adapters/mod.rs so "test passes" ⇒ "next boot loads
/// the adapter".
fn resolve_credentials(
    provider: &str,
    known: &KnownProvider,
) -> Result<(String, String), String> {
    let cfg = default_config_path()
        .and_then(|p| load_from(&p))
        .unwrap_or_default();
    let entry: Option<ProviderEntry> = match provider {
        "volc" => cfg.providers.volc,
        "openai" => cfg.providers.openai,
        "ollama" => cfg.providers.ollama,
        "minimax" => cfg.providers.minimax,
        "anthropic" => cfg.providers.anthropic,
        "deepseek" => cfg.providers.deepseek,
        "gemini" => cfg.providers.gemini,
        "groq" => cfg.providers.groq,
        "claude-cli" => cfg.providers.claude_cli,
        _ => None,
    };
    let mut api_key = entry
        .as_ref()
        .map(|e| e.api_key.clone())
        .unwrap_or_default();
    let base_url = entry
        .as_ref()
        .map(|e| e.base_url.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| known.default_base_url.to_string());
    if api_key.trim().is_empty() {
        api_key = keyring::Entry::new(KEYRING_SERVICE, provider)
            .ok()
            .and_then(|e| e.get_password().ok())
            .unwrap_or_default();
    }
    Ok((api_key, base_url))
}

/// Round-trip `~/.ctrl/config.toml`, applying `mutator` to the named
/// provider's table. Creates the file (and `[providers]` table) if
/// missing. Atomic write via tmp + rename.
fn update_config_toml(
    provider: &str,
    mutator: impl FnOnce(&mut toml::map::Map<String, toml::Value>),
) -> Result<(), String> {
    let path = default_config_path().ok_or_else(|| "HOME env var not set".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml::Value = if raw.trim().is_empty() {
        toml::Value::Table(toml::map::Map::new())
    } else {
        toml::from_str(&raw).map_err(|e| format!("parse config.toml: {e}"))?
    };

    let root = doc
        .as_table_mut()
        .ok_or_else(|| "config.toml root is not a table".to_string())?;
    let providers = root
        .entry("providers".to_string())
        .or_insert(toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| "config.toml [providers] is not a table".to_string())?;
    let entry_table = providers
        .entry(provider.to_string())
        .or_insert(toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| format!("config.toml [providers.{provider}] is not a table"))?;
    mutator(entry_table);

    let serialized =
        toml::to_string_pretty(&doc).map_err(|e| format!("serialize config.toml: {e}"))?;
    write_atomic(&path, &serialized)?;
    Ok(())
}

fn write_atomic(path: &PathBuf, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write {tmp:?}: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))?;
    Ok(())
}
