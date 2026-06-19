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
    Ok(parse_session_summaries(&text))
}

/// Project `hermes sessions export -` JSONL (one session per line) into the
/// lightweight history list, newest first. Split out of the command so the
/// projection (preview trim / title fallback / skip bad lines / sort) is
/// unit-testable without spawning hermes. ADR-002 substrate § provider +
/// vault/ctrl/strategy/0013 (2026-06-16).
fn parse_session_summaries(text: &str) -> Vec<IrisySessionSummary> {
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
    sessions
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
    Ok(parse_session_turns(&text))
}

/// Project the first non-empty JSONL line of `hermes sessions export
/// --session-id <id> -` into displayable user/assistant turns (tool/system
/// filtered, empty content skipped). Split out for unit-testing without
/// hermes; a malformed line yields no turns rather than erroring. ADR-002
/// substrate § provider + vault/ctrl/strategy/0013 (2026-06-16).
fn parse_session_turns(text: &str) -> Vec<IrisySessionTurn> {
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let mut turns: Vec<IrisySessionTurn> = Vec::new();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return turns;
    };
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
    turns
}

#[cfg(test)]
mod tests {
    // SC8 — hermes session-history JSONL projection (read-only history
    // drawer). ADR-002 substrate § provider + vault/ctrl/strategy/0013
    // (2026-06-16): read via the documented export, project light + safe.
    use super::*;

    #[test]
    fn summaries_preview_is_first_user_message_with_title_fallback() {
        let jsonl = r#"{"id":"s1","started_at":"2026-06-01T10:00:00Z","ended_at":"2026-06-01T10:05:00Z","message_count":3,"messages":[{"role":"assistant","content":"hi"},{"role":"user","content":"draft a note\nabout cats"}]}"#;
        let out = parse_session_summaries(jsonl);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "s1");
        // preview = first USER message, newlines flattened to spaces
        assert_eq!(out[0].preview, "draft a note about cats");
        // no title field -> falls back to the preview
        assert_eq!(out[0].title, "draft a note about cats");
        assert_eq!(out[0].message_count, 3);
    }

    #[test]
    fn summaries_untitled_when_no_title_and_no_user_message() {
        let jsonl = r#"{"id":"s1","messages":[{"role":"assistant","content":"hi"}]}"#;
        let out = parse_session_summaries(jsonl);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].preview, "");
        assert_eq!(out[0].title, "Untitled");
    }

    #[test]
    fn summaries_skip_blank_bad_json_and_empty_id() {
        let jsonl = "\n  \nnot json\n{\"id\":\"\",\"messages\":[]}\n{\"id\":\"ok\",\"messages\":[]}";
        let out = parse_session_summaries(jsonl);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "ok");
    }

    #[test]
    fn summaries_sorted_newest_first_by_ended_at() {
        let jsonl = concat!(
            r#"{"id":"old","ended_at":"2026-06-01T10:00:00Z","messages":[]}"#,
            "\n",
            r#"{"id":"new","ended_at":"2026-06-09T10:00:00Z","messages":[]}"#
        );
        let out = parse_session_summaries(jsonl);
        let ids: Vec<&str> = out.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn turns_keep_user_assistant_drop_tool_system_and_empty() {
        let jsonl = r#"{"messages":[{"role":"system","content":"sys"},{"role":"user","content":"hi"},{"role":"tool","content":"x"},{"role":"assistant","content":"hello"},{"role":"assistant","content":"  "}]}"#;
        let turns = parse_session_turns(jsonl);
        assert_eq!(turns.len(), 2);
        assert_eq!((turns[0].role.as_str(), turns[0].content.as_str()), ("user", "hi"));
        assert_eq!((turns[1].role.as_str(), turns[1].content.as_str()), ("assistant", "hello"));
    }

    #[test]
    fn turns_empty_on_malformed_line() {
        assert!(parse_session_turns("not json").is_empty());
    }
}
