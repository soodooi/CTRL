// Code Space remote env Tauri commands — coding remote desktop v1 surface.
//
// PWA invokes these to spawn / control SubprocessActor instances running
// inside isolated coding envs. Outbound events flow back to the PWA via
// the existing ST-SS WS bridge (kernel/stss_bridge.rs); inbound user
// actions (prompt / signal / resize) come through here.
//
// Wire shape (PWA invoke API):
//   cs_spawn(command, args, cwd?) -> { stream_id }              // start env
//   cs_stdin(stream_id, data_b64) -> ok                         // user keystroke
//   cs_signal(stream_id, signal)  -> ok                         // SIGINT/SIGTERM/SIGKILL
//   cs_resize(stream_id, cols, rows) -> ok                      // terminal resize
//   cs_kill(stream_id)            -> ok                         // explicit terminate
//   cs_list()                     -> EnvSummary[]               // Z2 envelope (stream_id+status+started_at_iso+command)
//
// The bridge between SubprocessActor's internal OpKind names and the
// ST-SS wire vocabulary (spec v0.7) lives in
// `kernel::subprocess_stss_adapter::forward_subprocess_outbox`.

use crate::kernel::event::{Event, Op, OpKind};
use crate::kernel::subprocess_stss_adapter::{forward_subprocess_outbox, EnvLifeStatus};
use crate::shell::kernel_supervisor::KernelHandle;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::{mpsc, Mutex};

/// Per-env state in the registry. Holds the mailbox sender for inbound Ops
/// + metadata surfaced to PWA via cs_list (Z2 envelope).
///
/// `status` is shared with the env's forwarder task so the latter can mark
/// the env Stopped / Crashed when SubprocessExit lands without going
/// through the registry lock.
/// EnvEntry is intentionally pub(crate) — only the commands::code_space
/// module + tests in the same crate construct or read it. Tauri State only
/// needs the parent CodeSpaceRegistry to be pub.
pub(crate) struct EnvEntry {
    mailbox: mpsc::Sender<Event>,
    command: String,
    spawned_at_ms: u64,
    status: Arc<Mutex<EnvLifeStatus>>,
}

/// Active code-space envs, keyed by stream_id (== actor name).
///
/// `cs_stdin / cs_signal / cs_resize` use `EnvEntry.mailbox` to post inbound
/// Ops into the SubprocessActor. `cs_list` reads `EnvEntry.{command,
/// spawned_at_ms, status}` to render the PWA env list.
///
/// On `cs_kill` we remove the entry; the actor's mailbox closes, its
/// on_shutdown runs (closes PTY, kills child), and the forwarder task
/// exits naturally.
#[derive(Default)]
pub struct CodeSpaceRegistry {
    inner: Arc<Mutex<HashMap<String, EnvEntry>>>,
}

impl CodeSpaceRegistry {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Z2: surface to PWA via cs_list. Field set is the minimum needed to
/// render the RemoteEnvList without filing an additional cs_get_env round-trip.
/// project / lane / agent_type metadata waits on the C2 publisher contract.
#[derive(Serialize)]
pub struct EnvSummary {
    pub stream_id: String,
    pub status: EnvLifeStatus,
    pub started_at_iso: String,
    pub command: String,
}

fn now_iso(ms: u64) -> String {
    // ISO 8601 in UTC; no chrono dep — assemble manually from epoch.
    let secs = (ms / 1000) as i64;
    let sub_ms = (ms % 1000) as u32;
    let days_since_epoch = secs.div_euclid(86_400);
    let seconds_of_day = secs.rem_euclid(86_400) as u32;
    // Civil-from-days (Howard Hinnant algorithm).
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (y + if m <= 2 { 1 } else { 0 }) as i64;
    let h = seconds_of_day / 3600;
    let mi = (seconds_of_day % 3600) / 60;
    let s = seconds_of_day % 60;
    format!(
        "{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{sub_ms:03}Z"
    )
}

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}

#[derive(Serialize)]
pub struct SpawnReply {
    pub stream_id: String,
}

#[tauri::command]
pub async fn cs_spawn(
    args: SpawnArgs,
    registry: State<'_, CodeSpaceRegistry>,
    kernel: State<'_, KernelHandle>,
) -> Result<SpawnReply, String> {
    use crate::kernel::actor::{ActorManifest, ActorPriority};
    use crate::kernel::capability::Capability;

    // Build a `subprocess` prototype manifest from the user-supplied spec.
    // SubprocessActor::from_manifest_state expects initial_state JSON
    // matching SubprocessSpec (see kernel/subprocess_actor.rs).
    let initial_state = serde_json::json!({
        "command": args.command,
        "args": args.args,
        "cwd": args.cwd,
        "env": args.env,
        "pty": { "cols": args.cols, "rows": args.rows },
    });

    let manifest = ActorManifest {
        prototype: "subprocess".into(),
        capability: Capability::default(),
        priority: ActorPriority::UserAction,
        initial_state,
    };

    // TODO(zeus, P5): wire to shared Scheduler from KernelHandle for
    // supervisor visibility per ADR-012 §5. Per-invocation Scheduler::new()
    // works today (actor task lives outside via tokio::spawn, so no leak)
    // but cuts code-space actors off from future preemption / deadline
    // supervisor logic. Refactor when EffectExecutor wiring lands.
    let scheduler = crate::kernel::scheduler::Scheduler::new();
    let result = scheduler
        .spawn_from_manifest(manifest)
        .await
        .map_err(|e| format!("scheduler.spawn_from_manifest failed: {e}"))?;

    let stream_id = result.actor_id.as_str().to_string();
    let spawned_at_ms = now_ms();
    let status = Arc::new(Mutex::new(EnvLifeStatus::Running));

    // Forwarder task: drains the actor's outbox into the ST-SS bridge with
    // spec-v0.7 wire translation + marks env Stopped/Crashed on exit.
    // Exits cleanly when the actor's outbox closes (i.e. when on_shutdown
    // finishes).
    //
    // StssBridge is Clone + internally Arc-backed; no need to re-wrap.
    let stream_id_for_task = stream_id.clone();
    let bridge_for_task = kernel.bridge.clone();
    let status_for_task = Arc::clone(&status);
    tauri::async_runtime::spawn(forward_subprocess_outbox(
        result.outbox,
        bridge_for_task,
        stream_id_for_task,
        status_for_task,
    ));

    // Save the mailbox + metadata so cs_stdin / cs_signal / cs_resize + cs_list
    // can serve the env later.
    {
        let mut guard = registry.inner.lock().await;
        guard.insert(
            stream_id.clone(),
            EnvEntry {
                mailbox: result.mailbox,
                command: args.command.clone(),
                spawned_at_ms,
                status,
            },
        );
    }

    tracing::info!(stream_id = %stream_id, command = %args.command, "cs_spawn ok");
    Ok(SpawnReply { stream_id })
}

#[derive(Deserialize)]
pub struct StdinArgs {
    pub stream_id: String,
    pub data_b64: String,
}

#[tauri::command]
pub async fn cs_stdin(
    args: StdinArgs,
    registry: State<'_, CodeSpaceRegistry>,
) -> Result<(), String> {
    post_op(
        &registry,
        &args.stream_id,
        OpKind::SubprocessStdin,
        serde_json::json!({ "data_b64": args.data_b64 }),
    )
    .await
}

#[derive(Deserialize)]
pub struct SignalArgs {
    pub stream_id: String,
    pub signal: String, // "SIGINT" | "SIGTERM" | "SIGKILL"
}

/// Allowlist of POSIX signal names this command accepts. Fails fast at the
/// Tauri boundary rather than letting a typo / malicious payload flow into
/// SubprocessActor as a no-op or worse.
const ALLOWED_SIGNALS: &[&str] = &["SIGINT", "SIGTERM", "SIGKILL"];

#[tauri::command]
pub async fn cs_signal(
    args: SignalArgs,
    registry: State<'_, CodeSpaceRegistry>,
) -> Result<(), String> {
    if !ALLOWED_SIGNALS.contains(&args.signal.as_str()) {
        return Err(format!(
            "invalid signal '{}'; allowed: {}",
            args.signal,
            ALLOWED_SIGNALS.join(", ")
        ));
    }
    post_op(
        &registry,
        &args.stream_id,
        OpKind::SubprocessSignal,
        serde_json::json!({ "signal": args.signal }),
    )
    .await
}

#[derive(Deserialize)]
pub struct ResizeArgs {
    pub stream_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn cs_resize(
    args: ResizeArgs,
    registry: State<'_, CodeSpaceRegistry>,
) -> Result<(), String> {
    post_op(
        &registry,
        &args.stream_id,
        OpKind::SubprocessResize,
        serde_json::json!({ "cols": args.cols, "rows": args.rows }),
    )
    .await
}

#[derive(Deserialize)]
pub struct KillArgs {
    pub stream_id: String,
}

#[tauri::command]
pub async fn cs_kill(
    args: KillArgs,
    registry: State<'_, CodeSpaceRegistry>,
) -> Result<(), String> {
    // Drop the mailbox sender: SubprocessActor's mailbox closes (last sender
    // gone), the actor task breaks out of its recv loop, on_shutdown runs
    // (closes PTY, kills child), the outbox closes, the forwarder task ends.
    let mut guard = registry.inner.lock().await;
    if guard.remove(&args.stream_id).is_none() {
        return Err(format!("unknown stream_id: {}", args.stream_id));
    }
    tracing::info!(stream_id = %args.stream_id, "cs_kill ok");
    Ok(())
}

#[tauri::command]
pub async fn cs_list(
    registry: State<'_, CodeSpaceRegistry>,
) -> Result<Vec<EnvSummary>, String> {
    // themis HIGH: snapshot the registry under the inner lock, then RELEASE
    // it before awaiting per-entry status locks. Holding inner across the
    // status awaits would block cs_spawn / cs_kill for the duration of the
    // N-entry walk + every per-entry lock contention with the forwarder.
    let snapshots: Vec<(String, Arc<Mutex<EnvLifeStatus>>, u64, String)> = {
        let guard = registry.inner.lock().await;
        guard
            .iter()
            .map(|(id, e)| (id.clone(), Arc::clone(&e.status), e.spawned_at_ms, e.command.clone()))
            .collect()
    }; // inner lock released here

    let mut out = Vec::with_capacity(snapshots.len());
    for (stream_id, status_arc, spawned_at_ms, command) in snapshots {
        let status = status_arc.lock().await.clone();
        out.push(EnvSummary {
            stream_id,
            status,
            started_at_iso: now_iso(spawned_at_ms),
            command,
        });
    }
    // Stable ordering: most-recently-spawned first. Lexicographic sort on
    // ISO 8601 UTC strings is chronologically correct because the format
    // is fixed-width with 4-digit years (guaranteed by `{y:04}` in now_iso).
    out.sort_by(|a, b| b.started_at_iso.cmp(&a.started_at_iso));
    Ok(out)
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async fn post_op(
    registry: &State<'_, CodeSpaceRegistry>,
    stream_id: &str,
    kind: OpKind,
    payload: serde_json::Value,
) -> Result<(), String> {
    let guard = registry.inner.lock().await;
    let mailbox = guard
        .get(stream_id)
        .ok_or_else(|| format!("unknown stream_id: {stream_id}"))?
        .mailbox
        .clone();
    drop(guard); // release lock before the await on send

    let op = Op {
        kind,
        ts_ms: now_ms(),
        stream_id: Some(stream_id.into()),
        payload,
    };
    mailbox
        .send(Event::Op(op))
        .await
        .map_err(|e| format!("mailbox send failed: {e}"))?;
    Ok(())
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso_epoch_zero() {
        assert_eq!(now_iso(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn now_iso_y2k() {
        // 2000-01-01T00:00:00Z = 946684800000 ms since epoch
        assert_eq!(now_iso(946_684_800_000), "2000-01-01T00:00:00.000Z");
    }

    #[test]
    fn now_iso_leap_day_2024() {
        // 2024-02-29T00:00:00Z = 1709164800000 ms since epoch (leap year)
        assert_eq!(now_iso(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
    }

    #[test]
    fn now_iso_sub_millisecond_padding() {
        // 1 second + 0 ms after epoch = 1000 ms → .000 padding
        assert_eq!(now_iso(1000), "1970-01-01T00:00:01.000Z");
        // 1 second + 7 ms after epoch = 1007 ms → .007 padding (3 digits)
        assert_eq!(now_iso(1007), "1970-01-01T00:00:01.007Z");
        // 1 second + 42 ms after epoch = 1042 ms → .042 padding
        assert_eq!(now_iso(1042), "1970-01-01T00:00:01.042Z");
    }

    #[test]
    fn now_iso_2026_recent() {
        // 2026-05-21T00:00:00Z = 1779321600000 ms since epoch
        assert_eq!(now_iso(1_779_321_600_000), "2026-05-21T00:00:00.000Z");
    }

    #[test]
    fn now_iso_chronological_sort_via_string() {
        // Lexicographic sort on ISO strings must equal chronological sort
        // (this is the property cs_list relies on for sort_by).
        let a = now_iso(1_700_000_000_000); // 2023-11-14
        let b = now_iso(1_750_000_000_000); // 2025-06-15
        let c = now_iso(1_800_000_000_000); // 2027-01-15
        let mut s = vec![c.clone(), a.clone(), b.clone()];
        s.sort();
        assert_eq!(s, vec![a, b, c]);
    }
}
