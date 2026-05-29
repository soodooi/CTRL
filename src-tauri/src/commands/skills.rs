// Skill discovery — kernel-local (Phase 1, ADR-023).
//
// Searches GitHub for `filename:SKILL.md` matches, using a PAT read from the
// macOS Keychain (service `app.ctrl`, account `github`). This is the 走通
// path; production moves SEARCH behind the shared `ctrl-skills` Worker because
// most users have no GitHub token (ADR-023 Phase 2). INSTALL of a public skill
// needs no token, so it stays kernel-local regardless.
//
// Consumed by Irisy's `search_skills` tool (ADR-021 §5) and the Pool/workbench
// manual search surface. Returns the normalized CTRL shape, not raw GitHub JSON.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::kernel::event::{Cell, CellKind};
use crate::kernel::StssBridge;

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

// ── Skill executor (ADR-022 / ADR-023, cc-switch-native run model) ──────────
// Runs a `skill`-variant keycap. The kernel does NOT orchestrate the skill —
// the active brain CLI does (it already has the skill in its skills dir). The
// kernel only: (1) hands the brain the keycap's working folder in the vault,
// (2) routes the user input as a task that activates the named skill, (3)
// reports back which artifact files the run produced. The brain (Claude Code)
// writes the result with its own Write tool. See feedback_build_system_not_business.

/// Max wall-clock for one skill run. Artifact-generating skills do several
/// tool-use rounds (think → write → refine); generous so a real deck finishes.
const SKILL_RUN_TIMEOUT_SECS: u64 = 240;
/// Turn budget handed to the brain CLI for an artifact run. The chat adapter
/// uses 1 (text reply); a file-writing skill needs room to write + refine.
const SKILL_RUN_MAX_TURNS: &str = "24";

/// Run a skill keycap: hand the named local skill + the user input to the
/// active brain CLI, running inside the keycap's vault working folder, and
/// return the vault-relative paths of whatever artifact(s) it wrote.
pub async fn run_skill(
    bridge: &StssBridge,
    stream_id: &str,
    keycap_id: &str,
    skill: &str,
    input: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Skill keycaps need a brain CLI that can use tools + write files. Claude
    // Code is the verified one; require it (the active-brain selection in
    // Settings → Model Integration must resolve to a CLI that has the skill).
    let binary = crate::kernel::llm_adapters::claude_cli::ClaudeCliAdapter::locate_binary()
        .ok_or_else(|| {
            "Skill keycaps run on the Claude Code CLI. Install `claude` and \
             activate Claude Code in Settings → Model Integration."
                .to_string()
        })?;

    // Per-keycap working folder in the VAULT — plain, user-visible files (the
    // user can open the generated deck in vim / Finder; local is truth).
    let vault = crate::kernel::vault::default_vault_root()
        .ok_or_else(|| "HOME not set; no vault root".to_string())?;
    let workdir = vault.join("keycaps").join(keycap_id);
    std::fs::create_dir_all(&workdir)
        .map_err(|e| format!("create workdir {}: {e}", workdir.display()))?;

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
        return Err("the skill run produced no files".to_string());
    }
    // Primary = first renderable artifact (html), else first file.
    let primary = artifacts
        .iter()
        .find(|n| n.to_lowercase().ends_with(".html"))
        .cloned()
        .unwrap_or_else(|| artifacts[0].clone());
    let rel = |name: &str| format!("keycaps/{keycap_id}/{name}");

    Ok(serde_json::json!({
        "artifacts": artifacts.iter().map(|a| rel(a)).collect::<Vec<_>>(),
        "primary": rel(&primary),
        "content_type": content_type_for(&primary),
    }))
}

/// Spawn the active brain CLI in agentic mode inside `workdir`: streaming JSON
/// mode, auto-accept file edits, a multi-turn budget, subscription OAuth (we
/// drop ANTHROPIC_API_KEY so it bills the plan, not the API account). Each
/// assistant chunk is published as a Cell on `stream_id` so the workspace shows
/// the run live instead of a frozen minute. Kills the child if it overruns the
/// deadline (`kill_on_drop`).
async fn run_brain_agentic(
    binary: &str,
    workdir: &Path,
    prompt: &str,
    bridge: &StssBridge,
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

/// Publish one assistant chunk on the keycap's output stream. The PWA's
/// `useCellStream(keycap-<id>)` decodes these and renders them live.
fn publish_delta(bridge: &StssBridge, stream_id: &str, delta: &str) {
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
// skills + installed plugin skills) so it can compose a keycap manifest that
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
    // like "HTML slide keycap"; a whole-string match would miss "frontend-
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
