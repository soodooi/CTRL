// InstallAgentModal — one-click managed set-up for a right-region BYO engine
// (Codex / Claude Code). ADR-005 §8.8 (bao 2026-06-29: ordinary users only ever
// do a one-click install): ordinary users never install anything (hermes is the
// zero-install default), and the opt-in engines are NOT a copy-this-into-a-terminal
// hand-off. CTRL installs them into its OWN folder (~/.ctrl/agents) — no terminal,
// nothing global, no password — via a single Install button, then drives the engine
// in-chat over ACP.
//
// Built on the shared primitives/Modal shell so it inherits the app's overlay
// chrome, focus trap, and motion.

import { useState, type JSX } from 'react';
import { Button, Modal } from '../primitives';
import { useActiveAgentStore, type ByoDriver } from '@/lib/active-agent';
import styles from './InstallAgentModal.module.css';

type Phase = 'idle' | 'installing' | 'error';

// The provider whose existing CTRL key (Keychain BYOK) the engine reuses for
// sign-in, so auth is one-time and never a fresh credential dance.
function providerName(id: string): string {
  if (id === 'codex') return 'OpenAI';
  if (id === 'claude-code') return 'Anthropic';
  return 'provider';
}

export function InstallAgentModal({
  driver,
  open,
  onClose,
}: {
  driver: ByoDriver | null;
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const installAgent = useActiveAgentStore((s) => s.installAgent);
  // Read the LIVE present-state so a finished install flips this dialog to its
  // "ready" view without the caller re-rendering it.
  const live = useActiveAgentStore((s) =>
    driver ? s.drivers.find((d) => d.id === driver.id) : undefined,
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!driver) return null;
  const present = live?.present ?? driver.present;

  const runInstall = async (): Promise<void> => {
    setPhase('installing');
    setError(null);
    try {
      await installAgent(driver.id);
      // Success: loadDrivers ran inside installAgent, so `present` flips true and
      // the ready view takes over. Reset phase for a clean re-open.
      setPhase('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={460}
      title={present ? `${driver.label} is ready` : `Set up ${driver.label}`}
      subtitle={
        present
          ? `Installed in CTRL and set as Irisy's engine.`
          : `CTRL installs ${driver.label} for you — no terminal, nothing system-wide.`
      }
      footer={
        present ? (
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        ) : phase === 'installing' ? (
          <Button variant="primary" size="sm" disabled>
            Installing…
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={() => void runInstall()}>
              {phase === 'error' ? 'Retry install' : `Install ${driver.label}`}
            </Button>
          </>
        )
      }
    >
      {present ? (
        <div className={styles.ready}>
          <span className={styles.readyDot} aria-hidden="true" />
          <p className={styles.readyText}>
            <strong>{driver.label}</strong> now runs as Irisy’s engine — your next
            message here is answered by it, with your projected tools. Switch back
            to Hermes anytime.
          </p>
        </div>
      ) : (
        <>
          <section className={styles.step}>
            <p className={styles.stepLabel}>What one click does</p>
            <p className={styles.body}>
              CTRL downloads {driver.label} into its own folder (
              <code className={styles.inlineCode}>~/.ctrl</code>), brings any
              runtime it needs, and connects it to your tools through the kernel
              gate — nothing touches the rest of your system and you’re never sent
              to a terminal.
            </p>
          </section>

          <section className={styles.step}>
            <p className={styles.stepLabel}>Then</p>
            <p className={styles.body}>
              {driver.label} becomes Irisy’s engine and answers right here. If it
              needs a {providerName(driver.id)} sign-in, CTRL reuses the key you
              already configured — no second setup.
            </p>
          </section>

          {phase === 'installing' ? (
            <p className={styles.status} data-checking="true">
              <span className={styles.statusDot} aria-hidden="true" />
              Setting up {driver.label}… first install can take a minute.
            </p>
          ) : phase === 'error' ? (
            <p className={styles.status}>
              <span className={styles.statusDot} aria-hidden="true" />
              Couldn’t finish: {error}
            </p>
          ) : (
            <p className={styles.status}>
              <span className={styles.statusDot} aria-hidden="true" />
              Not installed yet — one click sets it up.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
