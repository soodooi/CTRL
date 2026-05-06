import { invoke } from '@tauri-apps/api/core';

export interface Author {
  name: string;
  github?: string;
  url?: string;
  avatar?: string;
}

export interface Description {
  short: string;
  long?: string;
}

export interface ActionMeta {
  id: string;
  name: string;
  description?: string;
  input: string;
  output: string;
  scenes: string[];
}

export interface Tool {
  id: string;
  name: string;
  version: string;
  author: Author;
  description: Description;
  icon?: string;
  category: string;
  tags: string[];
  permissions: string[];
  actions: ActionMeta[];
  /** Two-letter vim-style chord, e.g. "as" → AI Summarize. Optional. */
  chord?: string;
}

export function listTools(): Promise<Tool[]> {
  return invoke<Tool[]>('list_tools');
}

export function runAction(toolId: string, actionId: string): Promise<string> {
  return invoke<string>('run_action', { toolId, actionId });
}

export function isAiTool(t: Tool): boolean {
  return t.category === 'ai-summary' || t.tags.includes('ai');
}
