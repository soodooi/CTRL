// Assistant — H-2026-06-09-001 (Hermes assistant).
//
// PWA Assistant tab — Hermes MCP server.
//
// This is a simplified version of IrisyChat, adapted for Hermes' MCP server.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useOpencodeChatStream } from '@/lib/opencode-chat';
import styles from './assistant.module.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function AssistantRoute() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
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
      await invoke<void>('hermes_chat_stream', {
        args: {
          request_id,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setIsStreaming(false);
      return;
    }

    const cleanup = await (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      let unlisten: (() => void) | null = null;
      let mounted = true;

      const unlistenFn = await listen<unknown>('hermes-chat-delta', (event) => {
        if (!mounted) return;

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

        setCurrentResponse((prev) => prev + payload.delta);

        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            last.content = currentResponse + payload.delta;
          }
          return updated;
        });
      });

      unlisten = unlistenFn;

      return () => {
        mounted = false;
        unlisten?.();
      };
    })();

    return cleanup;
  };

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <h2>Hermes Assistant</h2>
            <p>
              Powered by{' '}
              <a href="https://github.com/hermes-ai/hermes" target="_blank" rel="noopener noreferrer">
                Hermes
              </a>
            </p>
            <p>
              Features: RAG, embeddings,对话能力强，知识检索
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
          placeholder="Type your assistant task..."
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