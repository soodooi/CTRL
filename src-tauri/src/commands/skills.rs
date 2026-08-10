// Legacy direct GitHub Skill-search adapter. An optional developer PAT stays
// in the OS keychain; results must normalize into the one local registry, and
// install remains anonymous and local. Cloud search is optional augmentation,
// never a second registry or install owner.
// (ADR-002 substrate §16 v81; ADR-006 cross-cutting §7 v13)
//
// This command remains a compatibility surface until Library consumes the
// normalized provider adapter directly. It returns CTRL's bounded result shape,
// not raw GitHub JSON.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Keychain account holding the GitHub PAT (service is `app.ctrl`). See
/// docs/development/setup-github-token.md for how to store it.
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
            // Optional developer PAT guidance for the direct local-search adapter.
            // (ADR-002 substrate §16 v81)
            "No GitHub token in Keychain. Store a PAT under service 'app.ctrl' \
             account 'github' — see docs/development/setup-github-token.md."
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

    let total = json
        .get("total_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let items = json
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let results = items.iter().filter_map(parse_item).collect::<Vec<_>>();

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
    Some(SkillResult {
        repo,
        owner,
        name,
        description,
        stars,
        path,
        html_url,
    })
}

// ── Local skill discovery ───────────────────────────────────────────────────
// Skills are plain-text methods in the one local registry and never runtime or
// session owners. (ADR-002 substrate §16 v81; ADR-005 irisy §11 v40)
// Irisy needs to know which skills the active brain already has locally (user
// skills + installed plugin skills) so it can compose a mcp manifest that
// references one by name. This is the no-token path — distinct from
// `search_skills` (GitHub, needs a PAT). System primitive only; Irisy decides
// what to do with the list (feedback_build_system_not_business).

#[derive(Debug, Clone, Serialize)]
pub struct LocalSkill {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
}

/// Cap on returned skills — there can be hundreds of plugin skills; dumping
/// them all into the brain's context is slow + useless. Irisy passes a query
/// to narrow; this bounds the worst case.
const MAX_LOCAL_SKILLS: usize = 40;
// Release-owned playbooks are projected as ordinary Markdown and may be pinned
// as method scope for the sole Irisy session. (ADR-005 irisy §11 v40)
const CREATE_FEATURE_PACK_SKILL: &str =
    include_str!("../../../ctrl-skills/skills/create-feature-pack/SKILL.md");
const OFFICE_SKILL: &str = include_str!("../../../ctrl-skills/skills/office/SKILL.md");
/// Authoring playbook for a local application adapter. Creating one is a Coding
/// job guided by a governed skill, not a bespoke authoring UI: the accepted
/// pattern is already an MCP-server pack, so the skill is what makes it
/// reproducible. (ADR-004 cap § execution v14)
const CREATE_LOCAL_APP_ADAPTER_SKILL: &str =
    include_str!("../../../ctrl-skills/skills/create-local-app-adapter/SKILL.md");
const BUNDLED_CTRL_SKILLS: &[(&str, &str)] = &[
    ("create-feature-pack", CREATE_FEATURE_PACK_SKILL),
    ("create-local-app-adapter", CREATE_LOCAL_APP_ADAPTER_SKILL),
    ("office", OFFICE_SKILL),
];

fn ctrl_skills_root(home: &Path) -> PathBuf {
    home.join(".ctrl").join("skills")
}

/// Materialize CTRL-owned skills as ordinary Markdown before discovery. User
/// skills are scanned first and therefore override an identically named builtin;
/// release copies are refreshed atomically so Irisy and external BYO CLI clients
/// can consume the same governed local playbooks. (ADR-005 irisy §11 v40)
fn ensure_bundled_ctrl_skills(root: &Path) -> Result<(), String> {
    static REFRESH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = REFRESH_LOCK
        .lock()
        .map_err(|_| "bundled CTRL skill refresh lock poisoned".to_string())?;

    for (name, content) in BUNDLED_CTRL_SKILLS {
        ensure_bundled_ctrl_skill(root, name, content)?;
    }
    Ok(())
}

fn ensure_bundled_ctrl_skill(root: &Path, name: &str, content: &str) -> Result<(), String> {
    // Each release-owned playbook has one atomic local Markdown authority.
    // (ADR-001 spine §4 v20)
    let dir = root.join(name);
    let path = dir.join("SKILL.md");
    let backup = dir.join("SKILL.md.backup");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create CTRL skill {name}: {e}"))?;

    // Recover the last known-good copy if a Windows replacement was interrupted.
    // (ADR-001 spine §4 v20)
    if !path.exists() && backup.exists() {
        std::fs::rename(&backup, &path)
            .map_err(|e| format!("recover bundled CTRL skill {name}: {e}"))?;
    }
    // Release bytes replace stale managed copies; user overrides live in the
    // higher-precedence user root. (ADR-001 spine §4 v20)
    if std::fs::read_to_string(&path).ok().as_deref() == Some(content) {
        let _ = std::fs::remove_file(&backup);
        return Ok(());
    }

    static NEXT_TMP_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let tmp_id = NEXT_TMP_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = dir.join(format!("SKILL.md.tmp-{}-{tmp_id}", std::process::id()));
    // Durably stage the complete release bytes before replacement.
    // (ADR-001 spine §4 v20)
    let mut tmp_file = std::fs::File::create(&tmp)
        .map_err(|e| format!("create bundled CTRL skill {name} temp file: {e}"))?;
    std::io::Write::write_all(&mut tmp_file, content.as_bytes())
        .and_then(|_| tmp_file.sync_all())
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("write bundled CTRL skill {name}: {e}")
        })?;
    drop(tmp_file);

    // Unix rename replaces atomically. Windows needs a recoverable backup.
    // (ADR-001 spine §4 v20)
    if let Err(first_error) = std::fs::rename(&tmp, &path) {
        if !path.exists() {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("install bundled CTRL skill {name}: {first_error}"));
        }
        // Preserve the last durable managed copy until replacement succeeds.
        // (ADR-001 spine §4 v20)
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(&path, &backup).map_err(|backup_error| {
            let _ = std::fs::remove_file(&tmp);
            format!(
                "stage bundled CTRL skill {name} backup after rename failed ({first_error}): {backup_error}"
            )
        })?;
        // Restore the managed authority if the platform-specific retry fails.
        // (ADR-001 spine §4 v20)
        if let Err(retry_error) = std::fs::rename(&tmp, &path) {
            let restore_result = std::fs::rename(&backup, &path);
            let _ = std::fs::remove_file(&tmp);
            return match restore_result {
                Ok(()) => Err(format!("replace bundled CTRL skill {name}: {retry_error}")),
                Err(restore_error) => Err(format!(
                    "replace bundled CTRL skill {name} ({retry_error}); restore backup failed: {restore_error}"
                )),
            };
        }
        let _ = std::fs::remove_file(&backup);
    }
    Ok(())
}

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

/// Resolve one explicit user pin through the same hot-scanned authority used by
/// skill_list. Exact resolution scans the full registry before any discovery
/// result cap, so a valid pin cannot be misclassified as stale. An unavailable
/// or unreadable id fails visibly; explicit pinning never degrades to Auto.
/// (ADR-002 substrate §16 v81; ADR-005 irisy §11 v40)
pub async fn load_local_skill_by_name(skill_id: &str) -> Result<String, String> {
    let skill_id = skill_id.to_string();
    let lookup_id = skill_id.clone();
    let unavailable = || {
        format!(
            "Pinned skill \"{skill_id}\" is unavailable or unreadable. Choose another skill or Auto."
        )
    };
    let skill = tokio::task::spawn_blocking(move || {
        scan_local_skills_blocking()
            .map(|skills| skills.into_iter().find(|skill| skill.name == lookup_id))
    })
    .await
    .map_err(|_| unavailable())?
    .map_err(|_| unavailable())?
    .ok_or_else(&unavailable)?;

    read_local_skill(skill.path)
        .await
        .map_err(|_| unavailable())
}

fn list_local_skills_blocking(query: Option<String>) -> Result<Vec<LocalSkill>, String> {
    let mut out = scan_local_skills_blocking()?;

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

/// Build the complete local Skill registry in precedence order before any
/// discovery filtering or result cap is applied. The FCT catalog consumes this
/// same live authority rather than maintaining a second Skill index.
/// (ADR-002 substrate §16 v84)
pub(crate) fn scan_local_skills_blocking() -> Result<Vec<LocalSkill>, String> {
    let home = PathBuf::from(std::env::var("HOME").map_err(|_| "HOME not set".to_string())?);
    let mut out: Vec<LocalSkill> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // User skills override builtins with the same frontmatter name.
    let user_skills = home.join(".claude").join("skills");
    collect_skills_in(&user_skills, &mut out, &mut seen);

    // CTRL-owned, release-pinned playbooks are local Markdown too. Materialize
    // before every live scan so upgrades refresh them without a restart.
    let ctrl_skills = ctrl_skills_root(&home);
    ensure_bundled_ctrl_skills(&ctrl_skills)?;
    collect_skills_in(&ctrl_skills, &mut out, &mut seen);

    // Installed plugin skills: ~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/skills/<name>/SKILL.md
    let cache = home.join(".claude").join("plugins").join("cache");
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

    // Preserve deterministic output without changing first-hit source ownership.
    // (ADR-002 substrate §16 v81)
    out.sort_by(|a, b| a.name.cmp(&b.name));
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
/// (~/.claude/skills + ~/.ctrl/skills + ~/.claude/plugins/cache).
/// (ADR-002 substrate § 7.4 v34)
pub async fn read_local_skill(path: String) -> Result<String, String> {
    // Blocking fs (canonicalize + read) — same runtime-starvation reasoning as
    // list_local_skills: never run it on an async worker, or a saturated pool
    // makes this trivial read hang on the gate. Offload to the blocking pool.
    tokio::task::spawn_blocking(move || {
        let home = PathBuf::from(std::env::var("HOME").map_err(|_| "HOME not set".to_string())?);
        let roots = [
            home.join(".claude").join("skills"),
            home.join(".claude").join("plugins").join("cache"),
            ctrl_skills_root(&home),
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

    // The bundled playbook remains local, readable, and overridable while
    // preserving one release-owned fallback. (ADR-002 substrate § 7.4 v34)
    #[test]
    fn bundled_skill_is_materialized_and_stale_copy_is_refreshed() {
        let root = fresh_tmp("bundled");
        ensure_bundled_ctrl_skills(&root).expect("materialize bundled skill");
        let skill_md = root.join("create-feature-pack").join("SKILL.md");
        let office_md = root.join("office").join("SKILL.md");
        assert_eq!(
            std::fs::read_to_string(&skill_md).expect("read materialized skill"),
            CREATE_FEATURE_PACK_SKILL
        );
        assert_eq!(
            std::fs::read_to_string(&office_md).expect("read materialized office skill"),
            OFFICE_SKILL
        );

        std::fs::write(&skill_md, "stale release copy").unwrap();
        ensure_bundled_ctrl_skills(&root).expect("refresh bundled skill");
        assert_eq!(
            std::fs::read_to_string(&skill_md).expect("read refreshed skill"),
            CREATE_FEATURE_PACK_SKILL
        );
        assert!(
            std::fs::read_dir(skill_md.parent().unwrap())
                .unwrap()
                .flatten()
                .all(|entry| !entry.file_name().to_string_lossy().contains(".tmp-")),
            "refresh must clean temporary skill files"
        );

        // Simulate a crash in the Windows replacement window: the old file was
        // moved to backup but the new file was not promoted. The next scan must
        // recover and then refresh without losing the playbook.
        std::fs::write(&skill_md, "last known good").unwrap();
        let backup = skill_md.parent().unwrap().join("SKILL.md.backup");
        std::fs::rename(&skill_md, &backup).unwrap();
        ensure_bundled_ctrl_skills(&root).expect("recover interrupted refresh");
        assert_eq!(
            std::fs::read_to_string(&skill_md).unwrap(),
            CREATE_FEATURE_PACK_SKILL
        );
        assert!(!backup.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    // The Office playbook is a shared release-owned skill and must preserve
    // the Companion boundary. (ADR-001 spine §4 v20) (ADR-005 irisy §10 v35)
    #[test]
    /// Creating a local application adapter is a Coding job guided by this
    /// skill. The skill is the authority, so it must actually carry the accepted
    /// boundaries and the full evidence list rather than gesturing at them.
    /// (ADR-004 cap § execution v14; ADR-005 irisy §12 v42 U16)
    #[test]
    fn bundled_local_app_adapter_skill_carries_the_accepted_rules() {
        for required in [
            // Discovery before bridging, and the private-protocol boundary.
            "Discover before you bridge",
            "The native protocol is private",
            // The rules that make an adapter reachable and honest.
            "record_source",
            "source_describe",
            "Explicit selection only",
            "Degrade honestly",
            // All six pieces of verification evidence must be named.
            "installed public entrypoint",
            "real-software end-to-end scenario",
            "agent-only scenario",
            "Semantic verification",
            "capability coverage inventory",
            "labelled truthfully",
        ] {
            assert!(
                CREATE_LOCAL_APP_ADAPTER_SKILL.contains(required),
                "local-app adapter skill missing {required}"
            );
        }
        // A bundled connector must never auto-seed, and a write path is not
        // implied by a read one.
        // Matched on one line: the prose wraps, so a multi-word phrase spanning a
        // line break would make this assertion depend on formatting.
        assert!(CREATE_LOCAL_APP_ADAPTER_SKILL.contains("auto-seeded"));
        assert!(CREATE_LOCAL_APP_ADAPTER_SKILL.contains("explicitly connects it"));
        assert!(CREATE_LOCAL_APP_ADAPTER_SKILL.contains("Writes are not free"));
    }

    #[test]
    fn bundled_office_skill_is_read_only_and_hides_private_transport() {
        for required in [
            "source_describe",
            "source_query",
            "ctrl-libreoffice",
            "explicit, non-empty text selection",
            "more than one cell",
            "Never call `source_produce`",
            "unavailable_message",
        ] {
            assert!(
                OFFICE_SKILL.contains(required),
                "office skill missing {required}"
            );
        }
        // Private Companion transport never enters the public skill authority.
        // (ADR-005 irisy §10 v35)
        for forbidden in [
            "CTRL_LIBREOFFICE_BRIDGE_URL",
            "CTRL_LIBREOFFICE_BRIDGE_TOKEN",
        ] {
            assert!(
                !OFFICE_SKILL.contains(forbidden),
                "office skill leaked {forbidden}"
            );
        }
    }

    #[test]
    fn user_skill_with_same_name_precedes_bundled_skill() {
        let root = fresh_tmp("override");
        let user_root = root.join("user");
        let bundled_root = root.join("bundled");
        let user_dir = user_root.join("custom");
        let bundled_dir = bundled_root.join("create-feature-pack");
        std::fs::create_dir_all(&user_dir).unwrap();
        std::fs::create_dir_all(&bundled_dir).unwrap();
        let metadata = "---\nname: create-feature-pack\ndescription: test\n---\n";
        std::fs::write(user_dir.join("SKILL.md"), format!("{metadata}user")).unwrap();
        std::fs::write(bundled_dir.join("SKILL.md"), format!("{metadata}bundled")).unwrap();

        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        collect_skills_in(&user_root, &mut out, &mut seen);
        collect_skills_in(&bundled_root, &mut out, &mut seen);

        assert_eq!(out.len(), 1);
        assert!(out[0].path.starts_with(user_root.to_str().unwrap()));

        let _ = std::fs::remove_dir_all(&root);
    }

    // Release-owned skills remain readable through the single shared gate
    // boundary for both isolated agents. (ADR-001 spine §4 v20)
    #[test]
    fn bundled_ctrl_root_is_an_allowed_skill_read_boundary() {
        let home = fresh_tmp("read-bundled");
        let root = ctrl_skills_root(&home);
        ensure_bundled_ctrl_skills(&root).expect("materialize bundled skill");
        let skill_md = root.join("create-feature-pack").join("SKILL.md");
        let office_md = root.join("office").join("SKILL.md");

        let body = read_skill_under(&[root.clone()], skill_md.to_str().unwrap())
            .expect("read skill under CTRL root");
        assert_eq!(body, CREATE_FEATURE_PACK_SKILL);
        // Office uses the same release-owned Markdown authority, not a second
        // OpenCode-native skill store. (ADR-001 spine §4 v20)
        let office = read_skill_under(&[root], office_md.to_str().unwrap())
            .expect("read office skill under CTRL root");
        assert_eq!(office, OFFICE_SKILL);

        let _ = std::fs::remove_dir_all(&home);
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
