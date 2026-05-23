# Auto-Update Strategy — 4 Layers × 3 Tiers

- **Status**: v0.1 (2026-05-22)
- **Parent**: ADR-018
- **Audience**: kernel `update_scheduler` module, PWA Settings (per-keycap tier picker), Irisy stages 3/6/7

---

## 1. Purpose

Operationalize ADR-018: 4 layers each self-driving, 3 user tiers for Layer 3 (keycap) merge semantics.

## 2. Layer mechanics

### Layer 1 — CTRL.app binary (ADR-011 unchanged)

- Tauri 2 updater + 3-mirror
- Check: at app launch + every 4h while running
- Apply: download to staging dir → verify ed25519 signature → swap on next start

### Layer 2 — hermes runtime

- `~/.ctrl/hermes-venv/bin/hermes update` CLI is the source of truth
- Kernel `update_scheduler` runs daily background check
- Apply: `hermes update` blocks until done; PyPI signature verified via `pip --require-hashes` if available, else trust on first install
- Failure (network / version conflict) surfaces as Irisy stage 6 (Debug) notification

### Layer 3 — Keycap upstream

- Each keycap manifest declares `upstream.url` (HTTPS)
- Scheduler polls `<upstream_url>/manifest.json` daily; compare `version` field
- If newer + user tier allows → fetch bundle → verify signature → apply per tier (see §3)

### Layer 4 — PWA bundle

- `vite-plugin-pwa` Service Worker
- Auto-update on app start + visibility change
- User toast: "PWA updated, reload to apply"
- Coupled to Layer 1 (each Tauri release contains a PWA bundle); the SW handles in-session updates too

## 3. 3-tier merge semantics (Layer 3 only)

### 3.1 Config tier

- User filled `manifest.config_schema` fields, did NOT modify code/manifest body
- Update = clean overwrite of bundle + config_schema fields
- `config_migration` declarations applied: rename / move / default / drop user's stored config values
- Conflict UX: none (Config tier is forward-compatible by design)

### 3.2 Patch tier

- User has a per-keycap override layer (`~/.ctrl/keycaps/<id>/patches/`) created via Irisy stage 7 (Improvement)
- Update = 3-way merge: upstream base → upstream new → user patch
- Auto-apply if no conflict
- Conflict → Irisy stage 6 (Debug) bubble with diff + 3 buttons:
  - "Accept upstream" (discard patch for this section)
  - "Keep my patch" (block this update segment, log for later cherry-pick)
  - "Manual merge" (open vault-stored merge file for human review)
- Patch tier is the bridge between consume-upstream and full-fork

### 3.3 Fork tier

- User chose Fork at install OR explicitly disconnected
- Keycap is a personal branch; no auto-update
- Irisy stage 7 occasionally surfaces "upstream has new features: X, Y, Z — cherry-pick?"
- Cherry-pick is opt-in, surfaces in workspace tab as a structured diff

## 4. Signature verification

- Layer 2: PyPI hashes
- Layer 3: ed25519 signature embedded in `manifest.signing.pubkey` + bundle signature
- First-install: trust on first use (keep pubkey in user-local trust store)
- Subsequent: signature mismatch → REJECT update, surface Irisy stage 6 alert

## 5. Compatibility checks

- Manifest declares `compatibility.min_ctrl_version` + `compatibility.kernel_manifest_schema`
- Kernel rejects keycap install/update if compatibility envelope fails
- Pool overlay shows "needs CTRL.app upgrade" for incompatible keycaps

## 6. Cross-layer coordination

- Layers update INDEPENDENTLY by default
- Hermes ↔ Kernel MCP server version pinning lives in `compatibility.hermes_min_version` (manifest fields TBD; current default = any hermes-agent >= 0.14.0)

## 7. Settings UI

- `Settings → Updates`:
  - Layer 1 + 4 status (last check / last applied)
  - Per-keycap table: name / current version / upstream version / tier (Config / Patch / Fork) — tier dropdown editable
  - Per-keycap "check for updates now" button + "view upstream" link

## 8. Telemetry (Obsidian-compatible)

- No remote telemetry from CTRL.app about keycap install/update events
- Local audit log (`~/.ctrl/state/update-audit.json`) records install/update/rejection events for user introspection
- Optional creator-side telemetry (keycap-level via the keycap's own backend, opt-in per creator)
