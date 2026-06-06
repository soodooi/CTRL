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
//! Amended 2026-05-28: ADR-006 cross-cutting § byok-no-claude v1's "Anthropic absent" lock only governed
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
    // bao 2026-06-05 audit close-out: KNOWN_PROVIDERS is now 1:1 with
    // registry.rs BUILTIN_MANIFESTS (7 entries each). Duplicates removed:
    //   * `openai` (legacy) merged into `openai-api`
    //   * `gemini` (legacy OpenAI-compat path) merged into `google` (native path)
    //   * `minimax` removed — registry has no builtin/minimax.toml,
    //     PWA could save key but kernel could not route. Confusing.
    //   * `groq` removed — same reason as minimax
    // Anthropic / claude-cli were already dropped earlier per drop directive.
    // Real fixes per audit truth check:
    //   * kimi default_model "kimi-k1-8k" did not exist on Moonshot's API
    //     -> "moonshot-v1-8k" (the actual current model id).
    //   * ollama default_model qwen2.5 swapped to hermes3:8b earlier.
    KnownProvider {
        name: "volc",
        display_name: "Volcano Ark (Doubao)",
        default_base_url: "https://ark.cn-beijing.volces.com/api/v3",
        default_model: "doubao-1-5-pro-32k-250115",
    },
    KnownProvider {
        name: "volc-byok",
        display_name: "Volcano Ark (your key)",
        default_base_url: "https://ark.cn-beijing.volces.com/api/v3",
        default_model: "doubao-1-5-pro-32k-250115",
    },
    KnownProvider {
        name: "ollama",
        display_name: "Ollama (local)",
        default_base_url: "http://localhost:11434/v1",
        default_model: "hermes3:8b",
    },
    KnownProvider {
        name: "openai-api",
        display_name: "OpenAI (BYOK)",
        default_base_url: "https://api.openai.com/v1",
        default_model: "gpt-4o-mini",
    },
    KnownProvider {
        name: "deepseek",
        display_name: "DeepSeek (BYOK)",
        default_base_url: "https://api.deepseek.com/v1",
        default_model: "deepseek-chat",
    },
    KnownProvider {
        name: "kimi",
        display_name: "Kimi (BYOK)",
        default_base_url: "https://api.moonshot.cn/v1",
        default_model: "moonshot-v1-8k",
    },
    KnownProvider {
        name: "google",
        display_name: "Google AI Studio (BYOK)",
        default_base_url: "https://generativelanguage.googleapis.com/v1beta",
        default_model: "gemini-2.5-flash",
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
            "ollama" => config.providers.ollama.clone(),
            "deepseek" => config.providers.deepseek.clone(),
            // bao 2026-06-05 audit: openai / gemini / minimax / groq /
            // anthropic / claude-cli all removed from KNOWN_PROVIDERS so
            // their match arms here too. New rows (volc-byok / openai-api
            // / kimi / google) have no legacy config.toml mirror — they
            // live keychain-only, which the kernel registry resolver
            // already supports.
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
    /// bao 2026-06-05 e: free-form provider UX. PWA AddModal sends these.
    #[serde(default)]
    pub display_name: Option<String>,
    /// "openai" (OpenAI-compatible chat completions) or "anthropic"
    /// (Anthropic Messages API). Defaults to "openai" when unset since
    /// most BYOK providers (Volc / DeepSeek / Kimi / Moonshot / etc) are
    /// OpenAI-compatible.
    #[serde(default)]
    pub api_protocol: Option<String>,
}

/// Set (or update) a user provider — bao 2026-06-05 e refactor.
///
/// Free-form: any user-chosen slug (sanitized to [a-z0-9-]) becomes the
/// provider id. Backend writes a manifest at `~/.ctrl/providers/<slug>.toml`
/// (parsed by the kernel registry on every boot) plus the API key into
/// the macOS Keychain via the `security` CLI subprocess helper.
///
/// Replaces the old "pick from 7 hardcoded KNOWN_PROVIDERS" flow that
/// matched no industry pattern. Users now add OpenRouter / Together /
/// Anyscale / their internal proxy / etc with no kernel changes.
#[tauri::command]
pub async fn config_set_provider_key(args: SetProviderKeyArgs) -> Result<(), String> {
    let slug = sanitize_slug(&args.provider)?;
    // bao 2026-06-06 UX: in Edit mode the user may leave the api_key
    // field empty to keep the existing keychain entry. Only require a
    // value when no entry exists for this slug yet (= Add) or when the
    // user typed something to replace it.
    let key_provided = !args.api_key.trim().is_empty();
    if !key_provided {
        let existing = crate::shell::credential_vault::get(&slug)?;
        if existing.is_none() {
            return Err("api_key is required for a new provider".into());
        }
        // Else: keep the existing key, only rewrite the manifest below.
    }
    let display_name = args
        .display_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&slug)
        .to_string();
    let base_url = args
        .base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "base_url is required".to_string())?
        .trim_end_matches('/')
        .to_string();
    let default_model = args
        .default_model
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("")
        .to_string();
    let shape = match args.api_protocol.as_deref().unwrap_or("openai") {
        "anthropic" | "anthropic-messages" => "anthropic_messages",
        _ => "openai_chat_completions",
    };

    // 1) Keychain via `security` subprocess helper (works in signed CTRL.app).
    if key_provided {
        crate::shell::credential_vault::set(&slug, &args.api_key)?;
        let readback = crate::shell::credential_vault::get(&slug)?;
        if readback.as_deref() != Some(args.api_key.as_str()) {
            return Err(format!(
                "keychain readback mismatch: wrote {} bytes, read back {}",
                args.api_key.len(),
                readback.as_deref().map(|s| s.len()).unwrap_or(0)
            ));
        }
    }

    // 2) User manifest TOML at ~/.ctrl/providers/<slug>.toml. The kernel
    //    registry scans this dir at boot + on demand, so the manifest
    //    becomes visible without a separate "install" step.
    let providers_dir = match crate::kernel::provider::manifest::default_user_providers_dir() {
        Some(p) => p,
        None => return Err("HOME unavailable — cannot resolve ~/.ctrl/providers/".into()),
    };
    std::fs::create_dir_all(&providers_dir)
        .map_err(|e| format!("mkdir {}: {e}", providers_dir.display()))?;
    let manifest_path = providers_dir.join(format!("{slug}.toml"));
    let model_line = if default_model.is_empty() {
        String::new()
    } else {
        format!("models = [\"{default_model}\"]\n")
    };
    let manifest_body = format!(
        "# CTRL user provider — written by config_set_provider_key.\n\
        # Edit by re-saving from PWA Settings -> Providers, or delete this\n\
        # file + the keychain entry (`security delete-generic-password\n\
        # -s app.ctrl.spike -a {slug}`).\n\
        id = \"{slug}\"\n\
        label = \"{label}\"\n\
        kind = \"http_api\"\n\
        shape = \"{shape}\"\n\
        endpoint = \"{base_url}\"\n\
        {model_line}description = \"User-added BYOK provider.\"\n\
        capabilities = [\"text.chat\"]\n\
        \n\
        [auth]\n\
        source = \"keychain\"\n\
        account = \"{slug}\"\n",
        slug = slug,
        label = display_name.replace('"', "\\\""),
        shape = shape,
        base_url = base_url,
        model_line = model_line,
    );
    write_atomic(&manifest_path, &manifest_body)?;

    tracing::info!(provider = %slug, "config_set_provider_key ok");
    let _ = default_model; // suppress unused warning when model line empty
    return Ok(());

    // Dead code below intentionally retained to keep the existing
    // legacy update_config_toml signature compiling without further
    // edits this turn. None of the lines after the explicit `return`
    // above can run.
    #[allow(unreachable_code)]
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
    // bao 2026-06-06 e fix: 3 delete bugs found.
    //   1) lookup_known_provider() rejected user-created slugs (volc-doubao
    //      etc.) because they are not in the legacy KNOWN_PROVIDERS array
    //      — Delete silently no-op'd from the user's POV. Drop the lookup;
    //      accept any sanitized slug.
    //   2) keyring crate apple-native silently non-persists in signed app
    //      (same root cause as the Save path). Use the subprocess helper.
    //   3) Old impl only touched legacy ~/.ctrl/config.toml; new providers
    //      live at ~/.ctrl/providers/<slug>.toml and were never deleted,
    //      so the registry's reload_user_dir resurrected them on next
    //      provider_list call. Delete the manifest file too.
    let slug = sanitize_slug(&args.provider)?;

    // 1) Keychain via `security` CLI subprocess (idempotent: helper treats
    //    "not found" as Ok).
    crate::shell::credential_vault::delete(&slug)?;

    // 2) User manifest file at ~/.ctrl/providers/<slug>.toml.
    if let Some(providers_dir) =
        crate::kernel::provider::manifest::default_user_providers_dir()
    {
        let manifest_path = providers_dir.join(format!("{slug}.toml"));
        if manifest_path.exists() {
            std::fs::remove_file(&manifest_path).map_err(|e| {
                format!("rm {}: {e}", manifest_path.display())
            })?;
        }
    }

    // 3) Legacy ~/.ctrl/config.toml [providers.<name>] block — best-effort
    //    cleanup for users migrating from the pre-refactor schema. Silent
    //    when nothing's there.
    if let Some(path) = default_config_path() {
        if path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(mut doc) = toml::from_str::<toml::Value>(&raw) {
                    let mut changed = false;
                    if let Some(providers) = doc
                        .as_table_mut()
                        .and_then(|t| t.get_mut("providers"))
                        .and_then(|v| v.as_table_mut())
                    {
                        if providers.remove(&slug).is_some() {
                            changed = true;
                        }
                    }
                    if changed {
                        if let Ok(serialized) = toml::to_string_pretty(&doc) {
                            let _ = write_atomic(&path, &serialized);
                        }
                    }
                }
            }
        }
    }

    tracing::info!(provider = %slug, "config_delete_provider ok");
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Sanitize a user-supplied provider id. Accepts lowercased alphanumeric +
/// `-` `_`. Replaces other chars with `-`, collapses runs, trims edges.
/// Empty after sanitization = error.
fn sanitize_slug(raw: &str) -> Result<String, String> {
    let mut out = String::with_capacity(raw.len());
    let mut prev_dash = true; // suppresses leading dashes
    for ch in raw.chars() {
        let c = ch.to_ascii_lowercase();
        let keep = c.is_ascii_alphanumeric() || c == '-' || c == '_';
        if keep {
            out.push(c);
            prev_dash = c == '-';
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        Err(format!("provider id {:?} sanitizes to empty", raw))
    } else if out.len() > 64 {
        Err(format!("provider id too long ({} chars, max 64)", out.len()))
    } else {
        Ok(out)
    }
}

#[allow(dead_code)]
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
