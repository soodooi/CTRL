// LLM Port — vendor-agnostic interface for desktop LLM adapters.
// Domain code talks only to this interface; adapters wrap concrete vendors
// (Anthropic / OpenAI / Workers AI cloud-proxy / Ollama local / etc).

export type Persona = string;

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
}

export interface ChatRequest {
  readonly persona: Persona;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: ReadonlyArray<LLMTool>;
  readonly deadlineMs?: number;
}

export interface LLMTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown; // JSON Schema
}

export interface ChatChunk {
  readonly delta: string;
  readonly finishReason?: 'stop' | 'length' | 'tool_use' | 'error';
}

export interface ChatComplete {
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<{ name: string; arguments: unknown }>;
  readonly finishReason: 'stop' | 'length' | 'tool_use' | 'error';
}

export interface LLMPort {
  chatStream(req: ChatRequest): AsyncIterable<ChatChunk>;
  chatComplete(req: ChatRequest): Promise<ChatComplete>;
}
