---
name: create-feature-pack
description: >
  Create a governed CTRL feature pack from a user's intent: research and
  confirm the real source, author the correct pack form, validate it, install
  it, and prove it with a real smoke through the :17873 gate.
version: 1.1.0
author: CTRL
metadata:
  hermes:
    tags: [ctrl, feature-pack, integration, connector, mcp, research]
---

# Create a CTRL feature pack

A feature pack turns an external capability, API, MCP server, or local action
into a reusable CTRL capability. The user owns the intent; you research and
author the pack with your model. The kernel validates, installs, governs, and
runs it. Generated JSON or prose alone is not a created pack.

Some lifecycle tools are outside your default tool list. Find them with
`gate_tool_search` and invoke them with `gate_tool_call`. Keep all lifecycle
operations on the `:17873` gate.

## Required lifecycle

### 1. Understand and research

Identify the user's one real job and the smallest useful pack boundary. Ask only
about genuinely ambiguous details.

Research before authoring:

- Use `discover_packs` to look for an existing pack or MCP server. Prefer reuse
  when it satisfies the job.
- Use `discover_skills` when a reusable authoring or domain skill may exist.
- Use `web_search` to verify official API documentation, authentication, real
  endpoints, and response shape. Never invent any of them.
- Read relevant local vault notes when the user already has project knowledge.

### 2. Propose and confirm

Tell the user what the pack will do, which verified source or existing server it
will use, what pack form you chose, and whether configuration or secrets are
required. Wait for explicit confirmation before installing or changing the
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
- **MCP server pack:** reuse a verified existing MCP server or author a small
  local service when custom network or library logic is required. Declare
  `"variant": "mcp-server"` and a top-level
  `"server": {"type": "local", "command": "...", "args": [...]}` block.
  For authored code, pass `server_code` and `server_code_filename` to
  `mcp_pack_install`. Keep source plain-text and user-editable.

Author the manifest as the input to the validation and installation tools.
`mcp_pack_write_file` is not a manifest authoring or installation tool: it only
writes an asset inside an already installed pack.

For data-backed workspaces, use the `vault-smart-tables` skill and its governed
record/text surfaces instead of bespoke UI code.

### 4. Validate and repair before install

Call `mcp_pack_validate` with the complete manifest. Read the report, repair
every reported error, and validate again until it passes. Do not install first
and do not treat generated structure as evidence of validity.

### 5. Install and run a form-specific smoke

Call `mcp_pack_install` only after validation passes. Then prove the installed
capability through its real public face:

- Action pack: call `mcp_pack_run` for at least one representative action and
  inspect its actual result.
- Record source: call `source_describe`, then `source_query` or
  `source_produce`, and inspect real records.
- MCP server pack: call one namespaced server tool returned or discovered after
  installation and inspect its actual result.

If installation or smoke fails, diagnose the evidence, repair the pack, validate
again, reinstall, and repeat the smoke. A successful tool invocation with real
output—not lint, prose, or a manifest—is the completion criterion.

After a green smoke, explain plainly what was created and report the observed
result. Use `mcp_pack_write_file` only now if the installed pack needs additional
plain-text assets.

### 6. Publish only on explicit share intent

`mcp_pack_publish` is optional. Invoke it only after the user explicitly asks to
share or publish the validated, smoke-tested pack.

## Red lines

- Research real sources before authoring; never invent endpoints, auth, or data.
- Confirm the product boundary before installation.
- Validate and repair before every install attempt.
- Keep secrets out of manifests, source, commands, logs, and chat.
- Never use a networked shell action.
- Keep user content and authored service assets plain-text and locally readable.
- Do not claim creation until the installed pack passes its form-specific smoke.

(ADR-002 substrate § 7.4 v34; ADR-002 substrate § 7 v55; ADR-004 cap §1 v9; ADR-005 irisy §9 v25)
