---
kind: irisy-playbook
managed_by: irisy
version: 1
description: Irisy's accumulated procedural memory. Append-only — the reflection subagent writes here; the main Irisy turn reads here.
---

# Irisy Playbook

This file is Irisy's procedural memory (ADR-005 irisy v4 §5). Episodes
in `vault/irisy/episodes/` are the raw evidence; this file is the
distilled rules Irisy applies on the next turn.

## Format

Each entry is one ATX-level-3 heading plus 1-3 bullets. Bullets are
phrased as triggers + action ("When X, do Y"). Date-tag every entry so
older ones can be aged out by the curator.

## Entries

<!-- Reflection subagent appends below this line. Hand-edits are also
honoured — write whatever helps. -->
