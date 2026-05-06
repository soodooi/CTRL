import { invoke } from '@tauri-apps/api/core';

// Field names match Rust serde output (snake_case).
export interface LlmProfile {
  name: string;
  kind: 'openai-compatible' | 'anthropic' | string;
  base_url: string;
  default_model: string;
  api_key?: string | null;
}

export interface LlmSettings {
  profiles: LlmProfile[];
  default_profile?: string | null;
}

export function getLlmSettings(): Promise<LlmSettings> {
  return invoke<LlmSettings>('get_llm_settings');
}

export function setLlmKey(profile: string, key: string): Promise<void> {
  return invoke<void>('set_llm_key', { profile, key });
}

export function bootstrapMinimax(): Promise<LlmSettings> {
  return invoke<LlmSettings>('bootstrap_minimax');
}

export function profileHasKey(p: LlmProfile): boolean {
  return Boolean(p.api_key && p.api_key.length > 0);
}
