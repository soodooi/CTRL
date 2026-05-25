---
$schema: https://ctrlapplab.com/schema/tool/v1.json
id: pi
manifest_version: 1
name: Pi (default brain)
version: 0.1.0
author:
  name: CTRL App Lab
  github: ctrlapplab
description:
  short: Pi (badlogic/pi-mono coding agent) as CTRL's default brain runtime.
  long: |
    Pi is a minimalist coding agent (~1000-token system prompt, 4 builtin
    tools: read / write / edit / bash) that consumes Anthropic-format
    SKILL.md (agentskills.io open standard) and talks to any major LLM
    provider via Pi's own provider config.

    This keycap wraps Pi as an MCP server so Irisy and any other MCP
    client can call it through the standard `text.chat` capability. Pi
    manages its own provider — CTRL is provider-passthrough for brain
    keycaps by design (no second copy of credentials in CTRL config).
icon: BrainCircuit
keycap_color: cobalt
category: brain
tags: [brain, agent, llm, coding-agent, default]

# Brain keycap target — orthogonal to `variant`. See
# .olym/specs/tool-manifest/spec.md §13 (pluggable agent runtime).
target: brain
capability: text.chat
bridge: '@ctrl/pi-plugin'
# Pi handles its own provider config (Anthropic / OpenAI / Google / xAI /
# Groq / Cerebras / Mistral / OpenRouter). CTRL doesn't proxy credentials.
provider_passthrough: true

variant: mcp-server
source:
  type: mcp
  server_id: ctrl-pi-brain
  tool_name: text.chat

license: MIT  # Pi upstream (badlogic/pi-mono) is MIT; this wrapper is UNLICENSED but the brain runtime is MIT.

permissions:
  - network  # Pi spawns subprocess that talks to LLM providers over HTTPS.
  - filesystem  # Pi's 4 builtin tools (read/write/edit/bash) operate on user files.

capabilities:
  network:
    http:
      allowlist:
        - 'https://api.anthropic.com/*'
        - 'https://api.openai.com/*'
        - 'https://generativelanguage.googleapis.com/*'
        - 'https://api.x.ai/*'
        - 'https://api.groq.com/*'
        - 'https://api.cerebras.ai/*'
        - 'https://api.mistral.ai/*'
        - 'https://openrouter.ai/*'
      methods: [GET, POST]

config_schema:
  fields:
    - key: pi_provider
      kind: enum
      label: Pi LLM provider
      description: Which provider Pi should talk to. Pi resolves the credentials from its own ~/.pi/config.
      required: false
      options:
        - anthropic
        - openai
        - google
        - xai
        - groq
        - cerebras
        - mistral
        - openrouter
    - key: pi_model
      kind: string
      label: Pi model (optional override)
      description: Leave blank to use the provider's default; set e.g. `claude-sonnet-4-6` to pin.
      required: false
    - key: pi_bin
      kind: string
      label: Pi binary path (optional)
      description: Override the auto-detected `pi` location. Useful when Pi is installed under a non-standard prefix.
      required: false

actions:
  - id: chat
    name: Chat
    description: Stream a chat turn through Pi and surface the assistant reply.
    input: prompt
    output: workspace
    scenes: [any-app]
    steps:
      - type: mcp-invoke
        server: ctrl-pi-brain
        tool: text.chat
        args:
          messages: '{{messages}}'
---

# Pi (default brain)

Pi is CTRL's default brain keycap as of 2026-05-25 (bao verbal approval —
see `.olym/handoffs/H-2026-05-25-001-pi-default-brain.md`).

## Why Pi over a custom brain

- **agentskills.io is open** — Pi consumes the same Anthropic SKILL.md
  format that any other compliant client consumes. CTRL doesn't pick a
  walled-garden runtime.
- **Minimal surface** — 4 builtin tools (read / write / edit / bash) +
  sub-1000-token system prompt aligns with CTRL's 5-primitive kernel
  philosophy.
- **Provider-agnostic** — Anthropic / OpenAI / Google / xAI / Groq /
  Cerebras / Mistral / OpenRouter. Pi owns the provider config; CTRL is
  pass-through (see `provider_passthrough: true` above).
- **Obsidian-compatible** — Pi treats files as truth; no second-source-of-
  truth memory layer to conflict with the CTRL vault.

## Install

This keycap ships with the bridge runtime (`@ctrl/pi-plugin`). The Pi
binary itself is **not** bundled — CTRL is augmentation, not distributor.
Install Pi once with:

```bash
npm i -g @pi/coding-agent   # global install (preferred)
# or just have npx around — the bridge falls back to `npx pi` on demand.
```

The bridge auto-detects Pi via `$CTRL_PI_BIN` → `$PATH` → `~/.local/bin/pi`
→ `npx pi`. If none of those resolve, the MCP server returns a clear
"install Pi" error to the PWA so Irisy can prompt the user.

## How the kernel finds this

The kernel's brain router (zeus lane, separate handoff) reads the
`target: brain` + `capability: text.chat` fields and treats this keycap
as the answer for any text-completion request from Irisy. To swap brains
(e.g. to hermes-as-optional), the user replaces the active brain keycap
in `~/.ctrl/active-brain` — no kernel rebuild required.
