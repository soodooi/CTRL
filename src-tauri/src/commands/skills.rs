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
