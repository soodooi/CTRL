# CTRL

> A local-first ambient AI workbench. Press `Ctrl`, ask one App AI assistant, and turn local capabilities into inspectable work.

CTRL serves one-person companies, independent developers, and professional creators who want AI to operate their own files, tools, models, and applications without moving the source of truth into a vendor cloud.

## Start here

Read these in order before changing the repository:

1. [`vault/ctrl/GOAL.md`](vault/ctrl/GOAL.md) — the single active development goal.
2. [`vault/ctrl/adrs/INDEX.md`](vault/ctrl/adrs/INDEX.md) and [`ADR-001`](vault/ctrl/adrs/001-spine.md) — the architecture registry and immutable spine.
3. The owning module ADR for the area being changed.
4. [`PRODUCT.md`](PRODUCT.md) — stable product intent only; never an architecture override.

Irisy is the shipped App AI assistant. The left-region Coding agent and out-of-product CTRL development agents are separate actors. The sole role contract is [`ADR-005 §11`](vault/ctrl/adrs/005-irisy.md#11-app-ai-assistant-role-boundary-v36).

## Development

Prerequisites: Rust 1.77+, Node 20 LTS, npm 10+, and Tauri 2. macOS 13+ is the primary platform; Windows is secondary.

```bash
npm install
npm run tauri:dev
```

The desktop shell starts the Rust kernel, the authenticated `:17873` capability gate, the current Tauri Channels/CBOR-over-WebSocket event transport, the global Ctrl hotkey, and the PWA WebView.

PWA-only development:

```bash
npm run dev
```

Release build:

```bash
npm run tauri:build
```

Validation and release requirements are governed by [`vault/ctrl/adrs/PROCESS.md`](vault/ctrl/adrs/PROCESS.md), repository scripts, and the owning ADR—not this README.

## Repository map

- `src-tauri/` — native shell and Rust kernel
- `packages/ctrl-web/` — PWA frontend
- `packages/ctrl-mcps/` — built-in capability implementations
- `ctrl-skills/` — shareable Skills
- `vault/ctrl/` — development governance: the active goal, module ADRs, planning lenses, research, generated inventories, and history
- `docs/` — static human-facing repository materials: design prototypes, reference assets, and development setup guides; never architecture authority
- `brand/` — visual identity and tokens

## License

See [`LICENSE`](LICENSE). Packaging and distribution must also satisfy the repository's governing open-core policy before release.
