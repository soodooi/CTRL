---
name: olym-spec-decision
description: Run the Olym spec-discipline decision tree (15-second triage). Use when the user says "我要写 spec", "新需求记下来", "should we open a spec", or otherwise wants to decide where a new requirement should be recorded. Anti-bloat — many requirements DO NOT need a new spec; bump existing, write ADR, drop to steering, or just open a handoff.
---

# Olym Spec Decision Tree

The Olym framework has 31+ active framework specs already — anti-bloat is a real concern. Before opening a new spec dir, run this 15-second decision tree.

## When to activate

- User says "我要写 spec" / "新需求记下来" / "这件事要 spec 化" / "should we open a spec"
- After a brainstorm session has surfaced a concrete requirement
- Before any RFC walk (if you reach RFC stage and there's no spec yet, run this skill first)

## The decision tree (run in order; first match wins)

```
新需求要写下来
  ↓
1. 现有 spec 能 bump?
   → 是 → bump (minor/major) + 加 § + changelog entry. STOP. 不开新.
  ↓ 否
2. 是 once-off 决策 (含 alternatives + reversibility)?
   → 是 → 写 ADR `.olym/decisions/<NNN>-<slug>.md`. STOP.
  ↓ 否
3. 是 evergreen 规则 (跨多 feature 复用, 行为契约)?
   → 是 → 写 steering `.olym/steering/<topic>.md`. STOP.
  ↓ 否
4. 是 contract (附属 code 文件 — 函数行为 / API 输入输出)?
   → 是 → 写 TSDoc 在源码里, 不开 spec. STOP.
  ↓ 否
5. 是短期 plan (1-7 day, 单 lane, 不复用)?
   → 是 → 开 handoff `.olym/handoffs/H-...md`. STOP.
  ↓ 否
6. 都不是 → 开新 spec
   `.olym/specs/<topic>/spec.md` 含 mandatory frontmatter:
     spec_id / version / status / owner / created / updated / superseded_check
```

## Worked examples

### Example A — "Should we add a new auth flow for OAuth provider X?"

- Step 1: Does `customer-auth/spec.md` or similar exist? YES → bump it with a new §, add changelog entry. STOP.

### Example B — "We picked Bifrost over LiteLLM after a spike"

- Step 1: No existing spec covers vendor choice.
- Step 2: Once-off decision with alternatives (Bifrost vs LiteLLM vs self-built) and reversibility (Apache 2.0, can fork). → Write ADR `.olym/decisions/<NNN>-logos-vendor-strategy.md`. STOP.

### Example C — "Code must use `db.business(env)` not `env.DB`"

- Step 1: Does a relevant spec exist? No standalone spec for db wrapper.
- Step 2: Not a once-off — applies to every worker forever.
- Step 3: Evergreen rule → write steering `.olym/steering/db-wrapper-policy.md`. STOP.

### Example D — "Implement enrichment cron job for 7 days"

- Step 5: Short-term plan, single lane (data). → Open handoff. STOP. No spec.

### Example E — "Synthetic users — full system for daily smoke + monitoring + recommendation cold-start"

- Cross-cutting, evergreen system with deliverables → Step 6 reached. Open new spec `.olym/specs/synthetic-users/spec.md`.

## Mandatory spec frontmatter (Step 6 only)

If you reach Step 6, the spec MUST have this frontmatter (per `.olym/steering/protocol/spec-discipline.md §3`):

```yaml
---
type: spec                              # OR spec-meta-architecture / spec-stub
spec_id: <kebab-id, unique>
status: proposed | active | shipped | archived | stub
version: 0.1.0                          # semver — spec doc version, NOT product version
owner: zeus | <lane-owner>
created: YYYY-MM-DD
updated: YYYY-MM-DD
audit_dimension: <dimension>            # how this spec gets audited
related:
  - <path to sibling specs / steering / handoffs>
superseded_check: |                     # how to know this spec is stale and needs replacement
  <1-2 sentence test>
---
```

The `superseded_check` field is non-optional — without it, future readers cannot tell when the spec has gone stale. If you cannot write a meaningful `superseded_check`, the spec probably belongs in steering or as a handoff instead.

## Anti-patterns

- **One-spec-per-rule** — Olym's current `.olym/specs/` has 30 framework meta-specs, many of which could merge. Don't add to the pile. If you're writing the 4th spec on a related topic, consider opening a single umbrella spec and folding the others as sub-sections.
- **Spec for short-term plan** — handoff is the right tool for 1-7 day single-lane work.
- **Spec for once-off decision** — ADR with alternatives is the right tool.
- **Spec without `superseded_check`** — will rot. Spec discipline §3 requires it.
- **Skipping the decision tree because "obviously needs a spec"** — most "obvious" cases land at Step 1 (bump existing). Always run the tree.

## Reference

- Decision tree source: `.olym/olym-handbook.md §9` (15s tree)
- Full discipline: `.olym/steering/protocol/spec-discipline.md` §6 (decision tree) + §3 (frontmatter) + §4 (semver) + §7 (RFC trigger)
- Anti-bloat: same doc, "反膨胀机制" section
- Current spec inventory: `.olym/specs/_index.md` (auto-generated)
