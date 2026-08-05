---
name: create-feature-pack
description: >
  Guide CTRL Coding/OpenCode through governed feature-pack creation from a
  user's intent: research and confirm the real source, discover and reuse the
  best backend, author the correct pack form, validate it, install it, and
  prove its public capabilities against real software through the :17873 gate.
version: 1.4.0
author: CTRL
metadata:
  hermes:
    tags: [ctrl, opencode, coding, feature-pack, integration, connector, mcp, research, verification]
---

# Create a CTRL feature pack

A feature pack turns an external capability, API, MCP server, or local action
into a reusable CTRL capability. In CTRL Coding mode, OpenCode must load this
skill with `skill_list` then `skill_read` before planning or editing a pack; the
skill is the authoring authority while Coding supplies the isolated workspace
and governed tools. The user owns the intent; you research and author the pack
with your model. The kernel validates, installs, governs, and runs it. Generated
JSON or prose alone is not a created pack.

Some lifecycle tools are outside your default tool list. Find them with
`gate_tool_search` and invoke them with `gate_tool_call`. Keep all lifecycle
operations on the `:17873` gate.

## Required lifecycle

### 1. Understand, discover, and research

Identify the user's one real job and the smallest useful pack boundary. Ask only
about genuinely ambiguous details.

Research before authoring:

- Use `discover_packs` to look for an existing pack or MCP server. Prefer reuse
  when it satisfies the job.
- Inventory the target's existing backends in this order: native CLI, documented
  scripting or automation API, existing MCP server, then a custom bridge only
  when none of the verified options satisfies the job.
- Verify the selected backend's installed public entrypoint, supported version,
  authentication, commands or methods, output shape, state ownership, and
  failure behavior. Do not design against an internal module import or an
  undocumented protocol.
- Use `discover_skills` when a reusable authoring or domain skill may exist.
- Use `web_search` to verify official API documentation, authentication, real
  endpoints, and response shape. Never invent any of them.
- Read relevant local vault notes when the user already has project knowledge.
- Before starting fresh research, check whether `Research/feature-packs/`
  already holds a note for a similar pack (`vault_search` that folder) — reuse
  its findings instead of re-researching from scratch.

Record the research as you go, in a single vault note at
`Research/feature-packs/<pack-id-or-topic-slug>.md` (create with `doc_produce`
or `vault_write`; the slug matches the pack `id` you will author, or your best
candidate name if not yet decided). This is the durable, user-readable record
of what the pack is built on — the manifest itself carries none of it. Use
these sections, populated only as they apply (omit an empty one rather than
leaving a stub):

- `## Job` — the user's real need, one line.
- `## Sources` — every reference you actually used: API docs, verified
  endpoints, an existing MCP server, or a dropped attachment (a screenshot, a
  spec) — link or name each one plainly.
- `## Backend discovery` — the CLI, scripting/automation API, MCP, and bridge
  options checked; record why the selected existing backend is sufficient or
  why a custom bridge is necessary.
- `## Comparable products` — any product/pack you found doing something
  similar, and how (only when the research turned any up).
- `## User signals` — direct quotes or paraphrases of what the user asked for
  or corrected, when they clarified the boundary.
- `## Capability coverage` — the intended public capabilities, selected backend
  operation for each one, verification evidence, and explicit uncovered gaps.
- `## Decision` — the pack form you chose and why.

Update this note if the boundary, backend, coverage, or source changes
mid-conversation; it is a working record, not a one-shot snapshot taken only at
the end.

### 2. Propose and confirm

Tell the user what the pack will do, which verified backend or existing server it
will use, what pack form you chose, which important gaps remain, and whether
configuration or secrets are required. Point them at the
`Research/feature-packs/` note instead of re-explaining everything you already
wrote there. Wait for explicit confirmation before installing or changing the
user's capability set.

Do not ask the user to write a technical specification and do not expose secret
values in chat. Secret configuration belongs in `config_schema` with
`kind: secret`; CTRL stores it in the OS keychain.

### 3. Choose and author one pack form

Choose from evidence, not convenience:

- **Action pack:** use `actions[]` for local deterministic logic. The action
  shell sandbox has no network access, so never use `curl`, `wget`, or another
  network client in a shell step.
- **Record source:** use `record_source` for a researched REST/OpenAPI data
  source. If an OpenAPI operation exists, call `mcp_pack_scaffold` with the
  OpenAPI document, path, and method. It returns a `record_source` fragment;
  it does not create a generic pack skeleton. Complete the surrounding manifest
  yourself and verify the generated fields and authentication against the docs.
- **MCP server pack:** reuse a verified existing MCP server or author one focused
  local service when custom network, library, or native-application logic is
  required. One bounded application/pack normally owns one server, which may
  expose multiple atomic tools. Native CLI or application protocols remain
  private below that server. Do not expose arbitrary shell access, mirror every
  backend command, create a stateful REPL, or make harness state a second truth.
  Declare `"variant": "mcp-server"` and a top-level
  `"server": {"type": "local", "command": "...", "args": [...]}` block.
  For authored code, pass `server_code` and `server_code_filename` to
  `mcp_pack_install`. Keep source plain-text and user-editable.

Author the manifest as the input to the validation and installation tools.
`mcp_pack_write_file` is not a manifest authoring or installation tool: it only
writes an asset inside an already installed pack.

For data-backed workspaces, use the `vault-smart-tables` skill and its governed
record/text surfaces instead of bespoke UI code.

### 4. Define evidence, validate, and repair before install

Before installation, add a verification matrix to `## Capability coverage`.
For every intended public capability, identify:

- the installed public entrypoint and representative input;
- the real application, service, or file backend the test will exercise;
- the observable result and semantic assertions beyond process exit;
- an agent-only scenario using only public skill and tool descriptions;
- any produced artifact's format, structure, key semantics, and reopen/read-back
  check when the format permits;
- preview evidence as `none`, `structural`, `rendered`, or `live`; reserve `live`
  for output proven to reflect current application state.

These are authoring and test records, not invented manifest fields. Do not add
an `artifact_verifier` or preview-level field unless the accepted manifest schema
already defines it.

Call `mcp_pack_validate` with the complete manifest. Read the report, repair
every reported error, and validate again until it passes. Do not install first
and do not treat generated structure as evidence of validity.

### 5. Install and prove the real public capability

Call `mcp_pack_install` only after validation passes. Then prove the installed
capability through its real public face:

- Action pack: call `mcp_pack_run` for at least one representative action and
  inspect its actual result.
- Record source: call `source_describe`, then `source_query` or
  `source_produce`, and inspect real records or the produced result.
- MCP server pack: call one namespaced server tool returned or discovered after
  installation and inspect its actual result.

The smoke must use the installed public entrypoint, not an internal import or a
direct native-backend bypass. For a native application harness, run against the
real application without disturbing unrelated user work. Run at least one
agent-only scenario from the public descriptions. A zero exit status, accepted
tool call, mock response, or plausible prose is not sufficient evidence.

For produced artifacts, verify the declared semantic properties and reopen or
read back the artifact when possible. Verify that a preview matches the same
current target and label its evidence level honestly; never present a static
mock, stale snapshot, or structural summary as live preview. Update the coverage
inventory with observed evidence and leave unsupported capabilities as explicit
gaps rather than claiming completeness.

If installation, public invocation, semantic verification, or preview evidence
fails, diagnose the observed root cause, repair the pack, validate again,
reinstall, and repeat the affected checks. After a green verification matrix,
explain plainly what was created and report the observed results and remaining
gaps. Use `mcp_pack_write_file` only now if the installed pack needs additional
plain-text assets.

### 6. Publish only on explicit share intent

`mcp_pack_publish` is optional. Invoke it only after the user explicitly asks to
share or publish the validated, installed, real-backend-tested pack.

## Red lines

- Research real sources and discover existing backends before authoring; never
  invent endpoints, auth, commands, protocols, or data.
- Confirm the product boundary before installation.
- Validate and repair before every install attempt.
- Keep native protocols private and every public capability on the CTRL gate.
- Keep tools atomic; do not add a server-owned workflow or stateful REPL.
- Keep secrets out of manifests, source, commands, logs, and chat.
- Never use a networked shell action.
- Keep user content and authored service assets plain-text and locally readable.
- Treat real entrypoint, real backend, agent-only, artifact, and preview checks
  as evidence; process exit alone is never completion.
- Do not claim creation or coverage until the installed pack passes its recorded
  verification matrix; report gaps honestly.

(ADR-001 spine §4 v21; ADR-002 substrate § Composition v76; ADR-004 cap § execution v14; ADR-005 irisy §11 v38)
