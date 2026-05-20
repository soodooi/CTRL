// SubprocessActor — long-lived child process Actor for Code Space tiles
// and similar always-on CLI integrations. Per ADR-012.
//
// 实 Actor trait（不破 5 primitives 抽象）。每实例持一个 PTY-backed 子进程,
// 通过 portable-pty 跨平台（Unix forkpty + Windows ConPTY）。
//
// Lifecycle:
//   on_spawn   → spawn child + start reader task; emit `subprocess_spawned`
//   handle()   → match OpKind:
//                  SubprocessStdin  → write bytes to PTY master
//                  SubprocessResize → master.resize()
//                  SubprocessSignal → child.kill() via ChildKiller handle
//   on_shutdown→ kill child + close handles
//
// Supervisor guarantees (ADR-012 §5):
//   1. panic catch around spawn — failure emits `subprocess_exit` and the
//      actor stays alive in a no-op state; does NOT crash the kernel.
//   2. mem_cap_bytes (default 256 MB) declared in manifest spec. OS-level
//      enforcement (rlimit / Job Object) is a follow-up — value is wired
//      through to `SubprocessSpawned` payload so PWA + audit can observe.
//   3. on_shutdown always kills child + aborts reader/waiter tasks.

use crate::kernel::actor::{Actor, ActorContext, ActorPriority};
use crate::kernel::effect::Effect;
use crate::kernel::event::{Event, Op, OpKind};
use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

/// 默认每 SubprocessActor 内存上限. OS-level 强制 (rlimit / Job Object) 留给
/// follow-up handoff — manifest 字段先 wire 通, supervisor 观测可见.
pub const DEFAULT_MEM_CAP_BYTES: u64 = 256 * 1024 * 1024;
/// 每次 PTY master read 的最大字节 — 4 KB 与终端 cell 大小同量级.
pub const STDOUT_CHUNK_BYTES: usize = 4096;
/// Outbox channel default capacity. Bounded to give back-pressure;
/// the scheduler creates the channel and exposes the rx to consumers.
pub const DEFAULT_OUTBOX_CAPACITY: usize = 1024;

/// PTY 初始尺寸. resize 通过 Event::Op(SubprocessResize) 动态调整.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtySpec {
    pub cols: u16,
    pub rows: u16,
}

impl Default for PtySpec {
    fn default() -> Self {
        Self { cols: 80, rows: 24 }
    }
}

/// Manifest schema for `prototype: "subprocess"` (ADR-012 §4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubprocessSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub pty: PtySpec,
    #[serde(default = "default_mem_cap")]
    pub mem_cap_bytes: u64,
}

fn default_mem_cap() -> u64 {
    DEFAULT_MEM_CAP_BYTES
}

/// Outbound event sink. SubprocessActor pushes Stdout / Spawned / Exit here.
/// Caller (scheduler) owns the matching `mpsc::Receiver<Event>`.
pub type SubprocessOutbox = mpsc::Sender<Event>;

pub struct SubprocessActor {
    name: String,
    spec: SubprocessSpec,
    outbox: SubprocessOutbox,
    state: RuntimeState,
}

#[derive(Default)]
struct RuntimeState {
    pid: Option<u32>,
    /// Master PTY 用于 resize. take_writer 是单独的句柄 (writer field).
    master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
    writer: Option<Arc<Mutex<Box<dyn std::io::Write + Send>>>>,
    /// kill / signal via ChildKiller; child 本体已 move 进 waiter task.
    killer: Option<Arc<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>>,
    reader_task: Option<JoinHandle<()>>,
    waiter_task: Option<JoinHandle<()>>,
}

impl SubprocessActor {
    pub fn new(name: impl Into<String>, spec: SubprocessSpec, outbox: SubprocessOutbox) -> Self {
        Self {
            name: name.into(),
            spec,
            outbox,
            state: RuntimeState::default(),
        }
    }

    /// Parse SubprocessSpec from ActorManifest.initial_state.
    pub fn from_manifest_state(
        name: impl Into<String>,
        initial_state: serde_json::Value,
        outbox: SubprocessOutbox,
    ) -> Result<Self, serde_json::Error> {
        let spec: SubprocessSpec = serde_json::from_value(initial_state)?;
        Ok(Self::new(name, spec, outbox))
    }

    pub fn pid(&self) -> Option<u32> {
        self.state.pid
    }

    /// 拉起子进程 + 启动 reader / waiter task. 不 panic — 错误经
    /// outbox 以 `subprocess_exit` 投递, 由 caller 决定是否复用 actor.
    /// PID 返回 Option — portable-pty 在某些平台不能立即拿到 PID.
    fn spawn_child(&mut self) -> Result<Option<u32>, SubprocessSpawnError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: self.spec.pty.rows,
                cols: self.spec.pty.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SubprocessSpawnError::Pty(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&self.spec.command);
        for a in &self.spec.args {
            cmd.arg(a);
        }
        if let Some(cwd) = &self.spec.cwd {
            cmd.cwd(cwd);
        }
        for (k, v) in &self.spec.env {
            cmd.env(k, v);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SubprocessSpawnError::Spawn(e.to_string()))?;
        // 父进程不再持 slave fd, 由 child 独占.
        drop(pair.slave);

        // PID is Option — kernel sentinel (0) collides with real PIDs on Linux
        // idle process. Carry None all the way to event payload (serializes as null).
        let pid: Option<u32> = child.process_id();
        let killer: Box<dyn portable_pty::ChildKiller + Send + Sync> = child.clone_killer();

        // Reader / writer 必须在 master 移入 Arc<Mutex> 前取出.
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| SubprocessSpawnError::Reader(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| SubprocessSpawnError::Writer(e.to_string()))?;

        let master_arc: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(pair.master));
        let writer_arc: Arc<Mutex<Box<dyn std::io::Write + Send>>> = Arc::new(Mutex::new(writer));

        let outbox = self.outbox.clone();
        let actor_name = self.name.clone();

        // Reader task: blocking reads (PTY 是 blocking fd), 4 KB chunks 通过
        // outbox 以 SubprocessStdout op 投递. 三约束 #1: panic 在此 task 内
        // 局部, kernel 不挂.
        let reader_task = tokio::task::spawn_blocking(move || {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut buf = [0u8; STDOUT_CHUNK_BYTES];
                let mut r = reader;
                loop {
                    match r.read(&mut buf) {
                        Ok(0) => break, // EOF — child closed PTY
                        Ok(n) => {
                            let chunk = &buf[..n];
                            let ev = Event::Op(Op {
                                kind: OpKind::SubprocessStdout,
                                ts_ms: now_ms(),
                                stream_id: Some(actor_name.clone()),
                                payload: serde_json::json!({
                                    "actor": actor_name,
                                    "pid": pid,
                                    "len": n,
                                    "data_b64": B64.encode(chunk),
                                }),
                            });
                            // try_send (non-blocking): if outbox is full or closed,
                            // drop the chunk + WARN. blocking_send was a silent-failure
                            // path — slow consumer could hang the OS thread + freeze
                            // the child PTY indefinitely (themis CRITICAL).
                            match outbox.try_send(ev) {
                                Ok(_) => {}
                                Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                                    tracing::warn!(
                                        actor = %actor_name,
                                        bytes = n,
                                        "outbox full — stdout chunk dropped"
                                    );
                                }
                                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                                    break; // receiver dropped, exit reader cleanly
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!(actor = %actor_name, error = %e, "pty reader error");
                            break;
                        }
                    }
                }
            }));
        });

        // Waiter task: child.wait() blocks until exit. Emits SubprocessExit.
        let outbox_w = self.outbox.clone();
        let actor_name_w = self.name.clone();
        let waiter_task = tokio::task::spawn_blocking(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| child.wait()));
            let (code, panicked) = match result {
                Ok(Ok(status)) => (Some(status.exit_code() as i32), false),
                Ok(Err(e)) => {
                    tracing::warn!(actor = %actor_name_w, error = %e, "child.wait() error");
                    (None, false)
                }
                Err(_) => {
                    tracing::error!(actor = %actor_name_w, "child.wait() panicked");
                    (None, true)
                }
            };
            // try_send to align with reader task — Exit event must reach consumer
            // even if outbox is briefly full, but never block the OS thread.
            let exit_ev = Event::Op(Op {
                kind: OpKind::SubprocessExit,
                ts_ms: now_ms(),
                stream_id: Some(actor_name_w.clone()),
                payload: serde_json::json!({
                    "actor": actor_name_w,
                    "pid": pid,
                    "code": code,
                    "panic": panicked,
                }),
            });
            if let Err(e) = outbox_w.try_send(exit_ev) {
                tracing::warn!(
                    actor = %actor_name_w,
                    error = ?e,
                    "outbox closed or full — exit event dropped"
                );
            }
        });

        self.state.pid = pid;
        self.state.master = Some(master_arc);
        self.state.writer = Some(writer_arc);
        self.state.killer = Some(Arc::new(Mutex::new(killer)));
        self.state.reader_task = Some(reader_task);
        self.state.waiter_task = Some(waiter_task);

        Ok(pid)
    }
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, thiserror::Error)]
pub enum SubprocessSpawnError {
    #[error("pty openpty failed: {0}")]
    Pty(String),
    #[error("child spawn failed: {0}")]
    Spawn(String),
    #[error("master reader clone failed: {0}")]
    Reader(String),
    #[error("master writer take failed: {0}")]
    Writer(String),
}

#[async_trait]
impl Actor for SubprocessActor {
    async fn on_spawn(&mut self, _ctx: &ActorContext) -> Vec<Effect> {
        // 三约束 #1: reader / waiter task 内部各自 catch_unwind (panic 局部).
        // 此处 NOT wrap in catch_unwind — themis CRITICAL: catch_unwind 包
        // spawn_child 会留下半初始化 actor (child 已 spawn 但 self.state.killer
        // 未写), 导致 on_shutdown 漏 kill. Scheduler 的 on_spawn catch_unwind
        // 兜底 panic + on_shutdown 路径退出.
        match self.spawn_child() {
            Ok(pid) => {
                let _ = self.outbox.try_send(Event::Op(Op {
                    kind: OpKind::SubprocessSpawned,
                    ts_ms: now_ms(),
                    stream_id: Some(self.name.clone()),
                    payload: serde_json::json!({
                        "actor": self.name,
                        "pid": pid,
                        "command": self.spec.command,
                        "mem_cap_bytes": self.spec.mem_cap_bytes,
                    }),
                }));
            }
            Err(e) => {
                tracing::error!(actor = %self.name, error = %e, "subprocess spawn failed");
                let _ = self.outbox.try_send(Event::Op(Op {
                    kind: OpKind::SubprocessExit,
                    ts_ms: now_ms(),
                    stream_id: Some(self.name.clone()),
                    payload: serde_json::json!({
                        "actor": self.name,
                        "pid": Option::<u32>::None,
                        "code": Option::<i32>::None,
                        "spawn_error": e.to_string(),
                    }),
                }));
            }
        }
        Vec::new()
    }

    async fn handle(&mut self, msg: Event, _ctx: &ActorContext) -> Vec<Effect> {
        let op = match msg {
            Event::Op(op) => op,
            _ => return Vec::new(),
        };
        match op.kind {
            OpKind::SubprocessStdin => {
                let bytes = op
                    .payload
                    .get("data_b64")
                    .and_then(|v| v.as_str())
                    .and_then(|s| B64.decode(s).ok());
                if let (Some(writer), Some(bytes)) = (self.state.writer.clone(), bytes) {
                    tokio::task::spawn_blocking(move || {
                        let mut guard = writer.blocking_lock();
                        if let Err(e) = std::io::Write::write_all(&mut *guard, &bytes) {
                            tracing::warn!(error = %e, "pty stdin write failed");
                        }
                        let _ = std::io::Write::flush(&mut *guard);
                    });
                }
            }
            OpKind::SubprocessResize => {
                let cols = op.payload.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
                let rows = op.payload.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
                if let Some(master) = self.state.master.clone() {
                    tokio::task::spawn_blocking(move || {
                        let guard = master.blocking_lock();
                        if let Err(e) = guard.resize(PtySize {
                            cols,
                            rows,
                            pixel_width: 0,
                            pixel_height: 0,
                        }) {
                            tracing::warn!(error = %e, "pty resize failed");
                        }
                    });
                }
            }
            OpKind::SubprocessSignal => {
                if let Some(killer) = self.state.killer.clone() {
                    tokio::task::spawn_blocking(move || {
                        let mut guard = killer.blocking_lock();
                        if let Err(e) = guard.kill() {
                            tracing::warn!(error = %e, "child kill failed");
                        }
                    });
                }
            }
            _ => {}
        }
        Vec::new()
    }

    async fn on_shutdown(&mut self) {
        // 三约束 #3: always close PTY + kill child on shutdown.
        if let Some(killer) = self.state.killer.take() {
            // best-effort, blocking-lock acceptable in shutdown path.
            let mut guard = killer.lock().await;
            let _ = guard.kill();
        }
        if let Some(t) = self.state.reader_task.take() {
            t.abort();
        }
        if let Some(t) = self.state.waiter_task.take() {
            t.abort();
        }
        // dropping writer/master closes the fds.
        self.state.writer = None;
        self.state.master = None;
        self.state.pid = None;
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> ActorPriority {
        ActorPriority::UserAction
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_spec_default_80x24() {
        let p = PtySpec::default();
        assert_eq!(p.cols, 80);
        assert_eq!(p.rows, 24);
    }

    #[test]
    fn subprocess_spec_parses_minimal_manifest() {
        let v = serde_json::json!({ "command": "/bin/sh" });
        let spec: SubprocessSpec = serde_json::from_value(v).unwrap();
        assert_eq!(spec.command, "/bin/sh");
        assert!(spec.args.is_empty());
        assert!(spec.env.is_empty());
        assert_eq!(spec.pty.cols, 80);
        assert_eq!(spec.mem_cap_bytes, DEFAULT_MEM_CAP_BYTES);
    }

    #[test]
    fn subprocess_spec_full_roundtrip() {
        let v = serde_json::json!({
            "command": "bash",
            "args": ["-l", "-c", "echo hi"],
            "env": { "TILE_ID": "abc" },
            "cwd": "/tmp",
            "pty": { "cols": 120, "rows": 40 },
            "mem_cap_bytes": 67108864u64,
        });
        let spec: SubprocessSpec = serde_json::from_value(v).unwrap();
        assert_eq!(spec.command, "bash");
        assert_eq!(spec.args, vec!["-l", "-c", "echo hi"]);
        assert_eq!(spec.env.get("TILE_ID").map(|s| s.as_str()), Some("abc"));
        assert_eq!(spec.cwd.as_deref(), Some("/tmp"));
        assert_eq!(spec.pty.cols, 120);
        assert_eq!(spec.pty.rows, 40);
        assert_eq!(spec.mem_cap_bytes, 67108864);
    }

    #[test]
    fn new_initializes_cold_state() {
        let (tx, _rx) = mpsc::channel(8);
        let a = SubprocessActor::new(
            "echo-bot",
            SubprocessSpec {
                command: "echo".into(),
                args: vec!["hi".into()],
                env: BTreeMap::new(),
                cwd: None,
                pty: PtySpec::default(),
                mem_cap_bytes: DEFAULT_MEM_CAP_BYTES,
            },
            tx,
        );
        assert_eq!(a.name(), "echo-bot");
        assert!(a.pid().is_none());
    }

    #[test]
    fn from_manifest_state_rejects_missing_command() {
        let (tx, _rx) = mpsc::channel(8);
        let v = serde_json::json!({ "args": ["x"] });
        match SubprocessActor::from_manifest_state("x", v, tx) {
            Err(e) => assert!(e.to_string().contains("command"), "got: {e}"),
            Ok(_) => panic!("expected serde error for missing command"),
        }
    }

    /// e2e per ADR-012 Acceptance §6: spawn `bash -c '...'`, observe Spawned →
    /// Stdout containing "hello-from-subprocess" → Exit with code 7.
    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn e2e_bash_echo_exit_code_7() {
        let (tx, mut rx) = mpsc::channel::<Event>(64);
        let spec = SubprocessSpec {
            command: "bash".into(),
            args: vec!["-c".into(), "echo hello-from-subprocess; exit 7".into()],
            env: BTreeMap::new(),
            cwd: None,
            pty: PtySpec::default(),
            mem_cap_bytes: DEFAULT_MEM_CAP_BYTES,
        };
        let mut actor = SubprocessActor::new("e2e", spec, tx);
        let ctx = ActorContext {
            self_id: crate::kernel::ActorId::from_str("e2e"),
            parent_id: None,
            capability: crate::kernel::Capability::empty(),
            deadline_ms: None,
        };
        actor.on_spawn(&ctx).await;

        let mut saw_spawned = false;
        let mut saw_stdout = false;
        let mut exit_code: Option<i32> = None;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Some(Event::Op(op))) => match op.kind {
                    OpKind::SubprocessSpawned => saw_spawned = true,
                    OpKind::SubprocessStdout => {
                        let s = op
                            .payload
                            .get("data_b64")
                            .and_then(|v| v.as_str())
                            .and_then(|b| B64.decode(b).ok())
                            .map(|b| String::from_utf8_lossy(&b).into_owned())
                            .unwrap_or_default();
                        if s.contains("hello-from-subprocess") {
                            saw_stdout = true;
                        }
                    }
                    OpKind::SubprocessExit => {
                        exit_code = op.payload.get("code").and_then(|v| v.as_i64()).map(|c| c as i32);
                        break;
                    }
                    _ => {}
                },
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(_) => break,
            }
        }
        actor.on_shutdown().await;

        assert!(saw_spawned, "expected SubprocessSpawned event");
        assert!(saw_stdout, "expected stdout containing hello-from-subprocess");
        assert_eq!(exit_code, Some(7), "expected exit code 7");
    }
}
