import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { runChat, type ChatMessage } from '../lib/chat';
import { playSound } from '../lib/sound';

interface ChatWorkspaceProps {
  toolName: string;
  initialReply: string;
  /** Optional pre-context (e.g. "[原始任务: 总结剪贴板内容]") shown as a system note. */
  contextHint?: string;
  onClose: () => void;
  onCopyReply: (text: string) => void;
  onHoverChange: (hovered: boolean) => void;
}

export function ChatWorkspace({
  toolName,
  initialReply,
  contextHint,
  onClose,
  onCopyReply,
  onHoverChange,
}: ChatWorkspaceProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: 'assistant', content: initialReply },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to latest message after every update
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Initial focus on input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    setError(null);
    try {
      const reply = await runChat(next);
      const trimmed = reply.trim();
      if (trimmed) {
        setMessages([...next, { role: 'assistant', content: trimmed }]);
        playSound('success-ai');
      } else {
        setError('助手没有给出回复,请换个说法重试。');
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(raw);
      playSound('error');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, messages, sending]);

  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Enter to send · Shift+Enter for newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  return (
    <section
      className="panel panel-workspace panel-chat workspace-success"
      data-stagger="2"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <header className="panel-header">
        <span className="panel-title-group">
          <span className="workspace-mark workspace-mark-success" aria-hidden>
            ✓
          </span>
          <span className="panel-title">{toolName}</span>
          <span className="chat-badge mono" aria-label="对话模式">
            CHAT
          </span>
        </span>
        <button
          type="button"
          className="panel-close"
          aria-label="关闭 (Esc)"
          title="Esc 关闭"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      {contextHint && <div className="chat-context mono">{contextHint}</div>}

      <div className="chat-messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <ChatBubble
            key={i}
            role={m.role}
            content={m.content}
            onCopy={m.role === 'assistant' ? () => onCopyReply(m.content) : undefined}
          />
        ))}
        {sending && (
          <div className="chat-bubble chat-bubble-assistant chat-bubble-pending">
            <div className="chat-typing" aria-label="助手思考中">
              <span /><span /><span />
            </div>
          </div>
        )}
        {error && (
          <div className="chat-bubble chat-bubble-error">
            <div className="chat-bubble-content">{error}</div>
          </div>
        )}
      </div>

      <footer className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="追问 · Enter 发送 · Shift+Enter 换行"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
          rows={1}
          disabled={sending}
        />
        <button
          type="button"
          className="action-btn primary chat-send"
          onClick={() => void send()}
          disabled={sending || !input.trim()}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </footer>
    </section>
  );
}

interface ChatBubbleProps {
  role: ChatRole;
  content: string;
  onCopy?: () => void;
}

type ChatRole = 'user' | 'assistant';

function ChatBubble({ role, content, onCopy }: ChatBubbleProps): JSX.Element {
  return (
    <div className={`chat-bubble chat-bubble-${role}`}>
      <div className="chat-bubble-content">{content}</div>
      {onCopy && (
        <button
          type="button"
          className="chat-bubble-copy"
          onClick={onCopy}
          aria-label="复制这条回复"
          title="复制"
        >
          复制
        </button>
      )}
    </div>
  );
}
