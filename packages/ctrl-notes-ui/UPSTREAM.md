# ctrl-notes-ui — vendored Tolaria frontend (AGPL-3.0-or-later)

> Governing decisions: ADR-006 §5.1.1 v11 (scoped AGPL-vendoring exception) +
> ADR-002 §1.9 v47 (notes frontend = Tolaria UI, CTRL kernel = only backend).
> bao 2026-07-02「前端就用 tolaria」.

## Provenance

- Upstream: <https://github.com/refactoringhq/tolaria> (AGPL-3.0-or-later)
- Forked commit: `3a1cb860efab664218585c606bd6f6c6b3965146` (2026-07-02 snapshot)
- Vendored: `src/` (the React/TypeScript frontend) + `patches/` (its dependency
  patches) + upstream `package.json` (kept as `upstream-package.json` for
  dependency reference). The upstream Rust backend (`src-tauri/`), its
  CLI-integration layer, mcp-server, site, e2e are NOT vendored — CTRL's
  kernel is the only backend, reached through the adapter layer.

## License & compliance

- This package is **AGPL-3.0-or-later** (upstream `LICENSE` retained verbatim).
  It can never be dual-licensed (third-party copyright) — accepted cost,
  contained to this package (ADR-006 §5.1.1).
- Containment: code from this package must NOT be copied into the kernel,
  other packages, or MIT feature packs.
- **Trademarks**: "Tolaria" name/logo are upstream trademarks (not granted by
  AGPL) — they are stripped from user-visible surfaces before ship (F4).
- AGPL §5: files modified by CTRL carry a modification notice comment.

## Sync posture

Snapshot fork + per-release cherry-pick (upstream is alpha, ~10 releases/day —
no continuous-sync promise). CTRL patches concentrate in the adapter layer
(new files) so upstream cherry-picks stay feasible. To evaluate an upstream
release: diff `refactoringhq/tolaria` between the pinned commit above and the
target tag, cherry-pick editor/UX fixes, skip their backend/AI-layer changes.

## Layering (F-slices)

- F1 (this): vendor snapshot + license/provenance.
- F2: adapter — its ~49-command invoke surface → CTRL gate (`gate_invoke`) +
  Tauri commands; AI layer trimmed → Irisy.
- F3: mount as the notes workspace route in ctrl-web (lazy-loaded).
- F4: trim + trademark strip + visual QA.
- F5: cherry-pick playbook.
