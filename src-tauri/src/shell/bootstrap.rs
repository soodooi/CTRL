// First-launch / idempotent user-data bootstrap.
//
// Two responsibilities:
//   1. Seed builtin keycaps — copies every `share/modules/builtin/<dir>` that
//      ships with the binary into `~/.ctrl/keycaps/<manifest.id>/` if the
//      target dir doesn't already exist. Adding a new builtin to a release
//      lands it on the next boot without overwriting user customizations.
//   2. Seed vault skeleton — creates `~/.ctrl/vault/` plus the `.irisy-*` /
//      `irisy/` subdirs and writes starter markdown files so Irisy's memory
//      + prompt bootstrap paths have something to read on first launch.
//
// Both pieces are best-effort: failures are logged, never panic. Re-running
// is safe (skips anything that already exists).
//
// Locating `share/modules/builtin`:
//   • Production: `app.path().resource_dir()` (matches the pattern that
//     `app_changelog` uses for CHANGELOG.md — see commands/system.rs).
//   • Dev: walk up from CWD looking for `share/modules/builtin/` at the
//     repo root. Cap at 6 levels.

use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Seed builtin keycaps + vault skeleton. Idempotent. Logs counts.
pub fn seed_user_data(app: &AppHandle) -> Result<()> {
    let home = match std::env::var("HOME") {
        Ok(h) => PathBuf::from(h),
        Err(_) => {
            tracing::warn!("bootstrap: HOME unset, skipping seed");
            return Ok(());
        }
    };
    let ctrl_root = home.join(".ctrl");

    match seed_builtin_keycaps(app, &ctrl_root) {
        Ok((copied, skipped)) => {
            tracing::info!(copied, skipped, "bootstrap: builtin keycaps seeded");
        }
        Err(e) => {
            tracing::warn!(error = %e, "bootstrap: builtin keycap seed failed");
        }
    }

    match seed_vault_skeleton(&ctrl_root) {
        Ok(created) => {
            tracing::info!(created, "bootstrap: vault skeleton seeded");
        }
        Err(e) => {
            tracing::warn!(error = %e, "bootstrap: vault skeleton seed failed");
        }
    }

    Ok(())
}

/// Locate the bundled `share/modules/builtin` directory.
fn resolve_builtin_source(app: &AppHandle) -> Option<PathBuf> {
    // 1. Production resource dir (tauri.conf.json bundle.resources).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("share/modules/builtin");
        if candidate.is_dir() {
            return Some(candidate);
        }
        let flat = resource_dir.join("builtin");
        if flat.is_dir() {
            return Some(flat);
        }
    }
    // 2. Dev fallback — walk up from CWD up to 6 levels.
    if let Ok(mut cwd) = std::env::current_dir() {
        for _ in 0..6 {
            let candidate = cwd.join("share/modules/builtin");
            if candidate.is_dir() {
                return Some(candidate);
            }
            if !cwd.pop() {
                break;
            }
        }
    }
    None
}

/// Copy every well-formed builtin keycap into `~/.ctrl/keycaps/<id>/`.
/// Returns (copied, skipped). Skipped = target already existed.
fn seed_builtin_keycaps(app: &AppHandle, ctrl_root: &Path) -> Result<(usize, usize)> {
    let source = match resolve_builtin_source(app) {
        Some(p) => p,
        None => {
            tracing::info!("bootstrap: no builtin source dir found, skipping");
            return Ok((0, 0));
        }
    };
    let target_root = ctrl_root.join("keycaps");
    fs::create_dir_all(&target_root)?;

    let mut copied = 0usize;
    let mut skipped = 0usize;

    for entry in fs::read_dir(&source)? {
        let entry = entry?;
        let src_dir = entry.path();
        if !src_dir.is_dir() {
            continue;
        }
        let manifest_path = src_dir.join("manifest.json");
        let Ok(manifest_bytes) = fs::read(&manifest_path) else {
            tracing::warn!(?src_dir, "bootstrap: builtin missing manifest.json, skipping");
            continue;
        };
        let manifest: serde_json::Value = match serde_json::from_slice(&manifest_bytes) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(?src_dir, error = %e, "bootstrap: builtin manifest invalid, skipping");
                continue;
            }
        };
        let Some(id) = manifest.get("id").and_then(|v| v.as_str()) else {
            tracing::warn!(?src_dir, "bootstrap: builtin manifest missing id, skipping");
            continue;
        };
        if !is_safe_id(id) {
            tracing::warn!(id, "bootstrap: builtin manifest id unsafe, skipping");
            continue;
        }
        let target_dir = target_root.join(id);
        if target_dir.exists() {
            skipped += 1;
            continue;
        }
        if let Err(e) = copy_dir_recursive(&src_dir, &target_dir) {
            tracing::warn!(id, error = %e, "bootstrap: copy failed");
            continue;
        }
        copied += 1;
        tracing::debug!(id, ?target_dir, "bootstrap: seeded builtin keycap");
    }

    Ok((copied, skipped))
}

/// Same rules as commands::kernel::validate_keycap_id — keep them in sync.
fn is_safe_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 128 {
        return false;
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Create `~/.ctrl/vault/` + starter subdirs + minimal seed files.
/// Returns count of files newly written (dirs don't count).
fn seed_vault_skeleton(ctrl_root: &Path) -> Result<usize> {
    let vault = ctrl_root.join("vault");
    for sub in [".irisy-memory", ".irisy-prompts", "irisy"] {
        fs::create_dir_all(vault.join(sub))?;
    }

    let mut created = 0usize;

    let soul_path = vault.join("irisy/SOUL.md");
    if !soul_path.exists() {
        fs::write(&soul_path, SOUL_MD_SEED)?;
        created += 1;
    }

    let core_memory_path = vault.join(".irisy-memory/core.md");
    if !core_memory_path.exists() {
        fs::write(&core_memory_path, CORE_MEMORY_SEED)?;
        created += 1;
    }

    let system_prompt_path = vault.join(".irisy-prompts/system.md");
    if !system_prompt_path.exists() {
        fs::write(&system_prompt_path, SYSTEM_PROMPT_SEED)?;
        created += 1;
    }

    let readme_path = vault.join("README.md");
    if !readme_path.exists() {
        fs::write(&readme_path, VAULT_README_SEED)?;
        created += 1;
    }

    Ok(created)
}

const SOUL_MD_SEED: &str = "---\nname: Irisy\nrole: CTRL co-pilot\n---\n\n# SOUL\n\nLong-form identity + values for Irisy. Edit freely — Irisy reads this on every chat boot.\n\n## Who am I\n\nI'm Irisy, the AI co-pilot inside CTRL. I sit beside you while you work and help with whatever's on your screen, your clipboard, or your mind.\n\n## How I behave\n\n- Terse and useful by default.\n- I never make up tool names or file paths.\n- I prefer the user's vault as truth over my memory.\n";

const CORE_MEMORY_SEED: &str = "# Core memory\n\nIrisy reads this file on every chat turn. Treat it as the short, always-true list of things to remember about the user and the project.\n\n- (empty — Irisy will append here as conversation continues)\n";

const SYSTEM_PROMPT_SEED: &str = "# System prompt seed\n\nThis file is concatenated into Irisy's system prompt at chat-start.\n\nYou are Irisy, the AI co-pilot inside CTRL — an ambient AI launcher on the user's desktop. Be concise. Defer to vault contents over memory when in doubt. When you don't know, say so.\n";

const VAULT_README_SEED: &str = "# Your CTRL vault\n\nThis directory is yours. Plain markdown + YAML frontmatter, readable in vim / Obsidian / anything.\n\n- `irisy/` — Irisy's persistent identity (SOUL.md). Safe to edit.\n- `.irisy-memory/` — Irisy's working memory. Append-only by default.\n- `.irisy-prompts/` — System prompt fragments Irisy reads at chat-start.\n\nCTRL never reaches outside this directory for user content. If you delete it, CTRL re-seeds the skeleton on next launch — your custom files are gone.\n";
