// @ctrl/desktop — Olym desktop runtime entry point.
// Exports the 5 ports + reference adapters for CTRL Tauri host.

export type { LLMPort, ChatRequest, ChatChunk, ChatComplete, LLMTool, Persona } from './ports/llm.js';
export type { StoragePort, SQLitePort, KVPort, SecureStorePort } from './ports/storage.js';
export type { AuthPort, AuthPrincipal } from './ports/auth.js';
export type { ToolPort, ToolManifest, ToolSource, ToolInvokeRequest, ToolInvokeResult } from './ports/tool.js';
export type { HistoryPort, HistoryEvent, HistoryQuery } from './ports/history.js';

// Adapters and cloud-sync client to be added in P4+ (after L1 Kernel exists)
