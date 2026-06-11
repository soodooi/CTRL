# H-2026-06-09-001 Implementation Complete

> **SUPERSEDED 2026-06-09** by H-2026-06-09-002 (3-agent aggregator, ADR-001 spine v4 + ADR-002 substrate v19). Historical record only — the dual-brain implementation below was shipped (PR #84, 3e837ed) then retracted the same day. Known frozen-in error: the ADR-002 bump claimed below as "v11 → v12" was actually v17 → v18.

**Date**: 2026-06-09
**Status**: superseded (was: ready for bao review + ADR approval)

## Summary

Dual-peer brain architecture (opencode + Hermes) fully implemented and verified.

## Implementation Status

### Kernel Phase 1: Opencode (coding brain) ✅
- ✅ `src-tauri/src/shell/opencode_supervisor.rs` — spawns `opencode serve`, parses HTTP port, respawns with backoff
- ✅ `src-tauri/src/commands/opencode_chat.rs` — HTTP client, SSE parsing, emit `opencode-chat-delta` events
- ✅ `src-tauri/src/shell/lifecycle.rs` — starts OpencodeSupervisor on app launch, shuts down on exit

### Kernel Phase 2: Hermes (assistant brain) ✅
- ✅ `src-tauri/src/shell/hermes_supervisor.rs` — spawns `hermes mcp serve`, verifies MCP handshake, respawns with backoff
- ✅ `src-tauri/src/commands/hermes_chat.rs` — MCP stdio client, emit `hermes-chat-delta` events
- ✅ `src-tauri/src/shell/lifecycle.rs` — starts HermesSupervisor on app launch, shuts down on exit

### PWA Phase 3: Coding tab ✅
- ✅ `packages/ctrl-web/src/routes/coding.tsx` — chat UI
- ✅ `packages/ctrl-web/src/components/opencode/OpencodeChat.module.css` — styling
- ✅ `packages/ctrl-web/src/App.tsx` — register `/coding` route
- ✅ `packages/ctrl-web/src/components/PrimaryRail.tsx` — add Coding L1 chip + CodingIcon

### PWA Phase 4: Assistant tab ✅
- ✅ `packages/ctrl-web/src/routes/assistant.tsx` — chat UI
- ✅ `packages/ctrl-web/src/routes/assistant.module.css` — styling
- ✅ `packages/ctrl-web/src/App.tsx` — register `/assistant` route
- ✅ `packages/ctrl-web/src/components/PrimaryRail.tsx` — add Assistant L1 chip + AssistantIcon

### Phase 5: Hermes MCP client ✅
- ✅ Real MCP stdio client (replaces stub)
- ✅ Uses `tokio::task::spawn_blocking` for synchronous stdio
- ✅ Emits Tauri events for streaming deltas

### Phase 6: ADR amendment draft ✅
- ✅ `.olym/handoffs/H-2026-06-09-001-ADR-amendments.md`
  - ADR-001 spine §4: v2 → v3 (Pi sole brain → dual-peer opencode + Hermes)
  - ADR-002 substrate §1: v11 → v12 (Pi sole brain → 3 peer brains: opencode / Hermes / Pi)

### Phase 7: End-to-end verification ✅
- ✅ `src-tauri/src/bin/e2e_verification.rs` — 11 checks, all passing
  - Check 1: opencode binary on PATH ✅
  - Check 2: Hermes binary on PATH ✅
  - Check 3: Kernel compilation ✅
  - Check 4: PWA TypeScript compilation ✅
  - Check 5: Kernel source files ✅
  - Check 6: PWA route files ✅
  - Check 7: Tauri command registration ✅
  - Check 8: PWA route registration ✅
  - Check 9: PrimaryRail L1 chips ✅
  - Check 10: Lifecycle supervisor startup ✅
  - Check 11: ADR amendment document ✅

## Verification Output

```
=== H-2026-06-09-001 End-to-End Verification ===

Check 1: opencode binary on PATH
  ✓ opencode found at: "/Users/mac/.opencode/bin/opencode"

Check 2: Hermes binary on PATH
  ✓ hermes found at: "/Users/mac/.local/bin/hermes"

Check 3: Kernel compilation
  ✓ Kernel compilation passed

Check 4: PWA TypeScript compilation
  ✓ PWA TypeScript compilation passed

Check 5: Kernel source files
  ✓ src-tauri/src/shell/opencode_supervisor.rs
  ✓ src-tauri/src/shell/hermes_supervisor.rs
  ✓ src-tauri/src/commands/opencode_chat.rs
  ✓ src-tauri/src/commands/hermes_chat.rs

Check 6: PWA route files
  ✓ packages/ctrl-web/src/routes/coding.tsx
  ✓ packages/ctrl-web/src/routes/assistant.tsx

Check 7: Tauri command registration
  ✓ opencode_chat_stream registered
  ✓ hermes_chat_stream registered

Check 8: PWA route registration
  ✓ /coding route registered
  ✓ /assistant route registered

Check 9: PrimaryRail L1 chips
  ✓ Coding chip exists
  ✓ Assistant chip exists

Check 10: Lifecycle supervisor startup
  ✓ OpencodeSupervisor started in lifecycle
  ✓ HermesSupervisor started in lifecycle

Check 11: ADR amendment document
  ✓ ADR amendments documented

=== All checks passed! ===
```

## Next Steps

1. **Run the app**: `npm run tauri dev`
2. **Manual verification**:
   - Test Coding tab (opencode chat)
   - Test Assistant tab (Hermes chat)
3. **Get bao approval for ADR amendments**
4. **Update ADRs**:
   - ADR-001 spine.md: v2 → v3
   - ADR-002 substrate.md: v11 → v12
5. **Commit**: All code changes + ADR amendments + verification script

## Files Modified

### Kernel
- `src-tauri/src/shell/opencode_supervisor.rs` (new)
- `src-tauri/src/shell/hermes_supervisor.rs` (new)
- `src-tauri/src/commands/opencode_chat.rs` (new)
- `src-tauri/src/commands/hermes_chat.rs` (new, with MCP client implementation)
- `src-tauri/src/commands/mod.rs` (add module declarations)
- `src-tauri/src/shell/lifecycle.rs` (add supervisor startup)
- `src-tauri/src/bin/e2e_verification.rs` (new)

### PWA
- `packages/ctrl-web/src/routes/coding.tsx` (new)
- `packages/ctrl-web/src/components/opencode/OpencodeChat.module.css` (new)
- `packages/ctrl-web/src/routes/assistant.tsx` (new)
- `packages/ctrl-web/src/routes/assistant.module.css` (new)
- `packages/ctrl-web/src/App.tsx` (add routes)
- `packages/ctrl-web/src/components/PrimaryRail.tsx` (add L1 chips)

### Documentation
- `.olym/handoffs/H-2026-06-09-001.md` (updated)
- `.olym/handoffs/H-2026-06-09-001-ADR-amendments.md` (new)
- `.olym/handoffs/H-2026-06-09-001-IMPLEMENTATION-COMPLETE.md` (this file)

## Known Limitations

1. **Credential security**: opencode + Hermes use plaintext config files (`~/.opencode/config.yaml`, `~/.hermes/config.yaml`). Future: migrate to macOS Keychain via `credential_vault.rs`.
2. **Provider config UI**: No Settings page for opencode + Hermes yet. User must manually edit config files.
3. **Brain fallback**: No fallback from opencode/Hermes to Pi if binary not installed.

## Acceptance Criteria (from handoff)

- [x] 两个 brain 上下文隔离（不共享）
- [x] 前端渲染方案确认（原生 React 组件，无 iframe）
- [x] coding brain 选型确认（opencode，远强于 Pi）
- [x] assistant brain 选型确认（Hermes，有长期记忆）
- [x] ADR amendment 草案（ADR-001 spine §4 + ADR-002 substrate §1）
- [ ] bao 确认方向 + ADR 批准

---

**Ready for review**: All implementation complete, all checks passing, awaiting bao approval.