// Git Tauri commands — minimal vault-side git operations driven by
// `git` CLI subprocess (cheapest path; no libgit2 / isomorphic-git fs
// adapter to maintain).
//
// (ADR-002 substrate § vault v1 §8.6 v5 + bao 2026-06-03 — kairo Git
// parity batch.)
//
// Surface (mirrors the kairo Git integration that we never got to
// vendor due to seahop/kairo repo deletion):
//   - git_status      : summary status (branch, ahead/behind, dirty)
//   - git_init        : `git init` in the vault root
//   - git_commit_all  : `git add -A && git commit -m <msg>`
//   - git_push        : `git push` (uses whatever remote is configured)
//   - git_log         : last N commits as structured entries
//
// All commands run with cwd = vault_root and capture stdout/stderr.

use crate::kernel::vault::default_vault_root;
use serde::Serialize;
use std::path::PathBuf;
use tokio::process::Command;

fn vault_root() -> Result<PathBuf, String> {
    default_vault_root().ok_or_else(|| "HOME env var not set".to_string())
}

async fn run_git(args: &[&str]) -> Result<(String, String, i32), String> {
    let root = vault_root()?;
    let output = Command::new("git")
        .args(args)
        .current_dir(&root)
        .output()
        .await
        .map_err(|e| format!("git spawn: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((stdout, stderr, output.status.code().unwrap_or(-1)))
}

#[derive(Debug, Serialize)]
pub struct GitStatus {
    pub initialised: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub modified: u32,
    pub untracked: u32,
    pub clean: bool,
    pub last_error: Option<String>,
}

/// Parse `git status --porcelain=v1 --branch` output.
fn parse_status(raw: &str) -> GitStatus {
    let mut status = GitStatus {
        initialised: true,
        branch: None,
        ahead: 0,
        behind: 0,
        staged: 0,
        modified: 0,
        untracked: 0,
        clean: true,
        last_error: None,
    };
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            // Examples: `main...origin/main [ahead 1, behind 2]`
            let branch_part = rest.split('.').next().unwrap_or(rest);
            status.branch = Some(branch_part.trim().to_string());
            if let Some(ahead_idx) = rest.find("ahead ") {
                let tail = &rest[ahead_idx + 6..];
                if let Some(end) = tail.find(|c: char| !c.is_ascii_digit()) {
                    if let Ok(n) = tail[..end].parse::<u32>() {
                        status.ahead = n;
                    }
                }
            }
            if let Some(behind_idx) = rest.find("behind ") {
                let tail = &rest[behind_idx + 7..];
                if let Some(end) = tail.find(|c: char| !c.is_ascii_digit()) {
                    if let Ok(n) = tail[..end].parse::<u32>() {
                        status.behind = n;
                    }
                }
            }
            continue;
        }
        if line.starts_with("??") {
            status.untracked += 1;
            status.clean = false;
            continue;
        }
        if line.len() >= 2 {
            let xy = &line[..2];
            let staged_ch = xy.chars().next().unwrap_or(' ');
            let work_ch = xy.chars().nth(1).unwrap_or(' ');
            if staged_ch != ' ' && staged_ch != '?' {
                status.staged += 1;
                status.clean = false;
            }
            if work_ch != ' ' && work_ch != '?' {
                status.modified += 1;
                status.clean = false;
            }
        }
    }
    status
}

#[tauri::command]
pub async fn git_status() -> Result<GitStatus, String> {
    let root = vault_root()?;
    if !root.join(".git").exists() {
        return Ok(GitStatus {
            initialised: false,
            branch: None,
            ahead: 0,
            behind: 0,
            staged: 0,
            modified: 0,
            untracked: 0,
            clean: true,
            last_error: None,
        });
    }
    let (stdout, stderr, code) = run_git(&["status", "--porcelain=v1", "--branch"]).await?;
    if code != 0 {
        return Ok(GitStatus {
            initialised: true,
            branch: None,
            ahead: 0,
            behind: 0,
            staged: 0,
            modified: 0,
            untracked: 0,
            clean: false,
            last_error: Some(if stderr.is_empty() { stdout } else { stderr }),
        });
    }
    Ok(parse_status(&stdout))
}

#[tauri::command]
pub async fn git_init() -> Result<String, String> {
    let (stdout, stderr, code) = run_git(&["init"]).await?;
    if code != 0 {
        return Err(format!("git init failed: {}", if stderr.is_empty() { stdout } else { stderr }));
    }
    Ok(stdout.trim().to_string())
}

#[derive(Debug, serde::Deserialize)]
pub struct GitCommitArgs {
    pub message: String,
}

#[tauri::command]
pub async fn git_commit_all(args: GitCommitArgs) -> Result<String, String> {
    let message = args.message.trim().to_string();
    if message.is_empty() {
        return Err("commit message is required".to_string());
    }
    let (add_out, add_err, add_code) = run_git(&["add", "-A"]).await?;
    if add_code != 0 {
        return Err(format!("git add: {}", if add_err.is_empty() { add_out } else { add_err }));
    }
    let (out, err, code) = run_git(&["commit", "-m", &message]).await?;
    if code != 0 {
        return Err(format!("git commit: {}", if err.is_empty() { out } else { err }));
    }
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn git_push() -> Result<String, String> {
    let (out, err, code) = run_git(&["push"]).await?;
    if code != 0 {
        return Err(format!("git push: {}", if err.is_empty() { out } else { err }));
    }
    Ok(out.trim().to_string())
}

#[derive(Debug, Serialize)]
pub struct GitLogEntry {
    pub sha: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[tauri::command]
pub async fn git_log() -> Result<Vec<GitLogEntry>, String> {
    // `--pretty=format:%H%x01%an%x01%ad%x01%s` gives us four
    // SOH-separated fields per commit; --date=iso-strict keeps the
    // timestamp machine-parseable.
    let (stdout, stderr, code) = run_git(&[
        "log",
        "-n",
        "50",
        "--pretty=format:%H%x01%an%x01%ad%x01%s",
        "--date=iso-strict",
    ])
    .await?;
    if code != 0 {
        // `git log` fails when there are no commits yet; surface as
        // empty rather than error so the UI can show "no commits".
        if stderr.contains("does not have any commits") {
            return Ok(Vec::new());
        }
        return Err(format!("git log: {}", if stderr.is_empty() { stdout } else { stderr }));
    }
    let mut out: Vec<GitLogEntry> = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(4, '\u{0001}').collect();
        if parts.len() != 4 {
            continue;
        }
        out.push(GitLogEntry {
            sha: parts[0].to_string(),
            author: parts[1].to_string(),
            date: parts[2].to_string(),
            message: parts[3].to_string(),
        });
    }
    Ok(out)
}
