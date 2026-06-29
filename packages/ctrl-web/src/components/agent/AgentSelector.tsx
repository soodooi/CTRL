// AgentSelector — the unified, reusable agent ("shell") picker.
//
// ADR-005 irisy §8.6 (unified terminal-essence frontend): every interaction
// surface is a terminal-essence session whose "shell" is a SELECTABLE agent.
// This is that selector — ONE component, backed by the ONE shared `active-agent`
// store, dropped into every surface so the agent axis is consistent everywhere
// (no bespoke per-surface picker). Switching the agent never resets the
// conversation, persona, or feature packs (orthogonal axes — §8.6).
//
// This is the RIGHT-region Irisy-engine picker (ADR-005 §8.7): hermes (the
// zero-install default) / Codex / Claude Code. Whichever is active, CTRL DRIVES
// it as Irisy's brain over ACP and it answers in-surface — a BYO engine is not a
// terminal hand-off. Picking a not-installed engine opens the one-click managed
// install (§8.8), so the choice is always actionable, never a dead end.

import { useState, type JSX } from 'react';
import { useByoDrivers, isUsable, type ByoDriver } from '@/lib/active-agent';
import { InstallAgentModal } from './InstallAgentModal';
import styles from './AgentSelector.module.css';

export function AgentSelector({
  showNote = true,
}: {
  /** Render the "external driver" hand-off note when a BYO-CLI agent is active. */
  showNote?: boolean;
}): JSX.Element {
  const { drivers, activeId, active, setActive } = useByoDrivers();
  const [open, setOpen] = useState(false);
  // A not-installed BYO-CLI driver opens the set-up dialog instead of
  // dead-ending with a one-line note (bao 2026-06-28).
  const [installFor, setInstallFor] = useState<ByoDriver | null>(null);

  return (
    <span className={styles.wrap}>
      <span className={styles.switch}>
        <button
          type="button"
          className={styles.chip}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title={active.detail}
        >
          {/* Solid dot = engine ready to answer; hollow = needs setup or an account. */}
          <span className={styles.dot} data-on={isUsable(active)} />
          <span className={styles.label}>{active.label}</span>
          <span className={styles.caret}>▾</span>
        </button>
        {open && (
          <>
            <div className={styles.backdrop} onClick={() => setOpen(false)} />
            <div className={styles.menu} role="menu">
              {drivers.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={a.id === activeId}
                  className={`${styles.item} ${a.id === activeId ? styles.itemActive : ''}`}
                  onClick={() => {
                    // Any engine is selectable; picking one that isn't installed
                    // yet opens the one-click set-up so it's actionable.
                    setActive(a.id);
                    setOpen(false);
                    if (a.kind === 'byo-cli' && !a.present) setInstallFor(a);
                  }}
                >
                  <span className={styles.itemLabel}>{a.label}</span>
                  <span className={styles.itemHint}>{a.detail}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </span>
      {showNote &&
        active.kind === 'byo-cli' &&
        !isUsable(active) &&
        (!active.present ? (
          <button type="button" className={styles.setup} onClick={() => setInstallFor(active)}>
            Set up {active.label} →
          </button>
        ) : (
          // Installed but CTRL has no account for it — be honest: it can't use the
          // current (e.g. Volc) provider; one tap back to Hermes, which can.
          <span className={styles.byoNote}>
            {active.label} needs {active.id === 'codex' ? 'an OpenAI' : 'an Anthropic'} account —
            it can’t use your current provider.{' '}
            <button type="button" className={styles.setup} onClick={() => setActive('hermes')}>
              Use Hermes
            </button>
          </span>
        ))}
      <InstallAgentModal
        driver={installFor}
        open={installFor !== null}
        onClose={() => setInstallFor(null)}
      />
    </span>
  );
}
