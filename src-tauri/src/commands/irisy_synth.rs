// Irisy synthesize — Layer 4 product surface (ADR-002 v5 §10 +
// `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.3,
// §5.5 question-vault, §5.10 cross-note synth).
//
// Three Tauri commands:
//   - `irisy_question_vault` — semantic search top-K → Pi summarizes
//     with citations.
//   - `irisy_synthesize_notes` — multi-path read → Pi merges per
//     instruction → writes result to a new vault path.
//   - `irisy_daily_summarize` — read today's sourcing inbox + SOUL.md
//     body + sourcing-prompt → Pi writes a daily summary into
//     `daily/{date}.md` top.
//
// All three follow the same shape: collect context → wrap in a
// system+user message pair → drain the provider stream → return the
// resulting markdown. Pi (provider_registry.primary_text_chat()) is
// the substrate; we never bind to a specific model id here.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::kernel::provider::{ChatOpts, LlmMessage, LlmPrompt};
use crate::kernel::vault;
use crate::kernel::vault_embeddings::{content_hash, VaultEmbeddings};
use crate::kernel::provider::ollama_embed::OllamaEmbedClient;
use crate::shell::KernelHandle;

fn vault_root_or_err() -> Result<std::path::PathBuf, String> {
    vault::default_vault_root().ok_or_else(|| "HOME env var not set".to_string())
}

fn embed_db_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".ctrl/embeddings.db"))
}

async fn pi_complete(
    kernel: &KernelHandle,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let adapter = kernel
        .runtime
        .provider_registry
        .primary_text_chat()
        .ok_or_else(|| {
            "No text.chat provider available. Open Settings → Brain.".to_string()
        })?;
    let prompt = LlmPrompt {
        system: Some(system_prompt.to_string()),
        messages: vec![LlmMessage {
            role: "user".to_string(),
            content: user_prompt.to_string(),
        }],
        temperature: Some(0.4),
        max_tokens: Some(2048),
    };
    let opts = ChatOpts {
        model: String::new(),
        deadline_ms: 120_000,
    };
    let mut rx = adapter
        .chat_stream(&prompt, &opts)
        .await
        .map_err(|e| format!("Pi chat start: {e}"))?;
    let mut out = String::new();
    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => {
                out.push_str(&chunk.delta);
                if chunk.finish_reason.is_some() {
                    break;
                }
            }
            Err(e) => return Err(format!("Pi chat stream: {e}")),
        }
    }
    Ok(out)
}

// ─────────────────────────── 1. Question vault ─────────────────────────

#[derive(Debug, Deserialize)]
pub struct QuestionVaultArgs {
    /// Natural-language query (e.g. "what did I learn about onboarding").
    pub question: String,
    /// Top-K notes retrieved for the RAG context. Default 6.
    #[serde(default)]
    pub top_k: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct QuestionVaultReply {
    pub answer: String,
    pub citations: Vec<String>,
}

const QUESTION_SYSTEM: &str = "You are Irisy, the AI companion built into CTRL. Answer the user's question USING ONLY the supplied vault excerpts. Output a tight, direct answer in the same language as the question. If the excerpts do not contain the answer, say so plainly — do not fabricate. End the answer with a 'Citations:' list of the source paths you actually used.";

#[tauri::command]
pub async fn irisy_question_vault(
    args: QuestionVaultArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<QuestionVaultReply, String> {
    let top_k = args.top_k.unwrap_or(6);
    let root = vault_root_or_err()?;
    // 1. Embed the question.
    let client = OllamaEmbedClient::new();
    let q_vec = client
        .embed(&args.question)
        .await
        .map_err(|e| format!("embed question: {e}"))?;
    // 2. Top-K paths.
    let emb = VaultEmbeddings::open(&embed_db_path()?, "nomic-embed-text")
        .map_err(|e| e.to_string())?;
    let hits = emb
        .search(&q_vec, top_k, None)
        .map_err(|e| e.to_string())?;
    if hits.is_empty() {
        return Ok(QuestionVaultReply {
            answer: "No vault notes embedded yet — run vault.reembed_all first or write some notes.".to_string(),
            citations: vec![],
        });
    }
    // 3. Build the RAG context.
    let mut ctx = String::new();
    let mut citations = Vec::new();
    for hit in &hits {
        if let Ok(entry) = vault::read(&root, &hit.path) {
            let preview: String = entry.content.chars().take(800).collect();
            ctx.push_str(&format!("\n\n### {}\n{}", hit.path, preview));
            citations.push(hit.path.clone());
        }
    }
    let user_prompt = format!(
        "Question: {}\n\nVault excerpts:{}",
        args.question, ctx
    );
    let answer = pi_complete(&kernel, QUESTION_SYSTEM, &user_prompt).await?;
    Ok(QuestionVaultReply { answer, citations })
}

// ──────────────────────── 2. Cross-note synthesize ─────────────────────

#[derive(Debug, Deserialize)]
pub struct SynthesizeArgs {
    /// Vault-relative paths to read + feed to Pi.
    pub paths: Vec<String>,
    /// Free-form instruction (e.g. "merge these into one note",
    /// "find contradictions", "what changed compared to last week").
    pub instruction: String,
    /// Optional output path. If None, Pi's output is returned to the
    /// caller without being written.
    #[serde(default)]
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SynthesizeReply {
    pub result: String,
    pub written_to: Option<String>,
}

const SYNTH_SYSTEM: &str = "You are Irisy. The user is asking you to synthesize across multiple of their notes. Follow the instruction precisely. Output well-formed markdown. Preserve user voice unless the instruction asks for a tone shift. Do NOT invent facts not present in the source notes.";

#[tauri::command]
pub async fn irisy_synthesize_notes(
    args: SynthesizeArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<SynthesizeReply, String> {
    if args.paths.is_empty() {
        return Err("at least one path is required".into());
    }
    let root = vault_root_or_err()?;
    let mut blocks = String::new();
    let mut seen: HashSet<String> = HashSet::new();
    for path in &args.paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        let entry = vault::read(&root, path).map_err(|e| format!("read {path}: {e}"))?;
        blocks.push_str(&format!("\n\n## SOURCE: {}\n{}", entry.path, entry.content));
    }
    let user_prompt = format!(
        "INSTRUCTION:\n{}\n\nSOURCE NOTES:{}",
        args.instruction, blocks
    );
    let result = pi_complete(&kernel, SYNTH_SYSTEM, &user_prompt).await?;
    let mut written_to = None;
    if let Some(out) = &args.output_path {
        let fm = serde_json::json!({
            "type": "synthesis",
            "synthesized_from": args.paths,
            "instruction": args.instruction,
            "by": "irisy",
        });
        vault::write(&root, out, &result, &fm).map_err(|e| e.to_string())?;
        written_to = Some(out.clone());
    }
    Ok(SynthesizeReply {
        result,
        written_to,
    })
}

// ─────────────────── 3. Daily summary (Pi-driven sourcing) ─────────────

#[derive(Debug, Deserialize)]
pub struct DailySummarizeArgs {
    /// Local date `YYYY-MM-DD` to attribute the summary to. Defaults to
    /// today (kernel local tz).
    #[serde(default)]
    pub date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DailySummarizeReply {
    pub daily_path: String,
    pub summary: String,
    pub items_in_inbox: usize,
}

const DAILY_SYSTEM: &str = "You are Irisy. The user wants a tight daily summary of their inbox + most-recent activity. Output well-formed markdown with three sections: 'Highlights' (3 bullets max), 'Action items' (markdown checkbox list), and 'Open questions' (bullets, optional). Match the user's writing language.";

#[tauri::command]
pub async fn irisy_daily_summarize(
    args: DailySummarizeArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<DailySummarizeReply, String> {
    let root = vault_root_or_err()?;
    let date = args.date.unwrap_or_else(|| {
        let now = chrono::Local::now();
        format!(
            "{:04}-{:02}-{:02}",
            now.year(),
            now.month(),
            now.day(),
        )
    });
    // Collect sourcing inbox bodies.
    let inbox = vault::list(&root, Some("sourcing"))
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|p| p.ends_with(".md"))
        .collect::<Vec<_>>();
    let items_in_inbox = inbox.len();
    let mut bodies = String::new();
    for path in &inbox {
        if let Ok(entry) = vault::read(&root, path) {
            let preview: String = entry.content.chars().take(600).collect();
            bodies.push_str(&format!("\n\n### {}\n{}", entry.path, preview));
        }
    }
    // Optional sourcing prompt + SOUL body as extra system context.
    let extra = vault::read(&root, ".ctrl/sourcing-prompt.md")
        .map(|e| e.content)
        .unwrap_or_default();
    let soul = vault::read(&root, "irisy/SOUL.md")
        .map(|e| e.content)
        .unwrap_or_default();
    let system = format!("{DAILY_SYSTEM}\n\n{extra}\n\n--- Your soul ---\n{soul}");
    let user_prompt = format!(
        "Date: {}\nInbox items ({}):{}\n\nWrite the summary.",
        date, items_in_inbox, bodies
    );
    let summary = pi_complete(&kernel, &system, &user_prompt).await?;
    let daily_rel = format!("daily/{date}.md");
    let fm = serde_json::json!({
        "type": "journal",
        "tags": ["daily"],
        "summary_by": "irisy",
        "summary_at": chrono::Utc::now().to_rfc3339(),
    });
    vault::write(&root, &daily_rel, &summary, &fm).map_err(|e| e.to_string())?;
    Ok(DailySummarizeReply {
        daily_path: daily_rel,
        summary,
        items_in_inbox,
    })
}

// Pull in chrono::Datelike for date access.
use chrono::Datelike;

// Force a compile-time reference so the dead-code warning never fires
// on a helper we still expose for tests.
#[allow(dead_code)]
fn _touch_content_hash() -> &'static str {
    let _ = content_hash("");
    Path::new("/").to_str().unwrap_or("")
}
