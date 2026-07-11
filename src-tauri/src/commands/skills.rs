// Skill discovery — kernel-local (Phase 1, ADR-007 workbench § discovery v1).
//
// Searches GitHub for `filename:SKILL.md` matches, using a PAT read from the
// macOS Keychain (service `app.ctrl`, account `github`). This is the working
// path; production moves SEARCH behind the shared `ctrl-skills` Worker because
// most users have no GitHub token (ADR-007 workbench § discovery v1 Phase 2). INSTALL of a public skill
// needs no token, so it stays kernel-local regardless.
//
// Consumed by Irisy's `search_skills` tool ([deleted ADR-021 brain switcher — superseded by ADR-002 substrate § brain v1 Pi singleton] §5) and the Pool/workbench
// manual search surface. Returns the normalized CTRL shape, not raw GitHub JSON.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::kernel::event::{Cell, CellKind};
use crate::kernel::EventWsBridge;

/// Keychain account holding the GitHub PAT (service is `app.ctrl`). See
/// doc/setup-github-token.md for how to store it.
const GITHUB_PAT_ACCOUNT: &str = "github";
const SEARCH_URL: &str = "https://api.github.com/search/code";
/// GitHub rejects API requests without a User-Agent.
const USER_AGENT: &str = "CTRL-desktop";
const PER_PAGE: &str = "30";

#[derive(Debug, Serialize)]
pub struct SkillResult {
    /// owner/name, e.g. "zarazhangrui/frontend-slides".
    pub repo: String,
    pub owner: String,
    pub name: String,
    pub description: Option<String>,
    /// Absent from GitHub code-search's minimal repository object — `None`
    /// here, resolved later if needed (not worth a second API call for v1).
    pub stars: Option<u64>,
    /// Path of the SKILL.md within the repo.
    pub path: String,
    /// github.com blob URL for the SKILL.md (the install step derives raw/clone).
    pub html_url: String,
}

#[derive(Debug, Serialize)]
pub struct SkillSearchReply {
    pub results: Vec<SkillResult>,
    pub total: u64,
}

#[tauri::command]
pub async fn search_skills(query: String) -> Result<SkillSearchReply, String> {
    let token = crate::shell::KeychainStore::get(GITHUB_PAT_ACCOUNT)
        .map_err(|e| format!("keychain read failed: {e}"))?
        .ok_or_else(|| {
            "No GitHub token in Keychain. Store a PAT under service 'app.ctrl' \
             account 'github' — see doc/setup-github-token.md."
                .to_string()
        })?;

    let q = format!("filename:SKILL.md {}", query.trim());
    let resp = reqwest::Client::new()
        .get(SEARCH_URL)
        .query(&[("q", q.as_str()), ("per_page", PER_PAGE)])
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("github search request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("github search returned {status}: {body}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("github search parse failed: {e}"))?;

    let total = json.get("total_count").and_then(|v| v.as_u64()).unwrap_or(0);
    let items = json
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let results = items
        .iter()
        .filter_map(parse_item)
        .collect::<Vec<_>>();

    Ok(SkillSearchReply { results, total })
}

/// Normalize one GitHub code-search item into a `SkillResult`. Skips items
/// missing a repository full_name.
fn parse_item(item: &serde_json::Value) -> Option<SkillResult> {
    let repo_obj = item.get("repository");
    let repo = repo_obj
        .and_then(|r| r.get("full_name"))
        .and_then(|v| v.as_str())?
        .to_string();
    if repo.is_empty() {
        return None;
    }
    let owner = repo_obj
        .and_then(|r| r.get("owner"))
        .and_then(|o| o.get("login"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let name = repo.rsplit('/').next().unwrap_or(&repo).to_string();
    let description = repo_obj
        .and_then(|r| r.get("description"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let stars = repo_obj
        .and_then(|r| r.get("stargazers_count"))
        .and_then(serde_json::Value::as_u64);
    let path = item
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let html_url = item
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    Some(SkillResult { repo, owner, name, description, stars, path, html_url })
}

// ── Skill executor (ADR-007 workbench § canvas v1 / ADR-007 workbench § discovery v1, cc-switch-native run model) ──────────
// Runs a `skill`-variant mcp. The kernel does NOT orchestrate the skill —
// the active brain CLI does (it already has the skill in its skills dir). The
// kernel only: (1) hands the brain the mcp's working folder in the vault,
// (2) routes the user input as a task that activates the named skill, (3)
// reports back which artifact files the run produced. The brain (Claude Code)
// writes the result with its own Write tool. See feedback_build_system_not_business.

/// Max wall-clock for one skill run. Artifact-generating skills do several
/// tool-use rounds (think → write → refine); generous so a real deck finishes.
const SKILL_RUN_TIMEOUT_SECS: u64 = 240;
/// Turn budget handed to the brain CLI for an artifact run. The chat adapter
/// uses 1 (text reply); a file-writing skill needs room to write + refine.
const SKILL_RUN_MAX_TURNS: &str = "24";

/// Run a skill mcp: hand the named local skill + the user input to the
/// active brain CLI, running inside the mcp's vault working folder, and
/// return the vault-relative paths of whatever artifact(s) it wrote.
pub async fn run_skill(
    bridge: &EventWsBridge,
    stream_id: &str,
    mcp_id: &str,
    skill: &str,
    input: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Skill mcps need a CLI that can use tools + write files. Claude Code
    // is the verified one — this is the BYO-CLI surface (the user's own
    // installed CLI doing agentic work), NOT an LLM provider; the
    // claude-oauth provider preset was removed (ADR-002 substrate
    // § provider v61, 2026-07-11). Resolve the `claude` binary from
    // PATH directly.
    // Resolve `claude` binary path inline (no external crate dep). Splits
    // $PATH and returns the first matching executable, or falls back to the
    // bare name so std::process::Command's own PATH lookup still has a chance.
    let binary = std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join("claude"))
                .find(|p| p.is_file())
        })
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "claude".to_string());

    // Per-mcp working folder in the VAULT — plain, user-visible files (the
    // user can open the generated deck in vim / Finder; local is truth).
    let vault = crate::kernel::vault::default_vault_root()
        .ok_or_else(|| "HOME not set; no vault root".to_string())?;
    let workdir = vault.join("mcps").join(mcp_id);
    std::fs::create_dir_all(&workdir)
        .map_err(|e| format!("create workdir {}: {e}", workdir.display()))?;

    tracing::info!(
        mcp_id,
        skill,
        binary = %binary,
        workdir = %workdir.display(),
        "run_skill: start"
    );

    let before = snapshot_files(&workdir);

    let input_text = input
        .get("text")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| input.to_string());
    let prompt = format!(
        "Use the {skill} skill. Task: {input_text}\n\n\
         Write the complete, self-contained result as file(s) into the current \
         working directory. Make reasonable design choices and do NOT ask \
         questions — produce the artifact. When finished, state the main output \
         filename on its own line."
    );

    run_brain_agentic(&binary, &workdir, &prompt, bridge, stream_id).await?;

    // Diff the folder — return whatever the run created or changed.
    let after = snapshot_files(&workdir);
    let mut artifacts: Vec<String> = after
        .iter()
        .filter(|(name, meta)| before.get(*name).map_or(true, |b| b != *meta))
        .map(|(name, _)| name.clone())
        .collect();
    artifacts.sort();
    if artifacts.is_empty() {
        tracing::error!(mcp_id, skill, "run_skill: produced no files");
        return Err("the skill run produced no files".to_string());
    }
    tracing::info!(mcp_id, skill, ?artifacts, "run_skill: artifacts");
    // Primary = first renderable artifact (html), else first file.
    let primary = artifacts
        .iter()
        .find(|n| n.to_lowercase().ends_with(".html"))
        .cloned()
        .unwrap_or_else(|| artifacts[0].clone());
    let rel = |name: &str| format!("mcps/{mcp_id}/{name}");

    Ok(serde_json::json!({
        "artifacts": artifacts.iter().map(|a| rel(a)).collect::<Vec<_>>(),
        "primary": rel(&primary),
        "content_type": content_type_for(&primary),
    }))
}

/// Spawn the active brain CLI in agentic mode inside `workdir`: streaming JSON
/// mode, auto-accept file edits, a multi-turn budget. We drop
/// ANTHROPIC_API_KEY so a key injected for CTRL's HTTP providers never
/// leaks into the external CLI — the CLI uses whatever auth the user
/// configured in it themselves (ADR-002 substrate § provider v61,
/// 2026-07-11: CTRL never selects subscription billing). Each
/// assistant chunk is published as a Cell on `stream_id` so the workspace shows
/// the run live instead of a frozen minute. Kills the child if it overruns the
/// deadline (`kill_on_drop`).
async fn run_brain_agentic(
    binary: &str,
    workdir: &Path,
    prompt: &str,
    bridge: &EventWsBridge,
    stream_id: &str,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
    use tokio::process::Command;

    let mut cmd = Command::new(binary);
    cmd.current_dir(workdir)
        .arg("-p")
        .arg(prompt)
        .arg("--model")
        .arg("sonnet")
        .arg("--permission-mode")
        .arg("acceptEdits")
        .arg("--max-turns")
        .arg(SKILL_RUN_MAX_TURNS)
        .arg("--verbose")
        .arg("--output-format")
        .arg("stream-json")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    cmd.env_remove("ANTHROPIC_API_KEY");

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("claude spawn failed: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "claude stdout not captured".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "claude stderr not captured".to_string())?;

    // Drain stderr concurrently so a full pipe can't deadlock the child.
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    publish_delta(bridge, stream_id, "Starting…\n");

    let read_loop = async {
        let mut lines = BufReader::new(stdout).lines();
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| format!("read claude stdout: {e}"))?
        {
            if let Some(snippet) = snippet_from_line(&line) {
                publish_delta(bridge, stream_id, &snippet);
            }
        }
        Ok::<(), String>(())
    };

    tokio::time::timeout(
        std::time::Duration::from_secs(SKILL_RUN_TIMEOUT_SECS),
        read_loop,
    )
    .await
    .map_err(|_| format!("skill run timed out after {SKILL_RUN_TIMEOUT_SECS}s"))??;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("claude run error: {e}"))?;
    let stderr_text = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "claude exited {:?}: {}",
            status.code(),
            stderr_text.trim()
        ));
    }
    Ok(())
}

/// Publish one assistant chunk on the mcp's output stream. The PWA's
/// `useCellStream(mcp-<id>)` decodes these and renders them live.
fn publish_delta(bridge: &EventWsBridge, stream_id: &str, delta: &str) {
    let ts_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    bridge.publish_cell(Cell {
        kind: CellKind::LlmResponse,
        ts_ms,
        stream_id: Some(stream_id.to_string()),
        payload: serde_json::json!({ "delta": delta }),
    });
}

/// Turn one line of claude `stream-json` NDJSON into a short human-readable
/// progress snippet (assistant prose + a one-liner per tool use). Non-assistant
/// lines (system/init/result) return None — they carry no user-facing text.
fn snippet_from_line(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
        return None;
    }
    let content = v.get("message")?.get("content")?.as_array()?;
    let mut out = String::new();
    for block in content {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                    out.push_str(t);
                }
            }
            Some("tool_use") => {
                let name = block.get("name").and_then(|x| x.as_str()).unwrap_or("tool");
                let input = block.get("input");
                let target = input
                    .and_then(|i| {
                        i.get("file_path")
                            .or_else(|| i.get("path"))
                            .or_else(|| i.get("command"))
                            .or_else(|| i.get("pattern"))
                    })
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                out.push_str(&format!("\n→ {name} {target}\n"));
            }
            _ => {}
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Top-level file snapshot (name → size+mtime) so a run's output can be
/// detected by diffing before/after. Top-level only — sufficient for v1
/// single-file artifacts (html deck, markdown doc).
fn snapshot_files(dir: &Path) -> BTreeMap<String, (u64, i64)> {
    let mut map = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return map;
    };
    for e in entries.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if !ft.is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let meta = e.metadata().ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        map.insert(name, (size, mtime));
    }
    map
}

/// Map a filename to the content-type the PWA viewer registry understands, so
/// the workspace picks the right viewer (html → HtmlViewer, md → Markdown…).
fn content_type_for(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html"
    } else if lower.ends_with(".md") {
        "text/markdown"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".json") {
        "application/json"
    } else if lower.ends_with(".css") {
        "text/css"
    } else if lower.ends_with(".js") {
        "application/javascript"
    } else {
        "text/plain"
    }
}

// ── Local skill discovery ───────────────────────────────────────────────────
// Irisy needs to know which skills the active brain already has locally (user
// skills + installed plugin skills) so it can compose a mcp manifest that
// references one by name. This is the no-token path — distinct from
// `search_skills` (GitHub, needs a PAT). System primitive only; Irisy decides
// what to do with the list (feedback_build_system_not_business).

#[derive(Debug, Serialize)]
pub struct LocalSkill {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
}

/// Cap on returned skills — there can be hundreds of plugin skills; dumping
/// them all into the brain's context is slow + useless. Irisy passes a query
/// to narrow; this bounds the worst case.
const MAX_LOCAL_SKILLS: usize = 40;

#[tauri::command]
pub async fn list_local_skills(query: Option<String>) -> Result<Vec<LocalSkill>, String> {
    // The gate (:17873) serves this over the shared tokio runtime. The body is
    // blocking fs — a deep, unbounded walk of ~/.claude/plugins/cache. Running
    // it directly on an async worker starves the runtime's worker threads: with
    // enough blocking calls in flight the SSE session can't read its next
    // message, so even a trivial skill_read queued behind it hangs for minutes
    // (only 20s heartbeats fire), while vault_read looks instant whenever the
    // pool happens not to be saturated. Offload to the blocking pool so async
    // workers stay free (bao 2026-07-07 gate skill_read concurrency hang).
    tokio::task::spawn_blocking(move || list_local_skills_blocking(query))
        .await
        .map_err(|e| format!("skill list task panicked: {e}"))?
}

fn list_local_skills_blocking(query: Option<String>) -> Result<Vec<LocalSkill>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let mut out: Vec<LocalSkill> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 1. User skills: ~/.claude/skills/<name>/SKILL.md
    let user_skills = PathBuf::from(&home).join(".claude").join("skills");
    collect_skills_in(&user_skills, &mut out, &mut seen);

    // 2. Installed plugin skills: ~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/skills/<name>/SKILL.md
    let cache = PathBuf::from(&home)
        .join(".claude")
        .join("plugins")
        .join("cache");
    if let Ok(markets) = std::fs::read_dir(&cache) {
        for m in markets.flatten() {
            let Ok(plugins) = std::fs::read_dir(m.path()) else {
                continue;
            };
            for p in plugins.flatten() {
                let Ok(versions) = std::fs::read_dir(p.path()) else {
                    continue;
                };
                for v in versions.flatten() {
                    collect_skills_in(&v.path().join("skills"), &mut out, &mut seen);
                }
            }
        }
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));

    // Filter by query so Irisy gets only the relevant few, not the whole
    // catalog. Token-based (match ANY word) — the brain often passes a phrase
    // like "HTML slide mcp"; a whole-string match would miss "frontend-
    // slides", but the token "slide" hits it.
    if let Some(q) = query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let tokens: Vec<String> = q
            .to_lowercase()
            .split_whitespace()
            .filter(|t| t.len() > 1)
            .map(str::to_string)
            .collect();
        if !tokens.is_empty() {
            out.retain(|s| {
                let hay = format!(
                    "{} {}",
                    s.name.to_lowercase(),
                    s.description.as_deref().unwrap_or("").to_lowercase()
                );
                tokens.iter().any(|t| hay.contains(t.as_str()))
            });
        }
    }
    out.truncate(MAX_LOCAL_SKILLS);
    Ok(out)
}

fn collect_skills_in(
    dir: &Path,
    out: &mut Vec<LocalSkill>,
    seen: &mut std::collections::HashSet<String>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let skill_md = e.path().join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&skill_md).unwrap_or_default();
        let (mut name, description) = parse_skill_meta(&raw);
        if name.is_empty() {
            name = e.file_name().to_string_lossy().to_string();
        }
        if !seen.insert(name.clone()) {
            continue;
        }
        out.push(LocalSkill {
            name,
            description,
            path: skill_md.to_string_lossy().to_string(),
        });
    }
}

/// Pull `name:` + `description:` out of a SKILL.md YAML frontmatter block.
fn parse_skill_meta(md: &str) -> (String, Option<String>) {
    let mut name = String::new();
    let mut description = None;
    let mut in_fm = false;
    for line in md.lines() {
        let t = line.trim();
        if t == "---" {
            if in_fm {
                break;
            }
            in_fm = true;
            continue;
        }
        if !in_fm {
            continue;
        }
        if let Some(v) = t.strip_prefix("name:") {
            name = v.trim().trim_matches('"').to_string();
        } else if let Some(v) = t.strip_prefix("description:") {
            description = Some(v.trim().trim_matches('"').to_string());
        }
    }
    (name, description)
}

/// Read a SKILL.md under one of `allowed_roots`. Confined to SKILL.md files
/// inside the given roots (canonicalized, so `..`/symlinks can't escape) — it
/// can never be turned into an arbitrary-file read. Split out from
/// read_local_skill so the safety boundary is unit-testable with temp roots.
fn read_skill_under(allowed_roots: &[PathBuf], path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if p.file_name().and_then(|n| n.to_str()) != Some("SKILL.md") {
        return Err("path must point to a SKILL.md file".to_string());
    }
    let canon = std::fs::canonicalize(p).map_err(|e| format!("resolve {path}: {e}"))?;
    let under_allowed = allowed_roots
        .iter()
        .filter_map(|r| std::fs::canonicalize(r).ok())
        .any(|root| canon.starts_with(&root));
    if !under_allowed {
        return Err("skill path is outside the allowed skill directories".to_string());
    }
    std::fs::read_to_string(&canon).map_err(|e| format!("read skill: {e}"))
}

/// Read a local skill's SKILL.md so the brain can see HOW a skill works before
/// reusing it. Confined to the same roots list_local_skills scans
/// (~/.claude/skills + ~/.claude/plugins/cache).
pub async fn read_local_skill(path: String) -> Result<String, String> {
    // Blocking fs (canonicalize + read) — same runtime-starvation reasoning as
    // list_local_skills: never run it on an async worker, or a saturated pool
    // makes this trivial read hang on the gate. Offload to the blocking pool.
    tokio::task::spawn_blocking(move || {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        let roots = [
            PathBuf::from(&home).join(".claude").join("skills"),
            PathBuf::from(&home).join(".claude").join("plugins").join("cache"),
        ];
        read_skill_under(&roots, &path)
    })
    .await
    .map_err(|e| format!("skill read task panicked: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_tmp(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-skills-test-{label}-{pid}-{nanos}"));
        p
    }

    #[test]
    fn read_skill_reads_inside_root_and_blocks_outside() {
        let root = fresh_tmp("root");
        let skill_dir = root.join("analyze");
        std::fs::create_dir_all(&skill_dir).unwrap();
        let skill_md = skill_dir.join("SKILL.md");
        std::fs::write(&skill_md, "# Analyze\nsteps").unwrap();

        // Reads a SKILL.md inside an allowed root.
        let body = read_skill_under(&[root.clone()], skill_md.to_str().unwrap())
            .expect("read inside root");
        assert!(body.contains("# Analyze"));

        // A non-SKILL.md file is rejected — no arbitrary-file read.
        let other = skill_dir.join("secret.txt");
        std::fs::write(&other, "x").unwrap();
        assert!(read_skill_under(&[root.clone()], other.to_str().unwrap()).is_err());

        // A SKILL.md OUTSIDE the allowed roots is rejected.
        let outside = fresh_tmp("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let outside_md = outside.join("SKILL.md");
        std::fs::write(&outside_md, "# Evil").unwrap();
        assert!(read_skill_under(&[root.clone()], outside_md.to_str().unwrap()).is_err());

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn collect_skills_reads_name_and_desc_from_any_root() {
        let root = fresh_tmp("collect");
        let sd = root.join("my-skill");
        std::fs::create_dir_all(&sd).unwrap();
        std::fs::write(
            sd.join("SKILL.md"),
            "---\nname: My Skill\ndescription: does X\n---\nbody",
        )
        .unwrap();

        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        collect_skills_in(&root, &mut out, &mut seen);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "My Skill");
        assert_eq!(out[0].description.as_deref(), Some("does X"));

        let _ = std::fs::remove_dir_all(&root);
    }

    // Hot-discovery contract: skill listing re-scans the filesystem on EVERY
    // call — a skill created AFTER a first scan is found on the next scan with
    // no restart and no cache invalidation. This locks the live-read_dir design
    // so nobody silently introduces a boot-time cache (which would make a
    // runtime-created skill — including one Irisy just built — invisible until
    // an app restart).
    #[test]
    fn newly_created_skill_is_found_on_next_scan_no_cache() {
        let root = fresh_tmp("hot");
        std::fs::create_dir_all(root.join("first")).unwrap();
        std::fs::write(
            root.join("first").join("SKILL.md"),
            "---\nname: first\ndescription: one\n---\nbody",
        )
        .unwrap();

        // First scan sees only `first`.
        let mut out1 = Vec::new();
        let mut seen1 = std::collections::HashSet::new();
        collect_skills_in(&root, &mut out1, &mut seen1);
        assert_eq!(out1.len(), 1);
        assert!(out1.iter().any(|s| s.name == "first"));

        // A new skill is created at runtime (no process restart between scans).
        std::fs::create_dir_all(root.join("second")).unwrap();
        std::fs::write(
            root.join("second").join("SKILL.md"),
            "---\nname: second\ndescription: two\n---\nbody",
        )
        .unwrap();

        // Second scan re-reads the directory and finds BOTH — proving the
        // listing is live, not cached from the first call.
        let mut out2 = Vec::new();
        let mut seen2 = std::collections::HashSet::new();
        collect_skills_in(&root, &mut out2, &mut seen2);
        assert_eq!(out2.len(), 2);
        assert!(out2.iter().any(|s| s.name == "first"));
        assert!(out2.iter().any(|s| s.name == "second"));

        let _ = std::fs::remove_dir_all(&root);
    }
}
