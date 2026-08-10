// LocalApps — connect a local application, then read what the user selected in it.
//
// Bundled connectors are never auto-seeded: connecting one is an explicit act,
// because it bridges software the user may not have installed. Once connected,
// the unit of work is the user's own explicit selection in that application, read
// through the governed generic connector verb. CTRL never reads the whole
// document, and "nothing selected" is a recoverable state rather than an error.
// (ADR-004 cap §1 v13; ADR-002 substrate §14.12; ADR-005 irisy §12 v42 U19/U22)

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import type { DecisionFact } from '@/lib/decision-registry';
import {
  connectLocalApp,
  listLocalAppConnectors,
  localAppSelectionFacts,
  localAppUnavailableFact,
  readLocalAppSelection,
  type LocalAppConnector,
  type SelectionFact,
} from '@/lib/local-apps';
import styles from './Discover.module.css';

interface LocalAppsProps {
  /** Reuse the selection as the next turn's context. */
  onUseSelection?: (connector: LocalAppConnector, facts: SelectionFact[]) => void;
}

export function LocalApps({ onUseSelection }: LocalAppsProps): ReactElement | null {
  const [connectors, setConnectors] = useState<LocalAppConnector[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selection, setSelection] = useState<
    { connector: LocalAppConnector; facts: SelectionFact[] } | null
  >(null);
  const [decision, setDecision] = useState<{ fact: DecisionFact; connectorId: string } | null>(
    null,
  );

  const refresh = useCallback((): void => {
    void listLocalAppConnectors()
      // A reply that is not a list means nothing to offer. Trusting it blindly
      // would take the whole Library down with it.
      .then((next) => setConnectors(Array.isArray(next) ? next : []))
      // No bundled set is a real state on a stripped build, not an error to show.
      .catch(() => setConnectors([]));
  }, []);

  useEffect(refresh, [refresh]);

  const connect = async (connector: LocalAppConnector): Promise<void> => {
    setBusyId(connector.id);
    setDecision(null);
    try {
      const next = await connectLocalApp(connector.id);
      // Render the kernel's row, not an assumption that connecting worked.
      setConnectors((current) =>
        current.map((entry) => (entry.id === next.id ? next : entry)),
      );
    } catch (error) {
      setDecision({
        connectorId: connector.id,
        fact: localAppUnavailableFact(
          connector,
          error instanceof Error ? error.message : String(error),
        ),
      });
    } finally {
      setBusyId(null);
    }
  };

  const readSelection = async (connector: LocalAppConnector): Promise<void> => {
    setBusyId(connector.id);
    setDecision(null);
    setSelection(null);
    try {
      const rows = await readLocalAppSelection(connector.id);
      const facts = localAppSelectionFacts(rows);
      if (facts.length === 0) {
        // The connector distinguishes "connected but nothing selected" from a
        // failure; say so and offer the retry that actually resolves it.
        setDecision({
          connectorId: connector.id,
          fact: localAppUnavailableFact(
            connector,
            'The connector answered with no selection rows.',
          ),
        });
        return;
      }
      setSelection({ connector, facts });
    } catch (error) {
      setDecision({
        connectorId: connector.id,
        fact: localAppUnavailableFact(
          connector,
          error instanceof Error ? error.message : String(error),
        ),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (connectors.length === 0) return null;

  return (
    <section className={styles.sec} aria-label="Local apps">
      <div className={styles.secHead}>
        <span className={styles.secTitle}>Local apps</span>
      </div>

      {decision ? (
        <DecisionSurface
          fact={decision.fact}
          onResolve={(optionId) => {
            const connector = connectors.find((entry) => entry.id === decision.connectorId);
            setDecision(null);
            if (optionId === 'retry' && connector) void readSelection(connector);
          }}
        />
      ) : null}

      <div className={styles.grid}>
        {connectors.map((connector) => (
          <div key={connector.id} className={styles.card} data-connector={connector.id}>
            <div className={styles.cardTop}>
              <span className={styles.cardIc}>✦</span>
              <span className={styles.cardName}>{connector.name}</span>
            </div>
            <div className={styles.cardDesc}>{connector.summary}</div>
            <div className={styles.cardFoot}>
              <span className={styles.cardMeta}>
                {connector.requires ? `Needs ${connector.requires}` : 'Local application'}
                {' · '}
                {connector.connected ? 'Connected' : 'Not connected'}
              </span>
              {connector.connected ? (
                <button
                  type="button"
                  className={styles.cardBtn}
                  disabled={busyId === connector.id}
                  onClick={() => void readSelection(connector)}
                >
                  {busyId === connector.id ? '…' : 'Read selection'}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.cardBtn}
                  disabled={busyId === connector.id}
                  onClick={() => void connect(connector)}
                >
                  {busyId === connector.id ? '…' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selection ? (
        <div className={styles.card} data-testid="local-app-selection">
          <div className={styles.cardTop}>
            <span className={styles.cardName}>
              {selection.connector.name} — current selection
            </span>
          </div>
          <dl className={styles.selectionFacts}>
            {selection.facts.map((fact) => (
              <div key={fact.label} className={styles.selectionRow}>
                <dt className={styles.selectionLabel}>{fact.label}</dt>
                <dd className={styles.selectionValue}>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.cardFoot}>
            {onUseSelection ? (
              <button
                type="button"
                className={styles.cardBtn}
                onClick={() => onUseSelection(selection.connector, selection.facts)}
              >
                Use in this session
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
