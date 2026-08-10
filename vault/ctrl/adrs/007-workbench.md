---
adr_id: 007
module: workbench
title: CTRL workbench — deprecated canvas/orchestrator and discovery provenance
version: 3
status: deprecated
last_updated: 2026-08-05
deciders: [bao, zeus]
sections:
  - { id: canvas, source: retired-v3, note: "Historical orig-022 canvas/orchestrator authority retired because CTRL is not a workflow editor." }
  - { id: discovery, source: retired-v3, note: "Historical orig-023 discovery authority migrated without orphaning: local registry/install/source policy → ADR-002 v81; Library UI → ADR-003 v40; cloud search policy → ADR-006 v13." }
changelog:
  - v3 2026-08-05: **ADR deprecated; canvas/orchestrator and local/cloud discovery bodies retired.** CTRL is not a workflow editor, so React Flow composition, graph IR, and the thin orchestrator are no longer live architecture. Discovery authority moves as one coordinated set: ADR-002 substrate v81 owns the single hot-scanned local registry, normalized provider adapter, source descriptors, and anonymous local install; ADR-003 frontend v40 owns Library as the sole browse/search/install UI; ADR-006 cross-cutting v13 owns optional cloud normalized capability/Skill search. No decision is orphaned and this ADR retains provenance only.
  - v2 2026-07-13: **Skill discovery reconciled with the current runtime and source model.** §5 removes retired ST-SS from live source types; Phase 1 and future-work execution now dispatch SKILL.md through the selected current engine and `:17873` gate rather than Pi. Historical provenance remains in retired ADR-008/009.
  - v1 2026-05-31: module reorg — merged orig-022 (workbench = sanctioned mcp-composition canvas) + orig-023 (skill discovery — kernel-local first 走通, ctrl-cloud Worker for production).
related:
  - vault/ctrl/adrs/002-substrate.md
  - vault/ctrl/adrs/003-frontend.md
  - vault/ctrl/adrs/006-cross-cutting.md
---

# ADR-007 — deprecated workbench authority

## Status

This ADR is historical provenance only. CTRL is not a workflow editor. It has no live canvas, graph editor, graph execution IR, or CTRL-owned workflow orchestrator authority. One-shot capability operations remain governed by ADR-001 and ADR-002.

## Retired section provenance

- **Canvas (§1–§6 in v1–v2): retired-v3.** The former React Flow/dnd-kit composition canvas and thin topological orchestrator bodies are removed. Their existence in earlier versions does not authorize a workflow-editor product surface or runtime.
- **Discovery (§7–§9 in v1–v2): retired-v3.** The former split local/cloud discovery and Irisy-only search bodies are removed. Their live decisions were migrated rather than discarded:
  - **ADR-002 substrate v81** — ResourceRef/descriptor authority, one hot-scanned local registry, normalized provider adapter, source ownership, anonymous local install, and optional developer PAT in the OS keychain.
  - **ADR-003 frontend v40** — Library is the sole browse/search/install surface; Irisy may invoke the same registry conversationally and does not own a second search UI.
  - **ADR-006 cross-cutting v13** — `ctrl-cloud` may provide normalized capability/Skill search only, under bounded cache/rate limits and explicit-origin CORS; it never owns content, storage, or install execution.

There is no orphan authority and no live future-work list in this deprecated ADR.

## Provenance

- Canvas provenance: orig-022, merged into ADR-007 v1 on 2026-05-31; carried through v2; retired-v3.
- Discovery provenance: orig-023, merged into ADR-007 v1 on 2026-05-31; amended v2; migrated to ADR-002 v81, ADR-003 v40, and ADR-006 v13; retired-v3.
