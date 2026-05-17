// SubprocessActor — manages a long-lived child process on the user's machine.
// Per ADR-010 §5.3, this is the runtime substrate for Pattern B (CLI wrapper),
// Pattern C (daemon controller), and Pattern D (third-party MCP server) when
// wrapped beneath an `MCPServerActor`.
//
// Lifecycle:
//   on_spawn:  do NOT spawn yet — wait for first SubprocessStart event
//   SubprocessStart  → spawn child via Effect::ShellExec
//   SubprocessStdin  → forward bytes to child stdin
//   SubprocessSignal → terminate / SIGHUP / etc
//   on_shutdown:     → terminate child if still alive
//
// Idle-suspend policy (configurable per Pattern):
//   - on_demand:    spawn on first invoke, kill after `idle_ms` of no traffic
//   - persistent:   keep alive across kernel sessions (P3.9 persistence)
//   - boot_managed: spawn at kernel boot, never auto-kill
//
// Not embedded here (P3.9+):
//   - actual process spawn (waits for Effect::ShellExec executor)
//   - PTY wrap (for terminal-style integration, see Athena coding companion)
//   - stdout/stderr streaming as Cell events for Irisy ingest
//   - resource limits (rlimit / cgroup / Job Object)

use crate::kernel::actor::{Actor, ActorContext, ActorPriority};
use crate::kernel::effect::Effect;
use crate::kernel::event::Event;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubprocessLifecycle {
    /// Spawn on first invoke, kill after idle.
    OnDemand { idle_ms: u64 },
    /// Stay running across kernel sessions.
    Persistent,
    /// Spawn at kernel boot.
    BootManaged,
}

impl Default for SubprocessLifecycle {
    fn default() -> Self {
        Self::OnDemand { idle_ms: 60_000 }
    }
}

pub struct SubprocessActor {
    pub command: String,
    pub args: Vec<String>,
    pub lifecycle: SubprocessLifecycle,
    /// OS pid once spawned; None when cold.
    pub pid: Option<u32>,
    pub name: String,
}

impl SubprocessActor {
    pub fn new(
        command: impl Into<String>,
        args: Vec<String>,
        lifecycle: SubprocessLifecycle,
        name: impl Into<String>,
    ) -> Self {
        Self {
            command: command.into(),
            args,
            lifecycle,
            pid: None,
            name: name.into(),
        }
    }
}

#[async_trait]
impl Actor for SubprocessActor {
    async fn on_spawn(&mut self, _ctx: &ActorContext) -> Vec<Effect> {
        match self.lifecycle {
            SubprocessLifecycle::BootManaged => {
                tracing::info!(actor = %self.name, "SubprocessActor boot-spawning child");
                // TODO P3.9: return Effect::ShellExec to actually spawn.
                Vec::new()
            }
            _ => {
                tracing::info!(actor = %self.name, "SubprocessActor cold (lazy spawn)");
                Vec::new()
            }
        }
    }

    async fn handle(&mut self, _msg: Event, _ctx: &ActorContext) -> Vec<Effect> {
        // P3.9: pattern-match on subprocess control events
        // (Start / Stdin / Signal / IdleTimer).
        Vec::new()
    }

    async fn on_shutdown(&mut self) {
        if let Some(pid) = self.pid {
            tracing::info!(actor = %self.name, pid, "SubprocessActor terminating child");
            // TODO P3.9: actual kill via tokio::process::Child::kill().
        }
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> ActorPriority {
        // CLI / daemon are user-initiated background tasks.
        ActorPriority::UserAction
    }
}
