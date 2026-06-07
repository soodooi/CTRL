// kernel::mcp_capture — mcp output to SmartTable capture (§9).
//
// (ADR-002 substrate v5 §9 smart-table-output, 2026-06-03 — brainstorm
// `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` product
// decision P4 "smart table list shape per mcp".)
//
// Best-effort side effect — failures are warn-logged and never block
// the mcp response. Capture row schema is the standard 7-column
// `(ts, input_excerpt, output_excerpt, provider, model, tokens, accepted)`;
// when a mcp manifest declares extra columns those land too via the
// optional `extra` map.

use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

use crate::kernel::vault;

/// Manifest excerpt — the only block this module reads.
#[derive(Debug, Deserialize)]
struct OutputCaptureCfg {
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default)]
    table_path: Option<String>,
    #[serde(default)]
    schema: Option<Vec<Value>>,
}
fn default_enabled() -> bool {
    true
}

/// Truncate a string at `n` characters with an ellipsis suffix. Uses
/// character count, not byte count, so multi-byte strings render
/// cleanly.
fn truncate(s: &str, n: usize) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(n).collect();
    if chars.next().is_some() {
        format!("{head}...")
    } else {
        head
    }
}

/// Append a row to the mcp's SmartTable. Best-effort; logs+swallows
/// any error. `extras` lets callers pass mcp-specific extra columns
/// (e.g. `confidence` for OCR).
pub fn capture_row(
    vault_root: &Path,
    mcp_id: &str,
    input: &Value,
    output: &Value,
    provider: Option<&str>,
    model: Option<&str>,
    tokens: Option<u64>,
    extras: Option<Vec<(String, String)>>,
) {
    let Some(cfg) = load_capture_cfg(vault_root, mcp_id) else {
        return;
    };
    if !cfg.enabled {
        return;
    }
    let table_path = cfg
        .table_path
        .clone()
        .unwrap_or_else(|| format!("notes/mcp-runs/{mcp_id}.table.md"));

    let input_excerpt = truncate(&value_to_excerpt(input), 80);
    let output_excerpt = truncate(&value_to_excerpt(output), 80);
    let ts = chrono::Utc::now().to_rfc3339();
    let provider = provider.unwrap_or("").to_string();
    let model = model.unwrap_or("").to_string();
    let tokens = tokens.map(|t| t.to_string()).unwrap_or_default();

    if let Err(e) = append_to_table(
        vault_root,
        &table_path,
        mcp_id,
        cfg.schema.as_deref(),
        &ts,
        &input_excerpt,
        &output_excerpt,
        &provider,
        &model,
        &tokens,
        extras.as_deref(),
    ) {
        tracing::warn!(mcp_id, error = %e, "mcp_capture: append failed");
    }
}

/// Read `~/.ctrl/mcps/<id>/manifest.{json,yaml,yml}` and pull the
/// `output_capture` block. Returns None when missing / malformed.
fn load_capture_cfg(_vault_root: &Path, mcp_id: &str) -> Option<OutputCaptureCfg> {
    let home = std::env::var("HOME").ok()?;
    let base = Path::new(&home).join(".ctrl/mcps").join(mcp_id);
    for filename in &["manifest.json", "manifest.yaml", "manifest.yml"] {
        let path = base.join(filename);
        if !path.exists() {
            continue;
        }
        let body = std::fs::read_to_string(&path).ok()?;
        // We do not depend on a YAML parser at the kernel layer; both
        // shapes are valid JSON-like for the capture block. Manifests
        // with YAML-only frontmatter fall through and use defaults.
        let v: Value = serde_json::from_str(&body).ok()?;
        let cap = v.get("output_capture")?;
        return serde_json::from_value(cap.clone()).ok();
    }
    Some(OutputCaptureCfg {
        enabled: true,
        table_path: None,
        schema: None,
    })
}

fn value_to_excerpt(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        _ => v.to_string(),
    }
}

/// Append a row to the markdown table file. Creates the file (header +
/// frontmatter schema) when absent. Rotates the file to
/// `archive/{mcp}-{YYYY}-Q{N}.md` once it exceeds 500 row lines.
fn append_to_table(
    vault_root: &Path,
    table_rel: &str,
    mcp_id: &str,
    schema: Option<&[Value]>,
    ts: &str,
    input_excerpt: &str,
    output_excerpt: &str,
    provider: &str,
    model: &str,
    tokens: &str,
    extras: Option<&[(String, String)]>,
) -> std::io::Result<()> {
    let abs = vault_root.join(table_rel);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut headers: Vec<String> = vec![
        "When".to_string(),
        "Input".to_string(),
        "Output".to_string(),
        "Provider".to_string(),
        "Model".to_string(),
        "Tokens".to_string(),
        "Accepted".to_string(),
    ];
    let mut extra_keys: Vec<String> = Vec::new();
    if let Some(s) = schema {
        for col in s {
            if let Some(label) = col.get("label").and_then(|v| v.as_str()) {
                if !headers.iter().any(|h| h == label) {
                    headers.push(label.to_string());
                    if let Some(key) = col.get("key").and_then(|v| v.as_str()) {
                        extra_keys.push(key.to_string());
                    }
                }
            }
        }
    }

    let frontmatter = format!(
        "---\ntitle: {mcp_id} runs\nmcp: {mcp_id}\ntype: mcp-output-table\n---\n\n"
    );

    let separator = format!(
        "|{}|\n|{}|\n",
        headers
            .iter()
            .map(|h| format!(" {h} "))
            .collect::<Vec<_>>()
            .join("|"),
        headers
            .iter()
            .map(|_| "---".to_string())
            .collect::<Vec<_>>()
            .join("|"),
    );

    let existing = std::fs::read_to_string(&abs).unwrap_or_default();
    if should_rotate(&existing) {
        let archive_rel = archive_path_for(table_rel);
        let archive_abs = vault_root.join(&archive_rel);
        if let Some(parent) = archive_abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&archive_abs, &existing)?;
        std::fs::write(&abs, "")?;
    }
    let existing = std::fs::read_to_string(&abs).unwrap_or_default();

    let mut row = format!(
        "| {ts} | {input} | {output} | {provider} | {model} | {tokens} |   |",
        ts = ts,
        input = escape_cell(input_excerpt),
        output = escape_cell(output_excerpt),
        provider = escape_cell(provider),
        model = escape_cell(model),
        tokens = tokens,
    );
    if let Some(ex) = extras {
        if !extra_keys.is_empty() {
            for key in &extra_keys {
                let v = ex
                    .iter()
                    .find(|(k, _)| k == key)
                    .map(|(_, v)| v.clone())
                    .unwrap_or_default();
                row.push_str(&format!(" {} |", escape_cell(&v)));
            }
        } else {
            for (_k, v) in ex {
                row.push_str(&format!(" {} |", escape_cell(v)));
            }
        }
    }
    row.push('\n');

    let new_body = if existing.trim().is_empty() {
        format!("{frontmatter}{separator}{row}")
    } else if existing.contains('|') {
        format!("{}{}", existing.trim_end(), format!("\n{row}"))
    } else {
        format!(
            "{}\n\n{}{}",
            existing.trim_end(),
            separator,
            row,
        )
    };
    std::fs::write(&abs, new_body)?;
    Ok(())
}

fn escape_cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

const ROW_ROTATE_THRESHOLD: usize = 500;

fn should_rotate(existing: &str) -> bool {
    existing
        .lines()
        .filter(|l| {
            let t = l.trim_start();
            t.starts_with('|') && !t.starts_with("|---")
        })
        .count()
        > ROW_ROTATE_THRESHOLD + 1
}

fn archive_path_for(table_rel: &str) -> String {
    let now = chrono::Local::now();
    let year = now.year();
    let quarter = ((now.month() - 1) / 3) + 1;
    let stem = std::path::Path::new(table_rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("table");
    format!("notes/mcp-runs/archive/{stem}-{year}-Q{quarter}.md")
}

use chrono::Datelike;

#[allow(dead_code)]
fn _silence_unused_vault_import() {
    let _ = vault::default_vault_root();
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn append_writes_header_on_empty_file() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let rel = "notes/mcp-runs/ocr.table.md";
        let result = append_to_table(
            root,
            rel,
            "ocr",
            None,
            "2026-06-03T01:00:00Z",
            "input",
            "output",
            "openai",
            "gpt-4",
            "123",
            None,
        );
        assert!(result.is_ok());
        let body = std::fs::read_to_string(root.join(rel)).unwrap();
        assert!(body.contains("title: ocr runs"));
        assert!(body.contains("| When |"));
        assert!(body.contains("openai"));
    }

    #[test]
    fn escape_cell_quotes_pipes() {
        assert_eq!(escape_cell("a | b"), "a \\| b");
        assert_eq!(escape_cell("multi\nline"), "multi line");
    }

    #[test]
    fn truncate_uses_char_boundary() {
        let s = "abcdefg";
        assert_eq!(truncate(s, 5), "abcde...");
        let short = "abc";
        assert_eq!(truncate(short, 5), "abc");
    }
}
