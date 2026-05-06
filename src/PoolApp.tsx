// Pool window root — the search + tool-list chiclet to the left of the
// keyboard. Receives `tools:state` broadcasts from the keyboard window;
// emits `pool:run` / `pool:pin-toggle` / `pool:close` on user actions.
//
// No tool-execution or chord logic lives here — it's a pure view + event
// emitter. Keyboard window owns all that state.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isAiTool, type Tool } from './lib/tools';
import { matchesTool } from './lib/search';
import { ToolIcon } from './components/ToolIcon';
import {
  EV_POOL_CLOSE,
  EV_POOL_PIN_TOGGLE,
  EV_POOL_RUN,
  EV_TOOLS_STATE,
  emitToKeyboard,
  listenTyped,
  type PoolPinTogglePayload,
  type PoolRunPayload,
  type ToolsStatePayload,
} from './lib/window-events';

export function PoolApp(): JSX.Element {
  const [poolTools, setPoolTools] = useState<Tool[]>([]);
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(() => new Set());
  const [chordCandidates, setChordCandidates] = useState<Set<string> | null>(null);
  const [aiReady, setAiReady] = useState(true);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unlistenPromise = listenTyped<ToolsStatePayload>(EV_TOOLS_STATE, (payload) => {
      setPoolTools(payload.poolTools);
      setSuggestedIds(new Set(payload.suggestedToolIds));
      setChordCandidates(
        payload.chordCandidateIds ? new Set(payload.chordCandidateIds) : null,
      );
      setAiReady(payload.aiReady);
    });
    return () => {
      void unlistenPromise.then((u) => u());
    };
  }, []);

  // Esc inside pool: close pool. Cmd+K focuses the search input from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (query) {
          setQuery('');
          return;
        }
        void emitToKeyboard(EV_POOL_CLOSE);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = inputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query]);

  // Hide-all-panels when focus leaves the entire app (sibling-window aware).
  useEffect(() => {
    let pending = 0;
    function onBlur(): void {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        void invoke('hide_if_unfocused').catch(() => undefined);
      }, 80);
    }
    function onFocus(): void {
      window.clearTimeout(pending);
    }
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(pending);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const filteredPoolTools = useMemo(() => {
    if (!query.trim()) return poolTools;
    return poolTools.filter((t) => matchesTool(t, query));
  }, [poolTools, query]);

  function runTool(tool: Tool): void {
    const action = tool.actions[0];
    if (!action) return;
    const payload: PoolRunPayload = { toolId: tool.id, actionId: action.id };
    void emitToKeyboard(EV_POOL_RUN, payload);
  }

  function pinTool(toolId: string): void {
    const payload: PoolPinTogglePayload = { toolId };
    void emitToKeyboard(EV_POOL_PIN_TOGGLE, payload);
  }

  return (
    <aside className="panel panel-pool window-fill" data-stagger="0">
      <header className="panel-header" data-tauri-drag-region>
        <span className="panel-title-group">
          <span className="panel-title">仓库</span>
        </span>
        <span className="panel-counter mono">{filteredPoolTools.length}</span>
      </header>
      <div className="pool-search">
        <input
          ref={inputRef}
          type="text"
          placeholder="搜工具 / 标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim() && filteredPoolTools.length > 0) {
              e.preventDefault();
              const first = filteredPoolTools[0];
              if (first) runTool(first);
            }
          }}
        />
        <span className="pool-search-hint mono" aria-hidden>⌘K</span>
      </div>
      <ul className="pool-list">
        {filteredPoolTools.map((t) => {
          const chordState: 'match' | 'dim' | 'idle' = chordCandidates
            ? chordCandidates.has(t.id)
              ? 'match'
              : 'dim'
            : 'idle';
          const isSuggested = chordCandidates === null && suggestedIds.has(t.id);
          const needsConfig = chordCandidates === null && isAiTool(t) && !aiReady;
          return (
            <PoolItem
              key={t.id}
              tool={t}
              chordState={chordState}
              isSuggested={isSuggested}
              needsConfig={needsConfig}
              onRun={() => runTool(t)}
              onPin={() => pinTool(t.id)}
            />
          );
        })}
        {filteredPoolTools.length === 0 && (
          <li className="pool-empty">
            {query ? `没找到「${query}」` : '所有工具都在键盘上了'}
          </li>
        )}
      </ul>
    </aside>
  );
}

interface PoolItemProps {
  tool: Tool;
  chordState: 'match' | 'dim' | 'idle';
  isSuggested: boolean;
  needsConfig: boolean;
  onRun: () => void;
  onPin: () => void;
}

function PoolItem({
  tool,
  chordState,
  isSuggested,
  needsConfig,
  onRun,
  onPin,
}: PoolItemProps): JSX.Element {
  function handlePinClick(e: ReactMouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    onPin();
  }

  const classes = [
    'mini-key',
    chordState === 'match' && 'is-chord-match',
    chordState === 'dim' && 'is-chord-dim',
    isSuggested && 'is-suggested',
    needsConfig && 'is-needs-config',
  ]
    .filter(Boolean)
    .join(' ');

  const titleSuffix = tool.chord ? ` · 双键 ${tool.chord}` : '';
  const suggestSuffix = isSuggested ? ' · 剪贴板内容相关' : '';
  const needsConfigSuffix = needsConfig ? ' · 需要先配置 LLM' : '';

  return (
    <li
      className={classes}
      role="button"
      tabIndex={0}
      title={`${tool.name} · ${tool.description.short}${titleSuffix}${suggestSuffix}${needsConfigSuffix}`}
      onClick={onRun}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRun();
        }
      }}
    >
      <span className="mini-key-icon">
        <ToolIcon name={tool.icon} size={14} />
      </span>
      <span className="mini-key-name">{tool.name}</span>
      {tool.chord && (
        <span className="mini-key-chord mono" aria-hidden>{tool.chord}</span>
      )}
      <button
        type="button"
        className="mini-key-pin"
        onClick={handlePinClick}
        aria-label="装到键盘"
        title="装到键盘"
        tabIndex={-1}
      >
        +
      </button>
    </li>
  );
}

