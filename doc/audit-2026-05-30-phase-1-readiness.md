# Audit · Phase 1 readiness (2026-05-30)

Purpose: before starting Phase 1 (底座 implementation under ADR-024), reconcile what's **actually in the code** vs what I assumed when writing the ADR. Without this audit Phase 1 would re-stitch surfaces that already exist or skip surfaces I didn't know about.

## 10 audit items × findings

| # | Item | Finding | Phase 1 impact |
|---|---|---|---|
| **1** | **ADR-022 workbench composition canvas** | **Accepted 2026-05-29.** `/workbench` route already exists (`routes/workbench.tsx`) using React Flow + dnd-kit. Custom keycap nodes, JSON Schema ports. **Distinct from Irisy-create surface.** ADR-022 §4 lists 5 open follow-ups (skill source + io re-add to SDK, route scaffold, thin orchestrator, global skill discovery, "all components" list). | **Phase 1 does NOT include `/workbench` build** — that's ADR-022's own track. Phase 1 step 9 was wrong to call this "workbench". Rename to **Creator surface end-to-end** (the Irisy-create route, separate from `/workbench`). |
| **2** | **16 G builtin manifest location** | **Intentionally deleted in PR #62 (commit `a5aa2f2 "drop hermes, clear demo keycaps"`).** `share/modules/builtin/` empty; only build-output residue. Git ls-files shows no `builtin/*manifest.json` files. The 16 G builtins are **gone from the working set**. | **ADR-024 Q6 (cap_asset retroactive scope for 16 G) is moot** — there are no 16 G to migrate. Phase 1 doesn't need a migration step. New builtin keycaps (assist + create) start clean with v2 schema. |
| **3** | **Keyboard data source** | `Keyboard.tsx:140-152` uses `useQuery({ queryKey: ['keycaps'], queryFn: listKeycaps })`. `listKeycaps` → `invoke('list_keycaps')` (defined `kernel.ts:42`). Tauri command exists at `commands/kernel.rs:113` and reads `~/.ctrl/keycaps/`. | **Already wired**. Phase 1 just needs assist+create copied into `~/.ctrl/keycaps/` and they show up automatically. |
| **4** | **`routes/workbench.tsx` vs Irisy-create surface** | **Two distinct routes**: `/workbench` = ADR-022 multi-keycap composition canvas (React Flow); `/irisy?intent=create-keycap` = single-keycap creator (`CreatorShell` with ChatPane + ManifestPreview + CodePreview + InstallBar + DiscardConfirm). | Phase 1 step 9 = wire the **`/irisy?intent=create-keycap` route** end to end. Not `/workbench`. |
| **5** | **Irisy creator component state** | All 6 components exist (1442 LOC total): `CreatorShell.tsx` 44 / `ChatPane.tsx` 129 / `ManifestPreview.tsx` 166 / `CodePreview.tsx` 26 / `InstallBar.tsx` 79 / `DiscardConfirm.tsx` 39. `useKeycapCreatorStore`, `runChatTurn`, `IRISY_KEYCAP_CREATOR_PROMPT`, `IRISY_KEYCAP_CREATOR_FEW_SHOTS` are all imported and used. **`routes/irisy.tsx:156` calls `invoke('install_keycap', ...)` — the install path is already wired.** | **Creator surface is mostly done already.** Phase 1 step 9 shrinks to: (a) flip `InstallBar.backendReady` flag to `true` (install_keycap IS implemented); (b) make sure manifest shape from creator matches install_keycap expectations; (c) add ADR-024 v2 fields if/when Schema SSOT migrates. |
| **6** | **Pi brain installation state** | `packages/ctrl-pi-plugin/` **exists** in repo (`bin/ctrl-pi-mcp.ts`). `brain_supervisor.rs:137-164 find_pi_plugin_dir()` walks up from current_exe/cwd looking for `packages/ctrl-pi-plugin/bin/ctrl-pi-mcp.ts`. **Dev mode (this repo) should find it. Installed `.app` bundle DOESN'T have `packages/` adjacent — Pi can't spawn.** Log "@ctrl/pi-plugin not found — uses Volc fallback" is for the installed bundle. | **Phase 1 doesn't fix Pi packaging** (separate concern). Phase 1 default brain chain = Volc (`text.chat`) for installed app; Pi will run in dev only until bundle integration is fixed. Volc is the practical default. |
| **7** | **Volc adapter capability** | `OpenAIShapeAdapter` (`openai_shape.rs`) is the shared impl for 9 OpenAI-compatible providers including Volc Doubao. Real `reqwest::Client`, real SSE streaming, real `complete` + `stream_chat`. **`text.chat` is fully functional.** **NO image / audio adapter** — only text. Volc Seedream (image.generate), Volc 多模态 (image.understand), Volc 语音 (audio.stt/tts) **all missing**. | **Phase 1 must add Volc image + audio adapters** OR document that海报/OCR/会议 keycaps will need adapter work before they can run (substrate gap). |
| **8** | **install_keycap + discovery Tauri commands** | Existing: `install_keycap`, `install_keycap_from_mcp`, `run_keycap`, `uninstall_keycap`, `list_keycaps`, `list_mcp_servers`, `list_local_skills` (skills.rs:452, query-based). **Missing**: `discover_provider` (per-capability provider list — needed for InfraBar + Irisy reasoning). | Most Tauri commands **already exist**. Phase 1 adds `discover_provider` + brings active-providers table to `kernel_status`. |
| **9** | **`packages/ctrl-keycaps/` vs `share/keycaps/`** | `packages/ctrl-keycaps/package.json` description: *"Source-of-truth for CTRL's bundled builtin keycaps (15 v1 starter set). Bundled into CTRL.app/Contents/Resources/keycaps/ at build time; copied to ~/.ctrl/keycaps/ on first run."* — but the package is empty (just package.json + README). My Phase 0 wrote files to `share/keycaps/builtin/` instead. **Directory conflict.** | **Phase 1 decision**: pick one location. Recommend **moving Phase 0 files from `share/keycaps/builtin/` → `packages/ctrl-keycaps/builtin/`** to match the existing intent (the package is referenced in the bundling story). `share/` was my own creation; `packages/ctrl-keycaps/` is the original plan. |
| **10** | **Mesh (ADR-003) state** | Event surface exists (`kernel/event.rs:76-77` ADR-003 events; `useCellStream.ts:39-44` mesh event types). **No actual sync impl** — no `automerge`, `vodozemac`, `webrtc-rs` imports in `src-tauri/src/`. Per brainstorm-workbench §7.0: "hephaestus lane in flight, 0 端到端". | **ADR-024 references to "mesh-synced per ADR-003"** are aspirational. Phase 1 cap_asset.vault folders will exist on local disk; mesh sync activates when ADR-003 ships (independent track). Doesn't block Phase 1. |

## What changed in my Phase 1 understanding

**Shrunk** (these are mostly built):
- Creator surface end-to-end (was Phase 1 step 9; now ~80% done already — gap is backendReady flag + manifest shape alignment, not surface build)
- Tauri command surface (install_keycap, list_keycaps, list_local_skills, list_mcp_servers, run_keycap, uninstall_keycap — all exist)
- Schema SSOT location (`packages/ctrl-keycap-sdk/src/manifest-schema.ts` — exists, tracked, just needs ADR-024 v2 field extensions)

**Grew** (these are not built but I didn't list them):
- **Volc image + audio adapter** — only text.chat exists. 海报/OCR/会议 keycaps blocked without this.
- **`discover_provider` Tauri command** — for InfraBar + Irisy reasoning over what's configured.

**Confirmed unaffected** (separate tracks):
- `/workbench` route (ADR-022 own track, Phase 1 doesn't touch)
- Pi packaging for installed `.app` (separate concern; Volc text.chat is the v1 launch default)
- Mesh sync (ADR-003 hephaestus lane in flight)

**Phase 0 file location decision needed**:
- `packages/ctrl-keycaps/` claims to be SoT but is empty
- My Phase 0 wrote to `share/keycaps/builtin/`
- One has to move. I recommend `packages/ctrl-keycaps/builtin/` per existing intent.

## Phase 1 final scope — 7 items (was 10)

```
底座 (Rust):
  1. Schema SSOT v2 — extend manifest-schema.ts with ADR-024 axes
     (cap_asset / brain_capabilities / ui_surface). TOML→JSON loader
     (existing schema is JSON-shaped; new fields land on the same Zod)
  2. cap_asset loader — Rust install path: copy assets/* to
     ~/.ctrl/keycaps/<id>/assets/, create vault folder + seed
  3. Persona resolver — vault/keycaps/<id>/persona.md > assets/persona.md
  4. Provider Capability Registry — kernel/providers/ module +
     ~/.ctrl/providers/<id>/manifest.toml + builtin share/providers/
  5. Volc image + audio adapter (Doubao Seedream + Doubao 语音 +
     Doubao 多模态) — extending OpenAIShapeAdapter or new adapters
  6. kernel_status active_providers table — per-capability provider
     (replaces singular primary_adapter field)
  7. discover_provider Tauri command — lists Provider Capability
     Registry entries for InfraBar + Irisy reasoning

前端 (PWA):
  8. WorkspaceUiDispatch registry — 9 renderer minimal (3-4 wire,
     rest stub for Phase 1 → expand as keycaps need them)
  9. Creator surface end-to-end flip — InstallBar.backendReady=true,
     manifest shape alignment with install_keycap (already wired in
     routes/irisy.tsx:156). Likely 1 small PR.

Validation:
 10. Move share/keycaps/builtin/{assist,create}/ → packages/ctrl-keycaps/builtin/
     ((or formally retire packages/ctrl-keycaps/'s SoT claim).
     First-run copy from app bundle Resources/keycaps/ to ~/.ctrl/keycaps/.
     End-to-end smoke: launch → assist + create show on Keyboard →
     click create → Irisy creator route opens → user makes a keycap →
     install_keycap fires → new keycap shows on Keyboard.
```

**Not in Phase 1** (deferred / separate):
- `/workbench` ADR-022 composition canvas (separate track, accepted ADR but pre-implementation)
- Pi bundle packaging for installed `.app`
- Mesh sync (ADR-003 hephaestus lane)
- 16 G builtin migration (they're deleted; non-issue)
- Cross-keycap composition (G5 brainstorm gap, ADR-022 covers)
- Keyboard personalization (G4 brainstorm gap)

## Open questions for bao (carried + refined)

1. **Phase 0 file location** — move `share/keycaps/builtin/{assist,create}/` → `packages/ctrl-keycaps/builtin/`? My preference: yes (matches existing package's stated SoT role).
2. **Volc image+audio endpoint** — your Volc account has image.generate (Seedream) / image.understand (多模态) / audio.stt+tts endpoints open? If yes → Phase 1 item 5 ships full. If no → Phase 1 item 5 = framework only + stub adapters that report "需开通 Volc image/audio" when invoked.
3. **Pattern B/C/E/F path** (BetterDisplay / Motrix / 飞书 / VSCode publisher) — wait v1.1 capability promote (no v1 ship), or let v1 keycaps wrap OS calls themselves (脏但能 ship)? My preference: v1.1 promote (clean, ADR-004 frequency rule respected).

## Status

Audit done. Phase 1 final scope ready. Awaiting bao on the 3 open questions before starting implementation.
