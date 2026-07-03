//! Vault git audit layer (ADR-002 §1.9 v46 / notes-plan S4 — the Tolaria
//! git-as-AI-audit-trail idea, CTRL-native): every SUCCESSFUL mutating gate
//! call on a vault-backed domain auto-commits the vault with the CALLER as
//! the git author, so `git log` answers "what did the AI change vs what did
//! I write" at the file layer — complementing the gate's audit ledger (call
//! layer) per transparency-by-drill-down.
//!
//! Opt-in by construction: a vault without `.git` is untouched (the user
//! initializes via the existing `git_init` command / Notes UI). Commits are
//! COALESCED (a quiet-window timer, flushed early when the author changes)
//! so PWA auto-save typing bursts become one commit, while a user-edit
//! followed by an Irisy edit still yields two attributed commits.

use crate::kernel::vault::default_vault_root;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::mpsc;

/// Quiet window before a pending commit lands (coalesces bursts).
const QUIET: Duration = Duration::from_secs(20);
/// Hard cap: a pending commit never waits longer than this even under a
/// continuous write stream.
const MAX_WAIT: Duration = Duration::from_secs(120);

/// Domains whose writes live in the vault (git-visible). Everything else
/// (kv / llm / net / registry / mcp packs) has no file-layer footprint.
const VAULT_DOMAINS: &[&str] = &["vault", "notes", "smart_table", "tasks", "calendar"];

/// Should a successful call to `tool` schedule an auto-commit?
/// Mutating verb (same classifier as the review gate) AND a vault-backed domain.
pub fn should_autocommit(tool: &str) -> bool {
    crate::kernel::review_gate::requires_review(tool)
        && VAULT_DOMAINS.contains(&crate::kernel::visibility::tool_domain(tool))
}

/// Map a gate caller onto a git author. The PWA is the human's own surface →
/// the user; every external caller (irisy / hermes / claude-code / …) is an
/// agent and keeps its own name so multi-agent vaults stay distinguishable.
pub fn author_of(caller: &str) -> (String, String) {
    if caller == "pwa" {
        ("user".to_string(), "user@ctrl.local".to_string())
    } else {
        (caller.to_string(), format!("{caller}@ctrl.local"))
    }
}

#[derive(Debug, Clone)]
struct PendingWrite {
    caller: String,
    tool: String,
}

/// Schedule an auto-commit for a successful mutating gate call. Fire-and-forget:
/// never blocks or fails the call. No-op when the vault is not a git repo.
pub fn schedule(caller: &str, tool: &str) {
    let tx = worker();
    let _ = tx.send(PendingWrite { caller: caller.to_string(), tool: tool.to_string() });
}

/// The background coalescer — one per process, started lazily.
fn worker() -> &'static mpsc::UnboundedSender<PendingWrite> {
    static TX: OnceLock<mpsc::UnboundedSender<PendingWrite>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, mut rx) = mpsc::unbounded_channel::<PendingWrite>();
        tokio::spawn(async move {
            loop {
                // Wait for the first write of a batch.
                let Some(first) = rx.recv().await else { break };
                let mut caller = first.caller;
                let mut tools: Vec<String> = vec![first.tool];
                let batch_start = tokio::time::Instant::now();
                // Coalesce until QUIET with no writes, MAX_WAIT total, or the
                // author changes (flush so attribution never blends).
                loop {
                    let elapsed = batch_start.elapsed();
                    if elapsed >= MAX_WAIT {
                        break;
                    }
                    let window = QUIET.min(MAX_WAIT - elapsed);
                    match tokio::time::timeout(window, rx.recv()).await {
                        Ok(Some(next)) => {
                            if next.caller != caller {
                                // Author boundary: land the current batch, then
                                // start a new one for the new caller.
                                commit_batch(&caller, &tools).await;
                                caller = next.caller;
                                tools = vec![next.tool];
                            } else {
                                if !tools.contains(&next.tool) {
                                    tools.push(next.tool);
                                }
                            }
                        }
                        Ok(None) => {
                            commit_batch(&caller, &tools).await;
                            return;
                        }
                        Err(_) => break, // quiet window elapsed
                    }
                }
                commit_batch(&caller, &tools).await;
            }
        });
        tx
    })
}

/// Land one coalesced commit. Quietly does nothing when the vault has no
/// `.git` or nothing actually changed.
async fn commit_batch(caller: &str, tools: &[String]) {
    let Some(root) = default_vault_root() else { return };
    if !root.join(".git").is_dir() {
        return;
    }
    let (name, email) = author_of(caller);
    let msg = format!("{}: {}", if caller == "pwa" { "edit" } else { "agent" }, tools.join(", "));
    if let Err(e) = add_all_and_commit(&root, &name, &email, &msg).await {
        tracing::debug!(error = %e, "vault git autocommit skipped");
    }
}

async fn run_git(root: &Path, args: &[&str]) -> Result<(String, i32), String> {
    let out = tokio::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .await
        .map_err(|e| format!("git spawn: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    Ok((stdout, out.status.code().unwrap_or(-1)))
}

async fn add_all_and_commit(
    root: &Path,
    name: &str,
    email: &str,
    msg: &str,
) -> Result<(), String> {
    run_git(root, &["add", "-A"]).await?;
    // Anything staged? `diff --cached --quiet` exits 1 when there are changes.
    let (_, code) = run_git(root, &["diff", "--cached", "--quiet"]).await?;
    if code == 0 {
        return Ok(()); // nothing to commit
    }
    let author = format!("{name} <{email}>");
    // -c user.* covers a repo with no identity configured (fresh git init).
    let (_, code) = run_git(
        root,
        &[
            "-c",
            &format!("user.name={name}"),
            "-c",
            &format!("user.email={email}"),
            "commit",
            "--author",
            &author,
            "-m",
            msg,
            "--quiet",
        ],
    )
    .await?;
    if code != 0 {
        return Err(format!("git commit exited {code}"));
    }
    Ok(())
}

// ─── read-side: history / diff / pulse (E6) ─────────────────────────────────

/// One commit touching a note (unit separator–framed porcelain output).
#[derive(Debug, serde::Serialize)]
pub struct NoteCommit {
    pub rev: String,
    pub author: String,
    /// Unix seconds.
    pub time: i64,
    pub message: String,
}

/// Per-note history: `git log --follow` so renames keep their trail.
pub async fn note_history(root: &Path, path: &str, limit: usize) -> Result<Vec<NoteCommit>, String> {
    let n = format!("-{limit}");
    let (out, code) = run_git(
        root,
        &["log", &n, "--follow", "--pretty=format:%H%x1f%an%x1f%at%x1f%s", "--", path],
    )
    .await?;
    if code != 0 {
        return Err(format!("git log exited {code}"));
    }
    Ok(out
        .lines()
        .filter_map(|l| {
            let mut it = l.split('\u{1f}');
            Some(NoteCommit {
                rev: it.next()?.to_string(),
                author: it.next()?.to_string(),
                time: it.next()?.parse().ok()?,
                message: it.next().unwrap_or("").to_string(),
            })
        })
        .collect())
}

/// The unified diff one commit made to one note.
pub async fn note_diff(root: &Path, path: &str, rev: &str) -> Result<String, String> {
    // Guard the rev shape (hex only) — it lands in an argv slot, never a shell,
    // but a stray flag-looking value must not become a git option.
    if rev.is_empty() || !rev.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("rev must be a hex commit id".to_string());
    }
    let range = format!("{rev}^!");
    let (out, code) = run_git(root, &["diff", &range, "--", path]).await?;
    if code != 0 {
        return Err(format!("git diff exited {code}"));
    }
    Ok(out)
}

/// One day of vault activity (the Pulse view's bar).
#[derive(Debug, serde::Serialize)]
pub struct PulseDay {
    /// YYYY-MM-DD (author-local dates as git reports them).
    pub date: String,
    pub commits: u32,
    pub by_user: u32,
    pub by_agents: u32,
}

/// Vault activity over the last `days`: per-day commit counts split
/// user-vs-agents + the most recent commits (Tolaria Pulse parity).
pub async fn pulse(root: &Path, days: u32) -> Result<(Vec<PulseDay>, Vec<NoteCommit>), String> {
    let since = format!("--since={days} days ago");
    let (out, code) = run_git(
        root,
        &["log", &since, "--date=short", "--pretty=format:%H%x1f%an%x1f%at%x1f%s%x1f%ad"],
    )
    .await?;
    if code != 0 {
        return Err(format!("git log exited {code}"));
    }
    let mut by_date: std::collections::BTreeMap<String, PulseDay> = Default::default();
    let mut recent: Vec<NoteCommit> = Vec::new();
    for l in out.lines() {
        let mut it = l.split('\u{1f}');
        let (Some(rev), Some(author), Some(time), Some(message), Some(date)) =
            (it.next(), it.next(), it.next(), it.next(), it.next())
        else {
            continue;
        };
        let day = by_date.entry(date.to_string()).or_insert_with(|| PulseDay {
            date: date.to_string(),
            commits: 0,
            by_user: 0,
            by_agents: 0,
        });
        day.commits += 1;
        if author == "user" {
            day.by_user += 1;
        } else {
            day.by_agents += 1;
        }
        if recent.len() < 20 {
            recent.push(NoteCommit {
                rev: rev.to_string(),
                author: author.to_string(),
                time: time.parse().unwrap_or(0),
                message: message.to_string(),
            });
        }
    }
    Ok((by_date.into_values().rev().collect(), recent))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autocommit_classifier_is_domain_and_verb_scoped() {
        // Vault-domain writes → yes.
        assert!(should_autocommit("vault_write"));
        assert!(should_autocommit("doc_produce"));
        assert!(should_autocommit("smart_table_produce"));
        assert!(should_autocommit("task_produce"));
        assert!(should_autocommit("calendar_produce"));
        assert!(should_autocommit("vault_delete"));
        // Reads → no.
        assert!(!should_autocommit("vault_read"));
        assert!(!should_autocommit("note_map"));
        assert!(!should_autocommit("calendar_query"));
        // Mutating but NOT vault-backed → no file-layer footprint.
        assert!(!should_autocommit("http_post"));
        assert!(!should_autocommit("mcp_pack_run"));
        assert!(!should_autocommit("kv_set"));
        assert!(!should_autocommit("llm_chat"));
    }

    #[test]
    fn author_mapping_separates_user_from_agents() {
        assert_eq!(author_of("pwa").0, "user");
        assert_eq!(author_of("irisy").0, "irisy");
        assert_eq!(author_of("claude-code").0, "claude-code");
    }

    #[test]
    fn note_diff_rejects_non_hex_rev() {
        // Argv-injection guard: a flag-shaped rev must be rejected before git.
        let rt = tokio::runtime::Runtime::new().unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let err = rt.block_on(note_diff(dir.path(), "a.md", "--output=/tmp/x")).unwrap_err();
        assert!(err.contains("hex"));
        let err = rt.block_on(note_diff(dir.path(), "a.md", "")).unwrap_err();
        assert!(err.contains("hex"));
    }

    // End-to-end against a REAL git repo in a tempdir: init → write → commit
    // batch as two authors → history + pulse read back the attribution.
    #[tokio::test]
    async fn commit_history_and_pulse_roundtrip_with_attribution() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        // A machine without git would fail spawn — treat as environment skip.
        if run_git(&root, &["init", "-q"]).await.is_err() {
            eprintln!("git unavailable; skipping");
            return;
        }
        std::fs::write(root.join("n.md"), "v1\n").unwrap();
        add_all_and_commit(&root, "user", "user@ctrl.local", "edit: vault_write")
            .await
            .unwrap();
        std::fs::write(root.join("n.md"), "v2 by agent\n").unwrap();
        add_all_and_commit(&root, "irisy", "irisy@ctrl.local", "agent: doc_produce")
            .await
            .unwrap();
        // Nothing changed → no third commit, no error.
        add_all_and_commit(&root, "irisy", "irisy@ctrl.local", "agent: noop").await.unwrap();

        let hist = note_history(&root, "n.md", 10).await.unwrap();
        assert_eq!(hist.len(), 2);
        assert_eq!(hist[0].author, "irisy", "newest first, agent-attributed");
        assert_eq!(hist[1].author, "user");

        let diff = note_diff(&root, "n.md", &hist[0].rev).await.unwrap();
        assert!(diff.contains("+v2 by agent"));
        assert!(diff.contains("-v1"));

        let (daysv, recent) = pulse(&root, 7).await.unwrap();
        assert_eq!(daysv.len(), 1);
        assert_eq!(daysv[0].commits, 2);
        assert_eq!(daysv[0].by_user, 1);
        assert_eq!(daysv[0].by_agents, 1);
        assert_eq!(recent.len(), 2);
    }
}
