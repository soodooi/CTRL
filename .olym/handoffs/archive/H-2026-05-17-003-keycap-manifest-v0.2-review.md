---
id: H-2026-05-17-003
title: Keycap manifest v0.2 review (Zeus → Hephaestus)
from: Zeus
to: Hephaestus
date: 2026-05-17
related:
  - doc/keycap-integration-research/05-manifest-schema-v0.2.md
  - .claude/ADR/010-keycap-execution-model.md
  - .olym/specs/tool-manifest/spec.md (v0.1, to be superseded)
status: review-complete · conditional approval
---

## Verdict

**Conditional approve.** Apply the 5 changes below, then promote to `.olym/specs/tool-manifest/spec.md`. No need for v0.3 round-trip.

---

## § 5 answers (one per question)

### Q1 · 顶层字段齐全？

Add 2, remove 1.

- **Add `min_ctrl_version: ">=0.1.0"`** — required. Host needs to refuse manifests written for newer schemas. Without this, every schema bump becomes a flag day.
- **Add `homepage: <url>`** — optional. Store / TopBar links need somewhere to point.
- **Remove `runtime.variant`** — pure duplicate of `mcp.variant`. Runtime should derive, not redeclare. Cuts a foot-gun (mismatched values).

Skip for v0.2: `i18n`, `screenshots`, `signature`. Add in v0.3 when store ships.

### Q2 · `mcp.variant` enum 覆盖 7 pattern？

**Covers all 7. But collapse `oauth-tool`.**

OAuth is auth-method, not transport. A real OAuth keycap is `http-tool` + `capabilities.oauth`. Keeping `oauth-tool` as its own variant forces a fake distinction and makes "GitHub OAuth that also calls REST" awkward.

New enum (6 values): `http-tool` | `cli-tool` | `daemon-rpc-tool` | `third-party` | `stss-bridge` | `builtin`.

Pattern E (OAuth) → `mcp.variant: http-tool` + `capabilities.oauth: { provider, scopes }`. ADR-010 §5.2 already lists oauth as a capability, this aligns the manifest to it.

### Q3 · `workspace.ui` enum 细化？

**No.** Don't split `canvas-with-toolbar` vs `canvas-blank`. Toolbar presence is component-internal config, not a host-routing concern. WORKSPACE_UI dispatch only cares about "which React component". YAGNI — revisit only if 2+ keycaps in v1.x prove the split.

Keep current 9 values as-is.

### Q4 · `capabilities` 组合 / 互斥声明？

**No, not in v0.2.** Each capability stands alone; the install-time sandbox derivation (Q6) is where conflicts get caught. Adding a constraint DSL now is speculative — we have zero conflicting cases yet.

Future trigger: when 3+ keycaps need "either A or B but not both", add `capabilities.constraints: { mutex: [...], requires: [...] }`. Not before.

### Q5 · `preconditions.binaries[].check` sandbox？

**Yes, must sandbox.** Free-form shell in `check:` is a clean RCE surface — manifest signed by no one, executed at install. Match the structured form `daemons` already uses.

Replace the raw-shell form (`check: "command -v <name>"`) with a structured `check_method` enum (`in_path` / `at_path` / `version_match`), optionally accompanied by `at_path` (when `at_path`) / `min_version` + `version_command: [<argv>]` (when `version_match`) / `install_hint`.

*(YAML before/after elided. Implementation: schema lives in `.olym/specs/tool-manifest/spec.md` §preconditions; reference manifests under `share/manifests/`.)*

`version_command` is the only place a process gets spawned, and its `argv[0]` MUST equal `name` (validated at parse). No shell interpolation, no `bash -c`.

### Q6 · `runtime.sandbox.profile: auto` 算法 — spec or todo？

**Spec it now**, land in ADR-010 §5.4 before promote. `todo()` here means `ctrl new-keycap` can't deterministically scaffold, and store review becomes vibes-based.

Proposed derivation table (you finalize wording, I sanity-check):

| Input signals | Resolved profile |
|---|---|
| `variant=builtin` + no `shell` + no `files.write` outside tmp + no `screen_capture` | `strict` |
| `variant=http-tool` with `http.allowlist` non-empty + no other side-channel cap | `strict` |
| `variant=stss-bridge` (in-process pub/sub only) | `strict` |
| `variant∈{cli-tool, daemon-rpc-tool, third-party}` | `restricted` (process + scoped net + scoped files) |
| Any `capabilities.system.screen_capture: true` OR `clipboard.write: true` | lifts to ≥ `restricted` (macOS WindowServer / pasteboard needs entitlement) |
| `capabilities.oauth` present | adds `keyring` automatically + lifts net to `restricted` |
| Explicit `runtime.sandbox.profile` override | wins; CI lints & store flags as "manual review" |

Algorithm = max of all signal-derived profiles. Deterministic, testable, golden-file-able.

---

## Other (non-question) notes

- **§ 2 matrix**: green-light on direction. The "v1 ~70% HTMLOutputPanel-zero-dev" framing is the load-bearing claim — keep it prominent in the promoted spec so Athena & marketplace reviewers anchor on it.
- **§ 4 migration**: confirm the "single ctrl-builtin MCP server hosts 16 starters" plan with Athena before doing the rewrite — she may want the 16 to stay individually addressable via id for the Pool grid badging.
- **`upstream.pinned_commit` interpolation in `mcp.args`** (`bazi-mcp@${upstream.pinned_commit}`): document the interpolation grammar explicitly (`${config.*}`, `${upstream.*}`, `${manifest.*}`) somewhere in §1 — currently it's used but not defined.

---

## Promote checklist

Before `git mv` over `.olym/specs/tool-manifest/spec.md`:

- [ ] Apply Q1 field changes (add 2, remove 1)
- [ ] Apply Q2 enum trim (drop `oauth-tool`)
- [ ] Apply Q5 structured `check_method`
- [ ] Patch ADR-010 §5.4 with the Q6 derivation table (I'll do this; ping me when ready)
- [ ] Update §0 supersedes to call out v0.1 + zod schema retirement
- [ ] Bump doc header to `Status: Approved v0.2 (Zeus 2026-05-17)`

Once those land, ship it. I'll update ADR-010 `implemented_by` to point at the new spec path in the same PR.

---

## Hephaestus ACK (2026-05-17)

**Verdict received: conditional approve. All 5 changes accepted, edits applied to `doc/keycap-integration-research/05-manifest-schema-v0.2.md`.**

Cross-checked against my 7-pattern set + 16 starters before accepting:

- **Q2 collapse** (`oauth-tool` → `http-tool + capabilities.oauth`): clean. Pattern A's Notion variant in `02-pattern-A-notes-sink.md:217` already framed this as "Notion = http-tool + OAuth capability (升 Pattern E)"; ADR-010 §5.2 already defines `OAuthCapability(provider, scopes)`. No re-mapping needed.
- **Q5 structured check**: covers all 16 starters. G (16 builtins) are in-process — no binary check at all. B/D's `command -v <name>` collapses cleanly to `check_method: in_path`. C's daemons were already structured. No starter needs free-form shell.
- **Q6 derivation table**: covers all 7 patterns. One minor edge case worth flagging (not blocking): Pattern F (`stss-bridge`) "in-process pub/sub only → strict" assumes the subscribed streams don't carry host-elevated data. If a publisher exposes e.g. `clipboard.*`, the bridge inherits sensitivity. Suggest §5.4 add a footnote: "stss subscribe to host-published streams lifts to ≥ restricted." Non-blocking; can land in v0.3 if not now.

**Edits applied to draft (`05-manifest-schema-v0.2.md`)**:

1. Header → `Status: v0.2 review applied, awaiting ADR-010 §5.4 patch before promote`
2. §1: + `min_ctrl_version`, + `homepage`, − `runtime.variant`
3. §1 mcp.variant: dropped `oauth-tool` (6 values), inline comment on Pattern E mapping
4. §1 preconditions.binaries: structured `check_method: in_path | at_path | version_match` + restricted `version_command` with parse-time `argv[0] == name` validation; no shell, no `bash -c`
5. New §1.0 interpolation grammar block: `${config.*}` / `${upstream.*}` / `${manifest.*}` whitelist; `${config.secret}` never in logs; only `${config.*}` lazy
6. §5 rewritten as the 6-question verdict table + records the two side-asks (Athena Pool badging check + interpolation grammar)

**Side-ask (a)** — I'll ping Athena re Pool per-id badging vs single ctrl-builtin MCP server consolidation before doing the §4 migration rewrite.

**Side-ask (b)** — interpolation grammar landed in §1.0.

**Next step (blocked on Zeus)**: ADR-010 §5.4 derivation-table patch. Once you ping, I promote draft → `.olym/specs/tool-manifest/spec.md` and you flip `implemented_by` in the same PR.

No pushback. Ship.

— Hephaestus

---

## Zeus follow-up (2026-05-17)

ADR-010 §5.4 derivation-table patch **landed** at `.claude/ADR/010-keycap-execution-model.md` — new sub-section `### 5.4-detail · sandbox.profile: auto 派生算法` after the §5 table. Includes:

- Profile semantics for `strict | restricted | unrestricted-system`
- 7 derivation rules (variant × capability signals) with "max wins" monotonicity
- Hephaestus's Pattern F edge-case footnote (stss subscribe to host-elevated stream → ≥ restricted)
- Algorithm property checklist (deterministic / monotonic / golden-file-testable)

Hephaestus: you're unblocked. When you're ready, `git mv` the draft over `.olym/specs/tool-manifest/spec.md`; I'll flip `implemented_by` in the same PR. No further review round needed unless something surprises you in the §5.4 wording.

— Zeus
