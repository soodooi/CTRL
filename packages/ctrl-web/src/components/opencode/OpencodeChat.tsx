// Opencode chat — direct HTTP streaming renderer.
//
// ADR-002 substrate §1 v19 (2026-06-09, 3-agent aggregator): /coding talks
// to the opencode HTTP API directly (launch_agent → http_port endpoint);
// the kernel SSE bridge is retired. PWA owns retry (§1.3).

import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgent } from '@/lib/use-agent';
import { createOpencodeSession, streamOpencodePrompt } from '@/lib/opencode-chat';
import styles from './OpencodeChat.module.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function OpencodeChat() {
  const agent = useAgent('opencode');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const port = agent.endpoint?.kind === 'http_port' ? agent.endpoint.port : null;

  const appendToLastAssistant = (delta: string) => {
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = { ...last, content: last.content + delta };
      }
      return updated;
    });
  };

  const sendMessage = async () => {
    if (!input.trim() || isStreaming || port === null) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: `assistant-${Date.now()}`, role: 'assistant', content: '', timestamp: Date.now() },
    ]);
    setInput('');
    setIsStreaming(true);
    setError(null);

    try {
      if (!sessionIdRef.current) {
        sessionIdRef.current = await createOpencodeSession(port);
      }
      await streamOpencodePrompt(
        { port, sessionId: sessionIdRef.current, message: userMessage.content },
        {
          onDelta: appendToLastAssistant,
          onDone: () => setIsStreaming(false),
          onError: (message) => {
            setError(message);
            setIsStreaming(false);
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsStreaming(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {agent.status !== 'ready' && (
          <div className={styles.empty}>
            <h2>opencode Coding Assistant</h2>
            {agent.status === 'installing' && <p>Installing opencode…</p>}
            {agent.status === 'launching' && <p>Starting opencode…</p>}
            {agent.status === 'error' && (
              <>
                <p>opencode failed to start: {agent.error}</p>
                <button type="button" onClick={() => void agent.retry()} className={styles.sendButton}>
                  Reconnect
                </button>
              </>
            )}
          </div>
        )}
        {agent.status === 'ready' && messages.length === 0 && (
          <div className={styles.empty}>
            <h2>opencode Coding Assistant</h2>
            <p>
              Powered by{' '}
              <a href="https://opencode.ai" target="_blank" rel="noopener noreferrer">
                opencode
              </a>
            </p>
            <p>
              Features: LSP integration, formatter, symbol search, plan agent, summary
              agent
            </p>
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
              {msg.role === 'user' ? 'You' : 'opencode'}
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
          placeholder="Type your coding task..."
          disabled={isStreaming || agent.status !== 'ready'}
          className={styles.input}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim() || agent.status !== 'ready'}
          className={styles.sendButton}
        >
          {isStreaming ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
