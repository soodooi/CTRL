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

use futures::StreamExt;
use serde::Serialize;

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

// ── Skill executor (ADR-022 / ADR-023 Phase 1) ──────────────────────────────
// Runs a `skill`-variant keycap. The kernel only ROUTES + materializes the
// skill's files; Pi (the brain agent) does the actual work by following the
// SKILL.md (feedback_build_system_not_business). Called from run_keycap's
// SkillRun dispatch.

/// Subdirectory under the keycap dir holding the materialized skill repo.
const SKILL_SOURCE_SUBDIR: &str = "source";

/// Run a skill keycap: lazily clone its public repo, then hand the SKILL.md +
/// the user input to Pi, which follows the instructions and returns output.
pub async fn run_skill(
    id: &str,
    upstream: &str,
    entry: &str,
    input: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let source_dir = std::path::PathBuf::from(home)
        .join(".ctrl")
        .join("keycaps")
        .join(id)
        .join(SKILL_SOURCE_SUBDIR);

    // Lazy materialize — clone the public repo on first run (no token needed).
    if !source_dir.exists() {
        clone_public_repo(upstream, &source_dir)?;
    }

    let skill_md_path = source_dir.join(entry);
    let skill_md = std::fs::read_to_string(&skill_md_path)
        .map_err(|e| format!("read {}: {e}", skill_md_path.display()))?;

    let input_text = input
        .get("text")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| input.to_string());

    let system = format!(
        "You are executing a CTRL skill. Follow the skill's instructions below \
         exactly and produce the requested output. The skill's files are checked \
         out locally at: {}\n\n--- SKILL.md ---\n{}",
        source_dir.display(),
        skill_md,
    );
    let messages = vec![
        serde_json::json!({ "role": "system", "content": system }),
        serde_json::json!({ "role": "user", "content": input_text }),
    ];

    let output = call_pi(messages).await?;
    Ok(serde_json::json!({ "skill": upstream, "output": output }))
}

/// Anonymous shallow clone of a public `owner/repo` — no token, no auth.
fn clone_public_repo(upstream: &str, dest: &std::path::Path) -> Result<(), String> {
    if upstream.is_empty() || upstream.contains("..") || !upstream.contains('/') {
        return Err(format!("invalid upstream {upstream:?} (expected owner/repo)"));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let git = git_binary();
    let url = format!("https://github.com/{upstream}.git");
    let status = std::process::Command::new(git)
        .args(["clone", "--depth", "1", &url])
        .arg(dest)
        .status()
        .map_err(|e| format!("git not runnable ({git}): {e}"))?;
    if !status.success() {
        return Err(format!("git clone {url} failed (exit {:?})", status.code()));
    }
    Ok(())
}

/// A Finder-launched .app has a minimal PATH; check the common git locations.
fn git_binary() -> &'static str {
    for p in ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"] {
        if std::path::Path::new(p).is_file() {
            return p;
        }
    }
    "git"
}

/// Invoke the active brain (Pi) MCP `text.chat` tool with the given messages
/// and COLLECT the streamed output into a single string (run_keycap is
/// non-streaming). Mirrors irisy_chat::forward_to_brain's wire, minus the
/// per-delta event emission.
async fn call_pi(messages: Vec<serde_json::Value>) -> Result<String, String> {
    let brain_id = crate::kernel::brain_config::active_brain_id();
    let url = crate::kernel::brain_config::brain_mcp_url(&brain_id)
        .ok_or_else(|| format!("active brain '{brain_id}' has no MCP URL"))?;

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": "text.chat", "arguments": { "messages": messages } }
    });

    let mut req = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream");
    if let Ok(token) = std::env::var("CTRL_PI_TOKEN") {
        if !token.is_empty() {
            req = req.bearer_auth(token);
        }
    }
    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Pi brain not reachable at {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Pi brain HTTP {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut current_event = String::new();
    let mut out = String::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream read error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim_end_matches('\r').to_string();
            buf.drain(..=nl);
            if line.is_empty() {
                current_event.clear();
                continue;
            }
            if let Some(rest) = line.strip_prefix("event: ") {
                current_event = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("data: ") {
                match current_event.as_str() {
                    "delta" => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
                            if let Some(d) = v.get("delta").and_then(|x| x.as_str()) {
                                out.push_str(d);
                            }
                        }
                    }
                    "done" => return Ok(out),
                    "error" => {
                        let msg = serde_json::from_str::<serde_json::Value>(rest)
                            .ok()
                            .and_then(|v| {
                                v.get("message").and_then(|m| m.as_str()).map(str::to_string)
                            })
                            .unwrap_or_else(|| rest.to_string());
                        return Err(format!("Pi error: {msg}"));
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(out)
}
