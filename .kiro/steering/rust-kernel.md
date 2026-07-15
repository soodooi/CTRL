---
inclusion: fileMatch
fileMatchPattern: "src-tauri/**"
---

# Rust and Tauri

Read ADR-001 and the owning module ADR before assessment or changes. Preserve the five kernel primitives: Actor, Capability, Event, Channel, Effect.

Current anchors: `projector.rs`, `mcp_server.rs` (`:17873` gate), `mcp_host.rs`, `provider/`, `event_ws.rs` (`:17872`), `subprocess_actor.rs`, `subprocess_channel_adapter.rs`, and `persistence.rs`. Do not reintroduce retired ST-SS filenames or ungoverned duplicate MCP/Tauri surfaces.

Use English for code, comments, UI/errors, and responses; keep secrets out of source and logs; cite exact ADR sections in non-trivial code.

Validate with the narrowest relevant tests plus:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --lib --manifest-path src-tauri/Cargo.toml
```
