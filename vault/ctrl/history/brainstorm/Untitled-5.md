-

5 primitives

(ADR-001 spine): actor / capability / event / channel / effect -

LLM

: llm_port + llm_adapters/ (claude_cli, anthropic_http, openai_shape, local_config) + brain_config -

MCP

: mcp_host (client) + mcp_server -

Vault

: vault + vault_index -

Storage

: persistence + local_storage + cache -

Runtime

: runtime + scheduler -

ST-SS

: stss_bridge + subprocess_stss_adapter + subprocess_actor -

Resolver

: capability_resolver - mod.rs
