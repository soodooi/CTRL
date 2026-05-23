# PWA state — visual snapshots

Captured on `pwa-dev` branch, 2026-05-23. 1440×900 viewport, browser mode (Tauri
kernel unreachable so KRN/MESH/LLM LEDs read gray + ADAPTER `NONE` — that's the
honest empty state per ADR-005 / kernel_status contract).

| # | Screenshot | Route | What it shows |
|---|---|---|---|
| 01 | `01-home-default.png` | `/` no tabs | Default fallback: cockpit StatusBar instruments + left Keyboard (4×4 + Add + system row) + middle SessionWorkspace template (history sidebar + Irisy mascot + ChatInput) + right rail Irisy portal |
| 02 | `02-pool.png` | `/pool` | Pool catalog: title + count meta + search field + 6 source filter chips (All / Built-in / MCP / OAuth / Local / ST-SS) + grid; right rail shows source quick-jump icons |
| 03 | `03-code-space.png` | `/code-space` | Code Space empty state — "No coding sessions running" + onboarding hint + "+ New environment" CTA |
| 04 | `04-settings-manifest-driven.png` | `/settings` | First L3 manifest-driven route. Entire page = `<ManifestRenderer>` consuming a JSON literal (Stack / Heading / Text components) |
| 05 | `05-hermes-embed-tab.png` | `/` with Hermes Settings tab | After clicking ⚙ Settings system key: tab strip shows `⤢ EMBED · Hermes Settings · ×`; EmbedView mounted, status strip shows `127.0.0.1:9119 CONNECTED`. The iframe is black because the hermes daemon isn't running in browser test mode — Tauri runtime will load the actual dashboard once Zeus wires the `hermes dashboard --no-open` supervisor |

## Layer model in these screenshots

- **L0 cockpit chrome** — StatusBar (KRN/MESH/LLM LEDs + ADAPTER pill + MCP/VAULT/IRISY tape + clock/uptime) + left Keyboard 320 + right rail 64
- **L1 primitives** — 18 components shipped: Sparkline / Gauge / Led / ChatInput / HistorySidebar / TabStrip / IrisyMascot / StatusPill / IconButton / FileDropzone / Form / Field / KV / BentoGrid / BentoTile / CommandBar + atoms (Button / Card / Section / FormField / TextInput / KeyInput / Logo / cx)
- **L2 templates** — SessionWorkspace (T5) + ClusterWorkspace (T6) compose L1
- **L3 manifest renderer** — `ManifestRenderer` walks JSON tree → mounts registered L1 components; Settings (image 04) is the working test bed

## What Zeus needs to see for Phase 1F+ wiring

- StatusBar reads `kernel_status` via `useKernelStatus` hook (3s poll). All
  instruments derive from the snapshot. Adding a new field (e.g.
  `hermes_dashboard_url`) lights up immediately.
- `hermes dashboard` URL is currently hardcoded to `http://127.0.0.1:9119` in
  `packages/ctrl-web/src/lib/tab-store.ts` (`HERMES_DASHBOARD_DEFAULT_URL`).
  Once kernel exposes the URL on `KernelStatus.hermes_dashboard_url`, the
  Keyboard handler should switch to reading it dynamically (frontend ready).
- Tauri CSP already allowlists `frame-src http://127.0.0.1:9119` (and the
  `localhost` alias). If Zeus picks a different port, update
  `src-tauri/tauri.conf.json` CSP simultaneously.
