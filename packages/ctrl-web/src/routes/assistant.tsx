// Assistant — hermes via the kernel MCP bus.
//
// ADR-002 substrate §1 v19 (2026-06-09, 3-agent aggregator): hermes is an
// mcp-stdio agent connected through connect_agent_mcp; chat goes through
// the existing mcp_call command (kernel owns the MCP bus, §1.3). The
// retired hermes_chat_stream SSE bridge is gone. PWA owns retry.

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgent } from '@/lib/use-agent';
import styles from './assistant.module.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const CHAT_TOOL = 'chat';

// MCP CallToolResult — extract the text content blocks.
function extractToolText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const r = result as { content?: Array<{ type?: string; text?: string }> };
    if (Array.isArray(r.content)) {
      const text = r.content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');
      if (text) return text;
    }
  }
  return JSON.stringify(result);
}

export function AssistantRoute() {
  const agent = useAgent('hermes');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverId = agent.endpoint?.kind === 'mcp_server' ? agent.endpoint.server_id : null;
  const hasChatTool =
    agent.endpoint?.kind === 'mcp_server' ? agent.endpoint.tools.includes(CHAT_TOOL) : false;

  const sendMessage = async () => {
    if (!input.trim() || isSending || !serverId) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setIsSending(true);
    setError(null);

    try {
      const result = await invoke<unknown>('mcp_call', {
        args: {
          server_id: serverId,
          tool_name: CHAT_TOOL,
          args: {
            messages: history.map((m) => ({ role: m.role, content: m.content })),
          },
        },
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: extractToolText(result),
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {agent.status !== 'ready' && (
          <div className={styles.empty}>
            <h2>Hermes Assistant</h2>
            {agent.status === 'installing' && <p>Installing hermes…</p>}
            {agent.status === 'launching' && <p>Connecting hermes to the MCP bus…</p>}
            {agent.status === 'error' && (
              <>
                <p>Hermes failed to start: {agent.error}</p>
                <button type="button" onClick={() => void agent.retry()} className={styles.sendButton}>
                  Reconnect
                </button>
              </>
            )}
          </div>
        )}
        {agent.status === 'ready' && !hasChatTool && (
          <div className={styles.empty}>
            <h2>Hermes Assistant</h2>
            <p>
              Hermes is connected but exposes no `{CHAT_TOOL}` tool (available:{' '}
              {agent.endpoint?.kind === 'mcp_server' && agent.endpoint.tools.length > 0
                ? agent.endpoint.tools.join(', ')
                : 'none'}
              ).
            </p>
          </div>
        )}
        {agent.status === 'ready' && hasChatTool && messages.length === 0 && (
          <div className={styles.empty}>
            <h2>Hermes Assistant</h2>
            <p>
              Powered by{' '}
              <a
                href="https://github.com/NousResearch/hermes-agent"
                target="_blank"
                rel="noopener noreferrer"
              >
                Hermes
              </a>
            </p>
            <p>Features: RAG, embeddings, long-term memory, knowledge retrieval</p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.message} ${
              msg.role === 'user' ? styles.userMessage : styles.assistantMessage
            }`}
          >
            <div className={styles.roleLabel}>
              {msg.role === 'user' ? 'You' : 'Hermes'}
            </div>
            <div className={styles.messageContent}>
              {msg.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {isSending && <div className={styles.empty}>Hermes is thinking…</div>}
        {error && <div className={styles.empty}>Error: {error}</div>}
      </div>
      <form
        className={styles.inputForm}
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your assistant task..."
          disabled={isSending || agent.status !== 'ready' || !hasChatTool}
          className={styles.input}
        />
        <button
          type="submit"
          disabled={isSending || !input.trim() || agent.status !== 'ready' || !hasChatTool}
          className={styles.sendButton}
        >
          {isSending ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
