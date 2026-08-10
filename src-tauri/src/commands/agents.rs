// Hermes provider projection helpers for Irisy's single managed runtime.
// The public chat/session boundary is `irisy_chat_stream`; this module exposes
// no alternate identity, lifecycle, or engine-selection commands.
// (ADR-002 substrate §1 v83; ADR-005 irisy §11 v40)

/// Mirror the active CTRL provider into hermes's own config file
/// (`~/.hermes/.env`). hermes does NOT read injected process env (verified
/// 2026-06-11 — it reports "No inference provider configured" and points to
/// ~/.hermes/.env), so CTRL's unified provider injection (ADR-002 §1.3) is
/// written there instead. Only the key + base_url vars are mirrored;
/// existing user lines are preserved (merge, not clobber). When CTRL has no
/// verified HTTP primary, managed provider keys are removed so Hermes cannot
/// reuse stale credentials. (ADR-002 substrate § provider v71)
pub(crate) fn write_hermes_dotenv(
    env: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    // TAVILY_API_KEY lights up hermes's built-in web_search / web_extract for
    // Irisy. hermes reads it from ~/.hermes/.env (not process env, see the
    // doc above), so it MUST ride this managed-merge or it never reaches the
    // agent — process-env injection alone is silently dropped.
    const MANAGED: [&str; 5] = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "TAVILY_API_KEY",
    ];
    // Even an empty provider environment rewrites the file to remove stale
    // CTRL-managed credentials. (ADR-002 substrate § provider v71)
    let base =
        directories::BaseDirs::new().ok_or_else(|| "could not resolve home dir".to_string())?;
    let dir = base.home_dir().join(".hermes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create ~/.hermes: {e}"))?;
    let path = dir.join(".env");

    // Keep every existing line whose key we do NOT manage, then append ours.
    let mut lines: Vec<String> = Vec::new();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        for line in existing.lines() {
            let is_managed = line
                .split_once('=')
                .map(|(k, _)| MANAGED.contains(&k.trim()))
                .unwrap_or(false);
            if !is_managed {
                lines.push(line.to_string());
            }
        }
    }
    for k in MANAGED {
        if let Some(v) = env.get(k) {
            lines.push(format!("{k}={v}"));
        }
    }
    std::fs::write(&path, format!("{}\n", lines.join("\n")))
        .map_err(|e| format!("write ~/.hermes/.env: {e}"))?;
    Ok(())
}

/// Project the active CTRL provider into `~/.hermes/config.yaml` so
/// Hermes (Irisy's brain) serves chat with the user's chosen model
/// instead of the stale default. Decision 0007 §hermes-sync, 2026-06-19.
///
/// Hermes reads its model + provider config from config.yaml, NOT from
/// the `.env` written by `write_hermes_dotenv` (that file only carries
/// keys for hermes builds that read process env). Without this
/// projection Irisy kept answering "I'm using doubao" even after the
/// user switched to GLM in Settings — two sources of truth drifted.
///
/// What we touch (everything else preserved verbatim):
///   model.default   = <active first model>
///   model.provider  = "ctrl"             (hermes-internal key)
///   providers.ctrl.base_url / api_key / model
///
/// `active_manifest` carries the CTRL-side provider; `api_key` is the
/// already-resolved credential (keychain / config / env). Empty key =
/// bail (don't clobber an existing working setup with an unauth-able
/// one — let hermes fall through to its own config).
pub(crate) fn write_hermes_config_yaml(
    active_manifest: &crate::kernel::provider::manifest::ProviderManifest,
    api_key: &str,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Ok(());
    }
    let Some(endpoint) = active_manifest.endpoint.as_deref() else {
        return Ok(());
    };
    let model = active_manifest.models.first().cloned().unwrap_or_default();
    if model.is_empty() {
        return Ok(());
    }
    let base =
        directories::BaseDirs::new().ok_or_else(|| "could not resolve home dir".to_string())?;
    let dir = base.home_dir().join(".hermes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create ~/.hermes: {e}"))?;
    let path = dir.join("config.yaml");

    // Load existing config (if any) as a free-form Value so we preserve
    // every field hermes owns (skills / plugins / agent / toolsets / etc).
    // First boot / missing file → start from an empty map.
    let mut doc: serde_yaml::Value = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_yaml::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!(
                    error = %e,
                    "hermes config.yaml parse failed; rewriting from scratch"
                );
                serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
            }),
            Err(_) => serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        }
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    // Walk to doc.model.{default,provider} and doc.providers.ctrl.{...},
    // creating intermediate maps as needed. serde_yaml::Value uses
    // string keys so we don't depend on a typed Hermes schema.
    set_mapping_path(
        &mut doc,
        &["model", "default"],
        serde_yaml::Value::String(model.clone()),
    );
    set_mapping_path(
        &mut doc,
        &["model", "provider"],
        serde_yaml::Value::String("ctrl".into()),
    );
    set_mapping_path(
        &mut doc,
        &["providers", "ctrl", "base_url"],
        serde_yaml::Value::String(endpoint.trim_end_matches('/').to_string()),
    );
    set_mapping_path(
        &mut doc,
        &["providers", "ctrl", "api_key"],
        serde_yaml::Value::String(api_key.to_string()),
    );
    set_mapping_path(
        &mut doc,
        &["providers", "ctrl", "model"],
        serde_yaml::Value::String(model),
    );
    // Tell hermes which WIRE PROTOCOL this endpoint speaks. Without it hermes
    // defaults every `providers.ctrl` to openai_chat and POSTs OpenAI-format
    // requests to an Anthropic endpoint → HTTP 404 (bao 2026-07-06: Claude
    // Sonnet configured, Irisy 404'd — the missing piece). hermes reads a
    // per-provider `transport` from config.yaml (runtime_provider.py:
    // `api_mode|transport` → anthropic_messages | openai_chat).
    use crate::kernel::provider::manifest::HttpShape;
    let transport = match active_manifest.shape {
        HttpShape::AnthropicMessages => "anthropic_messages",
        HttpShape::OpenaiChatCompletions => "openai_chat",
    };
    set_mapping_path(
        &mut doc,
        &["providers", "ctrl", "transport"],
        serde_yaml::Value::String(transport.into()),
    );

    let serialized =
        serde_yaml::to_string(&doc).map_err(|e| format!("serialize ~/.hermes/config.yaml: {e}"))?;
    let tmp = path.with_extension("yaml.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    tracing::info!(
        endpoint = endpoint,
        model = active_manifest.models.first().unwrap_or(&String::new()),
        "hermes config.yaml projected from CTRL active provider"
    );
    Ok(())
}

/// Remove only CTRL-managed provider selection from Hermes while preserving all
/// unrelated user configuration. (ADR-002 substrate § provider v71)
pub(crate) fn clear_hermes_provider_projection() -> Result<(), String> {
    let base =
        directories::BaseDirs::new().ok_or_else(|| "could not resolve home dir".to_string())?;
    let path = base.home_dir().join(".hermes/config.yaml");
    if !path.exists() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("read ~/.hermes/config.yaml: {error}"))?;
    let mut doc: serde_yaml::Value = serde_yaml::from_str(&raw)
        .map_err(|error| format!("parse ~/.hermes/config.yaml: {error}"))?;

    let ctrl_owned_model = doc
        .get("model")
        .and_then(|model| model.get("provider"))
        .and_then(serde_yaml::Value::as_str)
        == Some("ctrl");
    if ctrl_owned_model {
        if let Some(model) = doc
            .get_mut("model")
            .and_then(serde_yaml::Value::as_mapping_mut)
        {
            model.remove(serde_yaml::Value::String("default".into()));
            model.remove(serde_yaml::Value::String("provider".into()));
        }
    }
    if let Some(providers) = doc
        .get_mut("providers")
        .and_then(serde_yaml::Value::as_mapping_mut)
    {
        providers.remove(serde_yaml::Value::String("ctrl".into()));
    }

    let serialized = serde_yaml::to_string(&doc)
        .map_err(|error| format!("serialize ~/.hermes/config.yaml: {error}"))?;
    let tmp = path.with_extension("yaml.tmp");
    std::fs::write(&tmp, serialized).map_err(|error| format!("write tmp: {error}"))?;
    std::fs::rename(&tmp, &path).map_err(|error| format!("rename: {error}"))?;
    Ok(())
}

/// Walk a serde_yaml::Value as nested mappings, creating intermediate
/// maps when missing, then set `path[..last] -> last` to `value`.
fn set_mapping_path(doc: &mut serde_yaml::Value, path: &[&str], value: serde_yaml::Value) {
    if path.is_empty() {
        return;
    }
    let mut current = doc;
    for key in path.iter().take(path.len() - 1) {
        let key_v = serde_yaml::Value::String((*key).to_string());
        if current.get(&key_v).is_none() {
            if let serde_yaml::Value::Mapping(map) = current {
                map.insert(
                    key_v.clone(),
                    serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
                );
            } else {
                *current = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
            }
        }
        current = current
            .get_mut(&key_v)
            .expect("just-inserted mapping must exist");
    }
    if let serde_yaml::Value::Mapping(map) = current {
        map.insert(
            serde_yaml::Value::String(path[path.len() - 1].to_string()),
            value,
        );
    }
}

/// Pin Irisy's web search backend in `~/.hermes/config.yaml` (ADR-002
/// substrate §1 v36 — Irisy web search).
///
/// Tiering mirrors LLM Pattern D — free default, BYOK upgrade:
///   - **default = `ddgs`** (DuckDuckGo): free, no key, no signup. hermes's
///     only backend gated on package-presence, not an env var
///     (`_ddgs_package_importable`), so `run_hermes_oneshot` injects it via
///     `uvx --with ddgs`. Search-only — no `web_extract`.
///   - **`tavily`** when the user supplied a Tavily key (full web + extract).
///
/// Pinned explicitly (not left to hermes auto-detect) so it lands on the
/// fast path in `_get_backend` and is immune to the issue #29617 footgun
/// where an empty `web.backend` silently disables web tools. Every other
/// field hermes owns is preserved verbatim (free-form merge).
pub(crate) fn write_hermes_web_belt() -> Result<(), String> {
    let has_tavily = crate::kernel::provider::registry::read_credential("tavily")
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    // ddgs is search-only, so it has no extract backend; Tavily covers both.
    let search_backend = if has_tavily { "tavily" } else { "ddgs" };
    let extract_backend = if has_tavily { "tavily" } else { "" };

    let base =
        directories::BaseDirs::new().ok_or_else(|| "could not resolve home dir".to_string())?;
    let dir = base.home_dir().join(".hermes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create ~/.hermes: {e}"))?;
    let path = dir.join("config.yaml");

    let mut doc: serde_yaml::Value = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_yaml::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!(
                    error = %e,
                    "hermes config.yaml parse failed; rewriting from scratch"
                );
                serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
            }),
            Err(_) => serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        }
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    set_mapping_path(
        &mut doc,
        &["web", "backend"],
        serde_yaml::Value::String(search_backend.into()),
    );
    set_mapping_path(
        &mut doc,
        &["web", "search_backend"],
        serde_yaml::Value::String(search_backend.into()),
    );
    set_mapping_path(
        &mut doc,
        &["web", "extract_backend"],
        serde_yaml::Value::String(extract_backend.into()),
    );

    let serialized =
        serde_yaml::to_string(&doc).map_err(|e| format!("serialize ~/.hermes/config.yaml: {e}"))?;
    let tmp = path.with_extension("yaml.web.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    tracing::info!(
        backend = search_backend,
        "hermes web backend pinned (Irisy web belt)"
    );
    Ok(())
}
