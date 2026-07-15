---
inclusion: fileMatch
fileMatchPattern: "{packages/ctrl-mcp*/**,src-tauri/src/kernel/provider/**,src-tauri/src/kernel/mcp_server.rs,src-tauri/src/kernel/mcp_host.rs}"
---

# MCP and Provider Development

Read ADR-001 and the relevant sections of ADR-002, ADR-004, ADR-006, ADR-007, and ADR-010 before assessment or changes.

`packages/ctrl-mcp-sdk/src/manifest-schema.ts` is the executable manifest SSOT; `packages/ctrl-mcps/` contains bundled definitions. Preserve legacy schema compatibility, least-privilege capabilities, and the distinction between MCP, API, and Skills. Use `mcp`, not `keycap`, as the technical term.

The built-in tool priority set is Clipboard AI, OCR, Translate, Text, and Chat (P0); Window, PDF, LaTeX, Knowledge, and Screen Recording (P1); then Snippet, Code, Email, Meeting, and Sync. These are atomic tools, not product-level capability packs.

LLM hard lock: Anthropic Claude, OpenAI GPT, and Ollama are BYOK-only. The default subscription path uses CF Workers AI; the runtime hot path must not require Anthropic or OpenAI SDKs unless the user explicitly configured that provider.

Never hardcode provider, OAuth, or gate credentials. External calls must return through the governed `:17873` gate; do not create a parallel execution path or duplicate a capability across MCP and Tauri surfaces.

Run the affected workspace tests and `npm run typecheck`; add Rust gate tests only when Rust behavior changes.
