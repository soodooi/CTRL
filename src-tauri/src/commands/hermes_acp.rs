// ADR-002 substrate § provider + vault/ctrl/strategy/0013 (2026-06-16):
// Irisy conversation HISTORY (read-only). Past conversations live in hermes's
// session store; CTRL reads them through hermes's DOCUMENTED `hermes sessions
// export` (JSONL: one full session per line, id / title / started_at /
// messages[]) — never the internal DB, and via tokio::process only (no ACP
// crate, no persistent actor — those are out of scope here). Powers the
// Irisy history drawer (SessionHistory.tsx).

/// Base argv for the hermes CLI (not hermes-acp): the manifest's uvx prefix +
/// the `hermes` entry. None when hermes isn't installed / manifest is absent.
fn hermes_cli_base() -> Option<Vec<String>> {
    let entry = crate::shell::agent_installer::read_manifest(
        &crate::shell::agent_installer::AgentName::Hermes,
    )
    .map(|m| m.entry_cmd)
    .unwrap_or_default();
    if entry.len() < 4 {
        return None;
    }
    let mut base: Vec<String> = entry[0..3].to_vec();
    base.push("hermes".to_string());
    Some(base)
}

/// One row in the Irisy history list (lightweight projection of a hermes session).
#[derive(serde::Serialize)]
pub struct IrisySessionSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub message_count: u64,
}

/// List past Irisy conversations (newest first). Reads hermes's session store
/// via the documented `hermes sessions export -` (JSONL), projecting just the
/// metadata + a preview so the history panel stays light.
#[tauri::command]
pub async fn irisy_session_list() -> Result<Vec<IrisySessionSummary>, String> {
    let base = hermes_cli_base().ok_or("hermes not installed")?;
    let out = tokio::process::Command::new(&base[0])
        .args(&base[1..])
        .args(["sessions", "export", "-"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "hermes sessions export failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut sessions: Vec<IrisySessionSummary> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let id = v.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        if id.is_empty() {
            continue;
        }
        // Preview = first user message, trimmed to one short line.
        let preview = v
            .get("messages")
            .and_then(|m| m.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
                    .and_then(|m| m.get("content").and_then(|c| c.as_str()))
                    .map(|s| s.replace('\n', " ").chars().take(80).collect::<String>())
            })
            .unwrap_or_default();
        let title = v
            .get("title")
            .and_then(|x| x.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if preview.is_empty() {
                    "Untitled".to_string()
                } else {
                    preview.clone()
                }
            });
        sessions.push(IrisySessionSummary {
            id,
            title,
            preview,
            started_at: v.get("started_at").and_then(|x| x.as_str()).map(String::from),
            ended_at: v.get("ended_at").and_then(|x| x.as_str()).map(String::from),
            message_count: v.get("message_count").and_then(|x| x.as_u64()).unwrap_or(0),
        });
    }
    // Newest first — ISO-8601 timestamps sort lexicographically.
    sessions.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
    Ok(sessions)
}

/// One displayable turn from a past conversation.
#[derive(serde::Serialize)]
pub struct IrisySessionTurn {
    pub role: String,
    pub content: String,
}

/// Load one past conversation's user/assistant turns for read-only viewing,
/// via the documented `hermes sessions export --session-id <id> -`; tool/system
/// turns are filtered out so the panel shows the human-readable thread.
#[tauri::command]
pub async fn irisy_session_get(id: String) -> Result<Vec<IrisySessionTurn>, String> {
    let base = hermes_cli_base().ok_or("hermes not installed")?;
    let out = tokio::process::Command::new(&base[0])
        .args(&base[1..])
        .args(["sessions", "export", "--session-id", &id, "-"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "hermes session export failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let v: serde_json::Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
    let mut turns: Vec<IrisySessionTurn> = Vec::new();
    if let Some(arr) = v.get("messages").and_then(|m| m.as_array()) {
        for m in arr {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role != "user" && role != "assistant" {
                continue;
            }
            let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
            if content.trim().is_empty() {
                continue;
            }
            turns.push(IrisySessionTurn {
                role: role.to_string(),
                content: content.to_string(),
            });
        }
    }
    Ok(turns)
}
