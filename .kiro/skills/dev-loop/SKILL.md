---
name: dev-loop
description: Run CTRL's goal-anchored development loop: read goal and ADRs, plan the system, implement the smallest coherent change, verify, independently review, and report evidence.
---

# CTRL Development Loop

1. **Anchor** — Read `vault/ctrl/GOAL.md`. Identify the next smallest verifiable step; ask bao if the goal or decision is missing.
2. **Govern** — Read `vault/ctrl/adrs/INDEX.md`, ADR-001, and the owning module ADR before assessment or code changes.
3. **Design** — Establish boundaries and data/layout flow before local edits. Do not debug a system into shape.
4. **Investigate** — For bugs, reproduce and trace the root cause before proposing a fix. After three failed hypotheses, stop and question the architecture.
5. **Implement** — Make one coherent change. Keep source English, secrets external, and non-trivial comments tied to `(ADR-NNN module § section vN)`.
6. **Verify** — Run the affected compiler/type check and targeted tests. Add a `:17873` runtime smoke for gate changes and Playwright/visual evidence for UI changes. Read output and exit status.
7. **Review** — For non-trivial changes, invoke the independent `semantic_reviewer`; fix blocking findings.
8. **Confirm** — Review Git status/diff and verify every requested criterion before reporting completion.

Never claim success from intent, partial checks, or another agent's report. Never commit or push unless the user explicitly asks.
