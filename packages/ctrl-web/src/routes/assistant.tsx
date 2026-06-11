// Assistant — hermes (NousResearch) one-shot bridge.
//
// ADR-002 substrate §1.1 v20 (2026-06-10): upstream verification showed
// hermes embeds via ACP stdio (Agent Client Protocol), not MCP, and has
// no MCP `chat` tool. Until the kernel ACP streaming client lands, chat
// goes through invoke('assistant_oneshot') — `hermes -z` prints only the
// final answer; hermes memory + skills still apply. PWA owns retry.

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

export function AssistantRoute() {
  const agent = useAgent('hermes');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = agent.status === 'ready';

  const sendMessage = async () => {
    if (!input.trim() || isSending || !ready) return;

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
      // hermes one-shot takes a single prompt; hermes's own persistent
      // memory carries cross-turn context, so we send just the new turn.
      void history;
      const reply = await invoke<string>('assistant_oneshot', {
        prompt: userMessage.content,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: reply,
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
            {agent.status === 'launching' && <p>Preparing hermes…</p>}
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
        {agent.status === 'ready' && messages.length === 0 && (
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
          disabled={isSending || !ready}
          className={styles.input}
        />
        <button
          type="submit"
          disabled={isSending || !input.trim() || !ready}
          className={styles.sendButton}
        >
          {isSending ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
