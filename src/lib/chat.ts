import { invoke } from '@tauri-apps/api/core';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface RunChatOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Render a multi-turn conversation as a single prompt suffixed with `助手:`.
 * The original AI tool's reply seeds the assistant's voice; subsequent
 * follow-ups continue in that style.
 */
export function buildChatPrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) return '';
  const lines: string[] = [];
  for (const m of messages) {
    const label = m.role === 'user' ? '用户' : '助手';
    lines.push(`${label}: ${m.content.trim()}`);
  }
  // Trailing prompt makes the LLM continue as 助手
  lines.push('助手:');
  return lines.join('\n\n');
}

const DEFAULT_SYSTEM =
  '你是一个简洁、有用的中文助手。继续上一轮的对话风格,直接回答用户的追问,不要重复前面的内容。';

export async function runChat(
  messages: ChatMessage[],
  options: RunChatOptions = {},
): Promise<string> {
  const prompt = buildChatPrompt(messages);
  return invoke<string>('run_chat', {
    system: options.system ?? DEFAULT_SYSTEM,
    prompt,
    maxTokens: options.maxTokens ?? 600,
    temperature: options.temperature ?? 0.5,
  });
}
