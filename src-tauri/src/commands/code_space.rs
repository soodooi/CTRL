// Code Space remote env Tauri commands — coding 远程桌面 v1 surface.
//
// PWA invokes these to spawn / control SubprocessActor instances running
// inside isolated coding envs. Outbound events flow back to the PWA via
// the existing ST-SS WS bridge (kernel/stss_bridge.rs); inbound user
// actions (prompt / signal / resize) come through here.
//
// Wire shape (PWA invoke API):
//   cs_spawn(command, args, cwd?) -> { stream_id }      // start env
//   cs_stdin(stream_id, data_b64) -> ok                 // user keystroke
//   cs_signal(stream_id, signal)  -> ok                 // SIGINT/SIGTERM/SIGKILL
//   cs_resize(stream_id, cols, rows) -> ok              // terminal resize
//   cs_kill(stream_id)            -> ok                 // explicit terminate
//   cs_list()                     -> [stream_id, ...]   // active envs
//
// The bridge between SubprocessActor's internal OpKind names and the
// ST-SS wire vocabulary (spec v0.7) lives in
// `kernel::subprocess_stss_adapter::forward_subprocess_outbox`.

use crate::kernel::event::{Event, Op, OpKind};
use crate::kernel::subprocess_stss_adapter::forward_subprocess_outbox;
use crate::shell::kernel_supervisor::KernelHandle;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::{mpsc, Mutex};

/// Active code-space envs, keyed by stream_id (== actor name).
///
/// The mailbox `Sender<Event>` is what we use to post inbound Ops
/// (cs_stdin / cs_signal / cs_resize) into the SubprocessActor. The
/// outbox `Receiver<Event>` is consumed by the per-env forwarder task
/// (spawned in `cs_spawn`); we do not store it here.
///
/// On `cs_kill` we drop the Sender; the actor's mailbox closes, its
/// on_shutdown runs (closes PTY, kills child), and the forwarder task
/// exits naturally.
#[derive(Default)]
pub struct CodeSpaceRegistry {
    inner: Arc<Mutex<HashMap<String, mpsc::Sender<Event>>>>,
}

impl CodeSpaceRegistry {
    pub fn new() -> Self {
        Self::default()
    }
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

    // Forwarder task: drains the actor's outbox into the ST-SS bridge with
    // spec-v0.7 wire translation. Exits cleanly when the actor's outbox
    // closes (i.e. when on_shutdown finishes).
    //
    // StssBridge is Clone + internally Arc-backed; no need to re-wrap.
    let stream_id_for_task = stream_id.clone();
    let bridge_for_task = kernel.bridge.clone();
    tauri::async_runtime::spawn(forward_subprocess_outbox(
        result.outbox,
        bridge_for_task,
        stream_id_for_task,
    ));

    // Save the mailbox so subsequent cs_stdin / cs_signal / cs_resize can
    // post Events into the actor.
    {
        let mut guard = registry.inner.lock().await;
        guard.insert(stream_id.clone(), result.mailbox);
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
pub async fn cs_list(registry: State<'_, CodeSpaceRegistry>) -> Result<Vec<String>, String> {
    let guard = registry.inner.lock().await;
    Ok(guard.keys().cloned().collect())
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
