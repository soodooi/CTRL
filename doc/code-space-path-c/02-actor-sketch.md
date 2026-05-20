---
title: SubprocessActor + PTY 接口草图
lane: lane-G
handoff: H-2026-05-19-001
status: pre-ADR-012 input (pseudocode 草图, 不是定稿)
---

# SubprocessActor PTY 实装草图

> 约束: 5 primitives (Actor/Capability/Event/Channel/Effect) 不许加新种类。
> 允许在已有 Effect enum / OpKind / CellKind 加 variant (历史先例: MeshDeviceJoined 等已加过)。

现状: `src-tauri/src/actors/subprocess_actor.rs` 已有 `SubprocessActor` 结构 + lifecycle enum + Actor trait skeleton。
spawn/kill/IO 全是 P3.9 TODO。本草图把 TODO 填出来。

---

## 1. Effect 扩展 (1 个新 variant)

```rust
// kernel/effect.rs — 在 Effect enum 加:
PtySpawn {
    cmd: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    env: BTreeMap<String, String>,
    cols: u16,      // 默认 80
    rows: u16,      // 默认 24
    reply_to: ActorId,  // SubprocessActor 自己,接收 SubprocessSpawned / Chunk / Exited
}
PtyWrite {
    pid: u32,
    bytes: Vec<u8>,  // stdin
}
PtyResize { pid: u32, cols: u16, rows: u16 }
PtyKill   { pid: u32, signal: u8 }  // 0=SIGTERM, 9=SIGKILL
```

不复用 `ShellExec` 因为它语义是 "fire-and-forget 拿 exit code"，PTY 是 long-lived stream。

## 2. Event 扩展

```rust
// CellKind 加:
SubprocessChunk     // payload = { pid, stream: "stdout"|"stderr", bytes: base64 }

// OpKind 加:
SubprocessSpawned   // payload = { pid, cmd }
SubprocessExited    // payload = { pid, code: i32, signal: Option<i32> }
SubprocessStdin     // 入站: Irisy tile → actor (Effect::PtyWrite 之前)
```

## 3. Actor handle() 伪代码

```rust
async fn handle(&mut self, msg: Event, ctx: &ActorContext) -> Vec<Effect> {
    match msg {
        // 启动 (来自 KeycapInvoked 或 lifecycle::BootManaged 的 on_spawn)
        Event::Op(op) if op.kind == OpKind::KeycapInvoked && self.pid.is_none() => {
            vec![Effect::PtySpawn {
                cmd: self.command.clone(),
                args: self.args.clone(),
                cwd: parse(op.payload.cwd),
                env: parse(op.payload.env),
                cols: 80, rows: 24,
                reply_to: ctx.self_id.clone(),
            }]
        }
        // executor 回吐 pid
        Event::Op(op) if op.kind == OpKind::SubprocessSpawned => {
            self.pid = Some(parse(op.payload.pid));
            self.reset_idle_timer();
            vec![]  // 后续 chunk 由 executor 持续 emit 到 ctx.self_id, fan-out 由订阅者做
        }
        // 用户在 Irisy tile 敲键 → forward 到 stdin
        Event::Op(op) if op.kind == OpKind::SubprocessStdin => {
            if let Some(pid) = self.pid {
                vec![Effect::PtyWrite { pid, bytes: parse(op.payload.bytes) }]
            } else { vec![] }
        }
        // chunk 流过 — 转发给订阅者 (Irisy tile actor 或 PersistEvent)
        Event::Cell(c) if c.kind == CellKind::SubprocessChunk => {
            self.reset_idle_timer();
            vec![Effect::PersistEvent {
                event: Event::Cell(c),
                index: vec![format!("subprocess:{}", self.pid.unwrap())],
            }]
        }
        // 子进程退出
        Event::Op(op) if op.kind == OpKind::SubprocessExited => {
            self.pid = None;
            vec![]  // EventBus 已 fan-out, 这里不再额外动
        }
        _ => vec![]
    }
}
```

## 4. EffectExecutor 侧 (新增 PTY 执行器)

```rust
// kernel/effect_executor/pty.rs — 新文件,负责 PtySpawn 实际起 portable_pty:

fn execute_pty_spawn(eff: PtySpawn, bus: Arc<EventBus>) {
    tokio::task::spawn_blocking(move || {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { cols, rows, .. })?;
        let mut cmd = CommandBuilder::new(eff.cmd);
        cmd.args(eff.args); cmd.cwd(eff.cwd); cmd.env_clear(); ...
        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id().unwrap();

        // 立即 emit Spawned
        bus.publish(Event::Op(Op { kind: SubprocessSpawned, payload: json!({"pid": pid, "cmd": ...}), ... }));

        // 起 2 个 reader (master.try_clone_reader 拿 stdout/stderr)
        // 4KB chunk → CellKind::SubprocessChunk → publish 到 reply_to
        spawn_blocking(move || stream_reader(reader, pid, "stdout", bus.clone()));

        // 等 exit
        let status = child.wait()?;
        bus.publish(Event::Op(Op { kind: SubprocessExited, payload: json!({"pid": pid, "code": status.exit_code() as i32}), ... }));
    });
}

// 全局 PID → (Box<dyn MasterPty>, Box<dyn Child>) 表,
// PtyWrite/Resize/Kill 通过 pid 查表执行
struct PtyTable { map: Mutex<HashMap<u32, PtyHandle>> }
```

## 5. Capability check

复用现有 `CapToken::Subprocess { allowlist: Vec<String> }` (ADR-010 §7 已加)。
broker 在 `EffectExecutor` 入口检查 cmd 是否在 manifest 的 allowlist 里, 拦截路径穿越。

## 6. Lifecycle policy 落地

- `OnDemand { idle_ms }`: `reset_idle_timer` 起 `tokio::time::sleep` task, 到点 emit `PtyKill { signal: 15 }`
- `Persistent`: idle timer 关, kernel shutdown 才 kill (`on_shutdown` 已有 hook)
- `BootManaged`: `on_spawn` 立即返 `PtySpawn` Effect

## 7. ADR-012 要回答的开放问题

1. ✅ Effect 新 4 个 variant vs 改 ShellExec → 推荐 **新 variant** (长寿命语义不同)
2. ❓ chunk 走 Cell 还是 Op → 推荐 **Cell** (precedent: `LlmResponse` 流也是 Cell)
3. ❓ chunk 大小 4KB 固定 vs 行边界 → 推荐 **4KB raw bytes** (TUI 控制序列不能拆行)
4. ❓ PID 表全局存 vs 每 Actor 自持 → 推荐 **EffectExecutor 全局 PtyTable** (Actor 不持 unsafe 资源)
5. ❓ Windows ConPTY 走 portable-pty 自动 fallback, 已验证 wezterm 用例 ok
6. ❓ resize 是 Effect 还是 Event → 推荐 **Effect (PtyResize)** (前端发出, 不进 EventBus)
7. ❓ stderr 单独 stream 还是 merge stdout → portable-pty 默认 merge (PTY 物理是单流), **跟默认**

## 8. 不在本草图范围

- Irisy 前端 tile ↔ Actor 的 invoke / event 订阅链路 (lane-A daedalus 的 H-2026-05-18-001)
- ANSI 终端 emulator (前端 xterm.js 或同类, daedalus 选)
- session 持久化到 SQLite (P3.9 后续 sprint)
