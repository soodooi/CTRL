// Opencode chat — simplified streaming renderer.
//
// H-2026-06-09-001 — opencode (coding) + Hermes (assistant) as peer agent processes.
//
// This is a simplified version of IrisyChat, adapted for opencode's HTTP API.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './OpencodeChat.module.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function OpencodeChat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Create assistant message placeholder
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    setIsStreaming(true);
    setCurrentResponse('');
    setError(null);

    const request_id = `req-${Date.now()}`;

    try {
      await invoke<void>('opencode_chat_stream', {
        args: {
          request_id,
          session_id: sessionId,
          message: userMessage.content,
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setIsStreaming(false);
      return;
    }

    // Listen for opencode-chat-delta events
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');

      const unlisten = await listen<unknown>('opencode-chat-delta', (event) => {
        const payload = event.payload as {
          request_id: string;
          delta: string;
          done: boolean;
          error?: string;
        };

        if (payload.request_id !== request_id) {
          return;
        }

        if (payload.done) {
          setIsStreaming(false);
          // Update the last assistant message with the final content
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              last.content = currentResponse;
            }
            return updated;
          });
          setCurrentResponse('');
          return;
        }

        if (payload.error) {
          setIsStreaming(false);
          setCurrentResponse(`Error: ${payload.error}`);
          return;
        }

        // Accumulate delta
        setCurrentResponse((prev) => prev + payload.delta);

        // Update the assistant message in real-time
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            last.content = currentResponse + payload.delta;
          }
          return updated;
        });
      });

      return unlisten;
    };

    let cleanup: (() => void) | null = null;
    setupListener().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  };

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.length === 0 && (
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
      </div>
      <form
        className={styles.inputForm}
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your coding task..."
          disabled={isStreaming}
          className={styles.input}
        />
        <button type="submit" disabled={isStreaming || !input.trim()} className={styles.sendButton}>
          {isStreaming ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}