// SourcesPanel — find something in your own content, and look something up outside it.
//
// This is the data-supply surface (bao 2026-08-05: 数据来源得要有一个数据供给).
// It serves three intents that were all unserved for the same reason: nothing
// showed the user where an answer came from. Searching your notes cites each
// passage to its note and opens it; an external lookup is a separate, explicit
// act that names the provider that answered.
//
// Two rules are structural here, not stylistic:
//   - A passage is never rendered without the note it came from.
//   - Typing and searching locally never sends a network request. Leaving the
//     machine takes a second, deliberate click.
// (ADR-002 substrate §1.9 v46; ADR-005 irisy §12 v42 U3/U4/U7)

import { useCallback, useState, type ReactElement } from 'react';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import { unavailableFact, type DecisionFact } from '@/lib/decision-registry';
import {
  hitResourceRef,
  lookupExternal,
  searchLocalKnowledge,
  sourceHost,
  type ExternalLookup,
  type LocalHit,
} from '@/lib/sources';
import styles from './SourcesPanel.module.css';

interface SourcesPanelProps {
  /** Open a local hit as the session's Work Resource. */
  onOpen?: (resourceRef: string) => void;
}

export function SourcesPanel({ onOpen }: SourcesPanelProps): ReactElement {
  const [query, setQuery] = useState('');
  const [local, setLocal] = useState<LocalHit[] | null>(null);
  const [external, setExternal] = useState<ExternalLookup | null>(null);
  const [busy, setBusy] = useState<'local' | 'external' | null>(null);
  const [decision, setDecision] = useState<DecisionFact | null>(null);

  const fail = useCallback((subject: string, error: unknown): void => {
    setDecision(
      unavailableFact({
        id: 'sources',
        subject,
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
      }),
    );
  }, []);

  const searchLocal = async (): Promise<void> => {
    if (query.trim().length === 0) return;
    setBusy('local');
    setDecision(null);
    // A new local search does not clear a previous lookup silently; it replaces
    // only what it is responsible for.
    try {
      setLocal(await searchLocalKnowledge(query));
    } catch (error) {
      setLocal(null);
      fail('Your notes could not be searched.', error);
    } finally {
      setBusy(null);
    }
  };

  const lookUp = async (): Promise<void> => {
    if (query.trim().length === 0) return;
    setBusy('external');
    setDecision(null);
    try {
      setExternal(await lookupExternal(query));
    } catch (error) {
      setExternal(null);
      fail('That lookup could not be completed.', error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.root} aria-label="Sources">
      <form
        className={styles.bar}
        onSubmit={(event) => {
          event.preventDefault();
          void searchLocal();
        }}
      >
        <input
          className={styles.input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your notes…"
          aria-label="Search your notes"
          spellCheck={false}
        />
        <button
          type="submit"
          className={styles.action}
          disabled={busy !== null || query.trim().length === 0}
        >
          {busy === 'local' ? '…' : 'Search notes'}
        </button>
        {/* Deliberately separate: this one leaves the machine. */}
        <button
          type="button"
          className={styles.action}
          disabled={busy !== null || query.trim().length === 0}
          onClick={() => void lookUp()}
          title="Sends this query to a web search provider"
        >
          {busy === 'external' ? '…' : 'Look up on the web'}
        </button>
      </form>

      {decision ? (
        <DecisionSurface
          fact={decision}
          onResolve={(optionId) => {
            setDecision(null);
            if (optionId === 'retry') void searchLocal();
          }}
        />
      ) : null}

      {local ? (
        <div className={styles.group} data-testid="sources-local">
          <div className={styles.groupTitle}>From your notes</div>
          {local.length === 0 ? (
            <p className={styles.empty}>Nothing in your notes matches that.</p>
          ) : (
            <ul className={styles.list}>
              {local.map((hit) => (
                <li key={hit.path} className={styles.hit}>
                  <button
                    type="button"
                    className={styles.hitPath}
                    disabled={onOpen == null}
                    onClick={() => onOpen?.(hitResourceRef(hit))}
                  >
                    {hit.path}
                  </button>
                  {/* The passage always sits under its source, never alone. */}
                  {hit.context ? (
                    <p className={styles.passage}>{hit.context}</p>
                  ) : (
                    <p className={styles.noPassage}>
                      Matched this note; no passage was returned.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {external ? (
        <div className={styles.group} data-testid="sources-external">
          <div className={styles.groupTitle}>
            From the web · answered by {external.provider}
          </div>
          {external.note ? <p className={styles.note}>{external.note}</p> : null}
          {external.results.length === 0 ? (
            <p className={styles.empty}>That lookup returned nothing.</p>
          ) : (
            <ul className={styles.list}>
              {external.results.map((result) => (
                <li key={result.url} className={styles.hit}>
                  <a
                    className={styles.hitPath}
                    href={result.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {result.title}
                  </a>
                  <span className={styles.host}>{sourceHost(result.url)}</span>
                  {result.snippet ? (
                    <p className={styles.passage}>{result.snippet}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
