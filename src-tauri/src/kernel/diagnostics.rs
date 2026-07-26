//! Unified, local-only diagnostics composer for Irisy, Coding, and Notes.
//!
//! This module retains metadata breadcrumbs only. It observes the existing ACP,
//! subprocess, watcher, and index owners; it never starts or supervises them.
//! (ADR-010 communication § diagnostics v11)

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const RETENTION_MS: u64 = 15 * 60 * 1_000;
const EVENT_CAPACITY: usize = 200;
const MAX_CAPTURE_SECONDS: u64 = 5 * 60;
const MAX_ATTRIBUTE_STRING: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticsModule {
    Irisy,
    Coding,
    Notes,
}

impl FromStr for DiagnosticsModule {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "irisy" => Ok(Self::Irisy),
            "coding" => Ok(Self::Coding),
            "notes" => Ok(Self::Notes),
            _ => Err("module must be one of: irisy, coding, notes".to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupPhase {
    Idle,
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Health {
    Ok,
    Degraded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsEvent {
    pub timestamp_ms: u64,
    pub module: DiagnosticsModule,
    pub trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    pub kind: String,
    pub phase: String,
    pub severity: String,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub attributes: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsStatus {
    pub observed_at_ms: u64,
    pub module: DiagnosticsModule,
    pub startup: StartupPhase,
    pub live: bool,
    pub ready: bool,
    pub health: Health,
    pub summary: String,
    pub capture_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_expires_at_ms: Option<u64>,
    pub retained_events: usize,
    pub attributes: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmokeCheck {
    pub name: String,
    pub health: Health,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsSmoke {
    pub observed_at_ms: u64,
    pub module: DiagnosticsModule,
    pub health: Health,
    pub checks: Vec<SmokeCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsTrace {
    pub module: DiagnosticsModule,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    pub retention_seconds: u64,
    pub capacity: usize,
    pub events: Vec<DiagnosticsEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureReply {
    pub module: DiagnosticsModule,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsExportPreview {
    pub generated_at_ms: u64,
    pub module: DiagnosticsModule,
    pub status: DiagnosticsStatus,
    pub trace: DiagnosticsTrace,
    pub metadata_only: bool,
    pub destination: String,
    pub estimated_bytes: usize,
}

#[derive(Default)]
struct ModuleState {
    events: VecDeque<DiagnosticsEvent>,
    capture_expires_at_ms: Option<u64>,
}

#[derive(Default)]
struct DiagnosticsStore {
    modules: HashMap<DiagnosticsModule, ModuleState>,
    next_trace: u64,
}

fn store() -> &'static Mutex<DiagnosticsStore> {
    static STORE: OnceLock<Mutex<DiagnosticsStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(DiagnosticsStore::default()))
}

fn lock_store() -> std::sync::MutexGuard<'static, DiagnosticsStore> {
    store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn prune(state: &mut ModuleState, now: u64) {
    while state
        .events
        .front()
        .is_some_and(|event| now.saturating_sub(event.timestamp_ms) > RETENTION_MS)
    {
        state.events.pop_front();
    }
    while state.events.len() > EVENT_CAPACITY {
        state.events.pop_front();
    }
    if state
        .capture_expires_at_ms
        .is_some_and(|expires| expires <= now)
    {
        state.capture_expires_at_ms = None;
    }
}

fn next_trace_id(store: &mut DiagnosticsStore, now: u64) -> String {
    store.next_trace = store.next_trace.wrapping_add(1);
    format!("diag-{now}-{}", store.next_trace)
}

fn forbidden_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "authorization",
        "cookie",
        "token",
        "secret",
        "keychain",
        "password",
        "environment",
        "env",
        "prompt",
        "completion",
        "thought",
        "tool_args",
        "tool_result",
        "stdout",
        "stderr",
        "pty_io",
        "note_body",
        "internal_msg",
        "internalmsg",
    ]
    .iter()
    .any(|needle| key == *needle || key.contains(needle))
}

fn looks_like_absolute_path(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.starts_with('/')
        || value.starts_with("\\\\")
        || lower.contains("/users/")
        || lower.contains("/home/")
        || lower.contains("\\users\\")
        || value
            .as_bytes()
            .get(1..3)
            .is_some_and(|pair| pair[0] == b':' && (pair[1] == b'\\' || pair[1] == b'/'))
}

fn redact_string(value: &str) -> Value {
    if looks_like_absolute_path(value) {
        return Value::String("[REDACTED_PATH]".to_string());
    }
    let truncated: String = value.chars().take(MAX_ATTRIBUTE_STRING).collect();
    Value::String(truncated)
}

pub fn redact(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut clean = Map::new();
            for (key, value) in object {
                if forbidden_key(key) {
                    clean.insert(key.clone(), Value::String("[REDACTED]".to_string()));
                } else {
                    clean.insert(key.clone(), redact(value));
                }
            }
            Value::Object(clean)
        }
        Value::Array(values) => Value::Array(values.iter().map(redact).collect()),
        Value::String(value) => redact_string(value),
        other => other.clone(),
    }
}

pub struct RecordEvent<'a> {
    pub module: DiagnosticsModule,
    pub session_id: Option<&'a str>,
    pub correlation_id: Option<&'a str>,
    pub kind: &'a str,
    pub phase: &'a str,
    pub severity: &'a str,
    pub outcome: &'a str,
    pub duration_ms: Option<u64>,
    /// Granular metadata retained only during an explicit bounded capture.
    pub capture_only: bool,
    pub attributes: Value,
}

pub fn record(input: RecordEvent<'_>) {
    let now = now_ms();
    let mut guard = lock_store();
    let state = guard.modules.entry(input.module).or_default();
    prune(state, now);
    if input.capture_only && state.capture_expires_at_ms.is_none() {
        return;
    }
    let trace_id = next_trace_id(&mut guard, now);
    let state = guard.modules.entry(input.module).or_default();
    state.events.push_back(DiagnosticsEvent {
        timestamp_ms: now,
        module: input.module,
        trace_id,
        session_id: input.session_id.map(redact_identifier),
        correlation_id: input.correlation_id.map(redact_identifier),
        kind: input.kind.to_string(),
        phase: input.phase.to_string(),
        severity: input.severity.to_string(),
        outcome: input.outcome.to_string(),
        duration_ms: input.duration_ms,
        attributes: redact(&input.attributes),
    });
    prune(state, now);
}

fn redact_identifier(value: &str) -> String {
    match redact_string(value) {
        Value::String(value) => value,
        _ => "[REDACTED]".to_string(),
    }
}

/// Content-free lifecycle projection from the existing CodeSpace registry and
/// subprocess forwarder. It is observation metadata, not a second process owner.
/// (ADR-002 substrate § diagnostics-projection v72)
pub fn coding_spawned(correlation_id: &str) {
    record(RecordEvent {
        module: DiagnosticsModule::Coding,
        session_id: None,
        correlation_id: Some(correlation_id),
        kind: "process_lifecycle",
        phase: "spawn",
        severity: "info",
        outcome: "running",
        duration_ms: None,
        capture_only: false,
        attributes: serde_json::json!({}),
    });
}

pub fn coding_activity(correlation_id: &str, phase: &str) {
    record(RecordEvent {
        module: DiagnosticsModule::Coding,
        session_id: None,
        correlation_id: Some(correlation_id),
        kind: "process_control",
        phase,
        severity: "info",
        outcome: "accepted",
        duration_ms: None,
        capture_only: true,
        attributes: serde_json::json!({}),
    });
}

pub fn coding_finished(correlation_id: &str, outcome: &str, exit_code: Option<i32>) {
    record(RecordEvent {
        module: DiagnosticsModule::Coding,
        session_id: None,
        correlation_id: Some(correlation_id),
        kind: "process_lifecycle",
        phase: "exit",
        severity: if outcome == "stopped" {
            "info"
        } else {
            "error"
        },
        outcome,
        duration_ms: None,
        capture_only: false,
        attributes: serde_json::json!({ "exit_code": exit_code }),
    });
}

pub fn capture_start(
    module: DiagnosticsModule,
    duration_seconds: u64,
) -> Result<CaptureReply, String> {
    if duration_seconds == 0 || duration_seconds > MAX_CAPTURE_SECONDS {
        return Err(format!(
            "duration_seconds must be between 1 and {MAX_CAPTURE_SECONDS}"
        ));
    }
    let expires = now_ms().saturating_add(duration_seconds.saturating_mul(1_000));
    {
        let mut guard = lock_store();
        let state = guard.modules.entry(module).or_default();
        state.capture_expires_at_ms = Some(expires);
    }
    record(RecordEvent {
        module,
        session_id: None,
        correlation_id: None,
        kind: "capture_lifecycle",
        phase: "capture",
        severity: "info",
        outcome: "started",
        duration_ms: Some(duration_seconds.saturating_mul(1_000)),
        capture_only: false,
        attributes: serde_json::json!({ "metadata_only": true }),
    });
    Ok(CaptureReply {
        module,
        active: true,
        expires_at_ms: Some(expires),
    })
}

pub fn capture_stop(module: DiagnosticsModule) -> CaptureReply {
    {
        let mut guard = lock_store();
        let state = guard.modules.entry(module).or_default();
        state.capture_expires_at_ms = None;
    }
    record(RecordEvent {
        module,
        session_id: None,
        correlation_id: None,
        kind: "capture_lifecycle",
        phase: "capture",
        severity: "info",
        outcome: "stopped",
        duration_ms: None,
        capture_only: false,
        attributes: serde_json::json!({ "metadata_only": true }),
    });
    CaptureReply {
        module,
        active: false,
        expires_at_ms: None,
    }
}

fn retention_snapshot(module: DiagnosticsModule) -> (usize, Option<u64>) {
    let now = now_ms();
    let mut guard = lock_store();
    let state = guard.modules.entry(module).or_default();
    prune(state, now);
    (state.events.len(), state.capture_expires_at_ms)
}

pub fn status(module: DiagnosticsModule) -> DiagnosticsStatus {
    let observed_at_ms = now_ms();
    let (retained_events, capture_expires_at_ms) = retention_snapshot(module);
    let capture_active = capture_expires_at_ms.is_some();
    let (startup, live, ready, health, summary, attributes) = match module {
        DiagnosticsModule::Irisy => irisy_status(),
        DiagnosticsModule::Coding => coding_status(),
        DiagnosticsModule::Notes => notes_status(),
    };
    DiagnosticsStatus {
        observed_at_ms,
        module,
        startup,
        live,
        ready,
        health,
        summary,
        capture_active,
        capture_expires_at_ms,
        retained_events,
        attributes: redact(&attributes),
    }
}

fn irisy_status() -> (StartupPhase, bool, bool, Health, String, Value) {
    use crate::shell::acp_client::diagnostics_snapshot;

    irisy_status_from_snapshot(diagnostics_snapshot())
}

fn irisy_status_from_snapshot(
    snapshot: crate::shell::acp_client::AcpDiagnosticsSnapshot,
) -> (StartupPhase, bool, bool, Health, String, Value) {
    use crate::shell::acp_client::AcpDiagnosticsState;

    let attributes = serde_json::json!({ "engine": snapshot.engine });
    match snapshot.state {
        AcpDiagnosticsState::Idle => (
            StartupPhase::Idle,
            true,
            false,
            Health::Ok,
            "ACP adapter is available; no session is active".to_string(),
            attributes,
        ),
        AcpDiagnosticsState::Starting => (
            StartupPhase::Starting,
            true,
            false,
            Health::Ok,
            "ACP session is starting".to_string(),
            attributes,
        ),
        AcpDiagnosticsState::Busy => (
            StartupPhase::Ready,
            true,
            true,
            Health::Ok,
            "ACP session is processing a turn; diagnostics did not block it".to_string(),
            attributes,
        ),
        AcpDiagnosticsState::Ready => (
            StartupPhase::Ready,
            true,
            true,
            Health::Ok,
            "ACP session is ready".to_string(),
            attributes,
        ),
        AcpDiagnosticsState::Failed => (
            StartupPhase::Failed,
            false,
            false,
            Health::Failed,
            "ACP process is not alive".to_string(),
            attributes,
        ),
    }
}

fn coding_status() -> (StartupPhase, bool, bool, Health, String, Value) {
    coding_status_from_snapshot(
        crate::commands::code_space::CodeSpaceRegistry::shared().diagnostics_snapshot(),
    )
}

fn coding_status_from_snapshot(
    snapshot: crate::commands::code_space::CodeSpaceDiagnosticsSnapshot,
) -> (StartupPhase, bool, bool, Health, String, Value) {
    let health = if snapshot.owner_busy || snapshot.crashed_processes > 0 {
        Health::Degraded
    } else {
        Health::Ok
    };
    let startup = if snapshot.owner_busy {
        StartupPhase::Starting
    } else if snapshot.total_processes == 0 {
        StartupPhase::Idle
    } else {
        StartupPhase::Ready
    };
    let ready = !snapshot.owner_busy;
    let summary = if snapshot.owner_busy {
        "Coding owner is busy; diagnostics did not wait for it".to_string()
    } else if snapshot.total_processes == 0 {
        "Coding runtime is available; no process is registered".to_string()
    } else {
        format!(
            "Coding owner has {} running, {} stopped, and {} crashed process(es)",
            snapshot.running_processes, snapshot.stopped_processes, snapshot.crashed_processes
        )
    };
    (
        startup,
        true,
        ready,
        health,
        summary,
        serde_json::json!({
            "owner_busy": snapshot.owner_busy,
            "total_processes": snapshot.total_processes,
            "running_processes": snapshot.running_processes,
            "stopped_processes": snapshot.stopped_processes,
            "crashed_processes": snapshot.crashed_processes,
        }),
    )
}

fn notes_status() -> (StartupPhase, bool, bool, Health, String, Value) {
    let root = crate::kernel::vault::configured_vault_root()
        .or_else(crate::kernel::vault::default_vault_root);
    let root_configured = crate::kernel::vault::is_vault_configured();
    let root_readable = root
        .as_ref()
        .is_some_and(|path| path.is_dir() && std::fs::read_dir(path).is_ok());
    let watcher = crate::kernel::vault_watch::diagnostics_snapshot();
    let index = crate::kernel::vault::existing_index_count();
    let index_state = match &index {
        Ok(Some(_)) => "ready",
        Ok(None) => "idle",
        Err(_) => "failed",
    };
    let watcher_failed = watcher.last_error.is_some();
    let index_ready = matches!(index, Ok(Some(_)));
    let (health, startup, ready) = notes_aggregate(
        root.is_some(),
        root_readable,
        watcher.started,
        watcher_failed,
        index_ready,
        index.is_err(),
    );
    (
        startup,
        root.is_some(),
        ready,
        health,
        match health {
            Health::Ok => "Vault, watcher, and index observation are available".to_string(),
            Health::Degraded => {
                "Notes is available with incomplete root, watcher, or index readiness".to_string()
            }
            Health::Failed => "Notes diagnostics detected an unavailable owner".to_string(),
        },
        serde_json::json!({
            "root_configured": root_configured,
            "root_readable": root_readable,
            "watcher_started": watcher.started,
            "watcher_event_count": watcher.event_count,
            "watcher_last_event_at_ms": watcher.last_event_at_ms,
            "watcher_last_error": watcher.last_error,
            "index_state": index_state,
            "index_count": index.ok().flatten(),
        }),
    )
}

fn notes_aggregate(
    root_present: bool,
    root_readable: bool,
    watcher_started: bool,
    watcher_failed: bool,
    index_ready: bool,
    index_failed: bool,
) -> (Health, StartupPhase, bool) {
    let health = if !root_present || index_failed {
        Health::Failed
    } else if !root_readable || !watcher_started || watcher_failed || !index_ready {
        Health::Degraded
    } else {
        Health::Ok
    };
    let startup = match health {
        Health::Failed => StartupPhase::Failed,
        Health::Ok => StartupPhase::Ready,
        Health::Degraded => StartupPhase::Starting,
    };
    let ready = root_readable && watcher_started && !watcher_failed && index_ready;
    (health, startup, ready)
}

pub fn smoke(module: DiagnosticsModule) -> DiagnosticsSmoke {
    let observed_at_ms = now_ms();
    let current = status(module);
    let mut checks = vec![SmokeCheck {
        name: "owner_observation".to_string(),
        health: current.health,
        summary: current.summary,
    }];
    match module {
        DiagnosticsModule::Irisy => checks.push(SmokeCheck {
            name: "non_blocking_acp_probe".to_string(),
            health: if current.health == Health::Failed {
                Health::Failed
            } else {
                Health::Ok
            },
            summary: "ACP state was inspected without starting a session or sending a prompt"
                .to_string(),
        }),
        DiagnosticsModule::Coding => checks.push(SmokeCheck {
            name: "process_owner_probe".to_string(),
            health: Health::Ok,
            summary: "Coding lifecycle metadata was read without spawning a process".to_string(),
        }),
        DiagnosticsModule::Notes => checks.push(SmokeCheck {
            name: "local_vault_probe".to_string(),
            health: current.health,
            summary: "Vault, watcher, and existing index state were inspected without rebuild"
                .to_string(),
        }),
    }
    let health = checks
        .iter()
        .fold(Health::Ok, |current, check| match (current, check.health) {
            (Health::Failed, _) | (_, Health::Failed) => Health::Failed,
            (Health::Degraded, _) | (_, Health::Degraded) => Health::Degraded,
            _ => Health::Ok,
        });
    DiagnosticsSmoke {
        observed_at_ms,
        module,
        health,
        checks,
    }
}

pub fn trace(
    module: DiagnosticsModule,
    correlation_id: Option<&str>,
    limit: Option<usize>,
) -> DiagnosticsTrace {
    let now = now_ms();
    let limit = limit.unwrap_or(100).clamp(1, EVENT_CAPACITY);
    let mut guard = lock_store();
    let state = guard.modules.entry(module).or_default();
    prune(state, now);
    let mut events: Vec<_> = state
        .events
        .iter()
        .filter(|event| {
            correlation_id.is_none_or(|expected| event.correlation_id.as_deref() == Some(expected))
        })
        .rev()
        .take(limit)
        .cloned()
        .collect();
    events.reverse();
    DiagnosticsTrace {
        module,
        correlation_id: correlation_id.map(redact_identifier),
        retention_seconds: RETENTION_MS / 1_000,
        capacity: EVENT_CAPACITY,
        events,
    }
}

pub fn export_preview(
    module: DiagnosticsModule,
    correlation_id: Option<&str>,
) -> DiagnosticsExportPreview {
    let status = status(module);
    let trace = trace(module, correlation_id, Some(EVENT_CAPACITY));
    let estimated_bytes = serde_json::to_vec(&(&status, &trace))
        .map(|value| value.len())
        .unwrap_or(0);
    DiagnosticsExportPreview {
        generated_at_ms: now_ms(),
        module,
        status,
        trace,
        metadata_only: true,
        destination: "local_user_selected_file".to_string(),
        estimated_bytes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recursive_redaction_hides_secrets_content_and_absolute_paths() {
        let input = serde_json::json!({
            "nested": [{ "authorization": "Bearer secret", "safe": "ok" }],
            "prompt_text": "private prompt",
            "path": "/Users/example/private.md",
            "error": "watch failed for /Users/example/private.md",
            "relative_path": "notes/safe.md"
        });
        let output = redact(&input);
        assert_eq!(output["nested"][0]["authorization"], "[REDACTED]");
        assert_eq!(output["prompt_text"], "[REDACTED]");
        assert_eq!(output["path"], "[REDACTED_PATH]");
        assert_eq!(output["error"], "[REDACTED_PATH]");
        assert_eq!(output["relative_path"], "notes/safe.md");
    }

    #[test]
    fn trace_is_bounded_and_correlation_filtered() {
        let module = DiagnosticsModule::Coding;
        for index in 0..(EVENT_CAPACITY + 5) {
            let correlation = format!("test-{index}");
            record(RecordEvent {
                module,
                session_id: None,
                correlation_id: Some(&correlation),
                kind: "test",
                phase: "observe",
                severity: "info",
                outcome: "ok",
                duration_ms: None,
                capture_only: false,
                attributes: serde_json::json!({}),
            });
        }
        assert_eq!(
            trace(module, None, Some(EVENT_CAPACITY)).events.len(),
            EVENT_CAPACITY
        );
        assert_eq!(trace(module, Some("test-204"), None).events.len(), 1);
    }

    #[test]
    fn active_acp_turn_is_ready_and_healthy() {
        let (_, live, ready, health, _, _) =
            irisy_status_from_snapshot(crate::shell::acp_client::AcpDiagnosticsSnapshot {
                state: crate::shell::acp_client::AcpDiagnosticsState::Busy,
                engine: None,
            });
        assert!(live);
        assert!(ready);
        assert_eq!(health, Health::Ok);
    }

    #[test]
    fn coding_crash_is_derived_from_owner_snapshot() {
        let (_, _, ready, health, _, _) = coding_status_from_snapshot(
            crate::commands::code_space::CodeSpaceDiagnosticsSnapshot {
                owner_busy: false,
                total_processes: 1,
                running_processes: 0,
                stopped_processes: 0,
                crashed_processes: 1,
            },
        );
        assert!(ready);
        assert_eq!(health, Health::Degraded);
    }

    #[test]
    fn notes_idle_index_and_watcher_error_are_not_ready() {
        for aggregate in [
            notes_aggregate(true, true, true, false, false, false),
            notes_aggregate(true, true, true, true, true, false),
        ] {
            assert_eq!(aggregate.0, Health::Degraded);
            assert_eq!(aggregate.1, StartupPhase::Starting);
            assert!(!aggregate.2);
        }
    }

    #[test]
    fn capture_is_time_bounded() {
        let module = DiagnosticsModule::Irisy;
        let correlation = "capture-only-admission";
        capture_stop(module);
        record(RecordEvent {
            module,
            session_id: None,
            correlation_id: Some(correlation),
            kind: "granular",
            phase: "before_capture",
            severity: "info",
            outcome: "observed",
            duration_ms: None,
            capture_only: true,
            attributes: serde_json::json!({}),
        });
        assert!(trace(module, Some(correlation), None).events.is_empty());

        assert!(capture_start(module, 0).is_err());
        assert!(capture_start(module, MAX_CAPTURE_SECONDS + 1).is_err());
        let started = capture_start(module, 1).expect("capture starts");
        assert!(started.active);
        assert!(started.expires_at_ms.is_some());
        record(RecordEvent {
            module,
            session_id: None,
            correlation_id: Some(correlation),
            kind: "granular",
            phase: "during_capture",
            severity: "info",
            outcome: "observed",
            duration_ms: None,
            capture_only: true,
            attributes: serde_json::json!({}),
        });
        assert_eq!(trace(module, Some(correlation), None).events.len(), 1);
        assert!(!capture_stop(module).active);
    }
}
