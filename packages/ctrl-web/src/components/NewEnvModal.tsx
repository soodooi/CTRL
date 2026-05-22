// NewEnvModal — captures the command/cwd needed to spawn a code-space
// env via the kernel's cs_spawn command. Modal pattern, no portal: the
// route mounts an overlay div when open and the form submits the spawn.
//
// Presets:
//   - bash       — always available on macOS / Linux; default selection.
//   - claude-code — requires `npm install -g @anthropic-ai/claude-code`.
//   - aider      — requires `pip install aider-chat`.
// The "needs install" presets surface their install command underneath
// so a user who picks one knows what to run if cs_spawn returns 127.

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { Button, FormField, TextInput } from './primitives';
import { cx } from './primitives/cx';
import type { CsSpawnArgs } from '@/lib/kernel';
import styles from './NewEnvModal.module.css';

interface Preset {
  label: string;
  command: string;
  install?: { hint: string; cmd: string };
}

const PRESETS: ReadonlyArray<Preset> = [
  { label: 'bash', command: 'bash' },
  {
    label: 'claude-code',
    command: 'claude',
    install: {
      hint: 'Requires Claude Code CLI on $PATH.',
      cmd: 'npm install -g @anthropic-ai/claude-code',
    },
  },
  {
    label: 'aider',
    command: 'aider',
    install: {
      hint: 'Requires aider on $PATH (Python).',
      cmd: 'pip install aider-chat',
    },
  },
];

const DEFAULT_COMMAND = PRESETS[0]?.command ?? 'bash';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the form values; the route owns the cs_spawn invoke. */
  onSubmit: (values: CsSpawnArgs) => Promise<void> | void;
  /** Submit-in-flight flag from the caller's mutation; disables the form. */
  pending?: boolean;
  /** Surface backend errors inline. */
  error?: string | null;
}

export const NewEnvModal = ({
  open,
  onClose,
  onSubmit,
  pending = false,
  error,
}: Props): ReactElement | null => {
  const [command, setCommand] = useState<string>(DEFAULT_COMMAND);
  const [cwd, setCwd] = useState('');
  const titleId = useId();

  // Esc to close — bound only while open so the listener doesn't sit
  // permanently on document. Gated on `pending` so the user can't
  // dismiss the modal mid-spawn (matches the Cancel button's
  // disabled-while-pending behaviour).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, pending]);

  // Reset the form whenever the modal closes so the next open starts
  // with bash pre-selected (the only preset that always works).
  useEffect(() => {
    if (!open) {
      setCommand(DEFAULT_COMMAND);
      setCwd('');
    }
  }, [open]);

  const handlePreset = useCallback((preset: string): void => {
    setCommand(preset);
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent): void => {
      e.preventDefault();
      const trimmed = command.trim();
      if (!trimmed) return;
      const payload: CsSpawnArgs = { command: trimmed };
      const trimmedCwd = cwd.trim();
      if (trimmedCwd) payload.cwd = trimmedCwd;
      void onSubmit(payload);
    },
    [command, cwd, onSubmit],
  );

  if (!open) return null;

  const activePreset = PRESETS.find((p) => p.command === command);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>New environment</h2>
          <p className={styles.subtitle}>
            Spawn a coding session. <strong>bash</strong> always works; other
            presets need a one-time CLI install.
          </p>
        </header>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.presets} role="group" aria-label="Command presets">
            {PRESETS.map((p) => (
              <button
                key={p.command}
                type="button"
                className={cx(styles.preset, command === p.command && styles.presetActive)}
                onClick={() => handlePreset(p.command)}
                disabled={pending}
                title={p.install ? p.install.hint : undefined}
              >
                {p.label}
                {p.install && <span className={styles.presetTag}>needs install</span>}
              </button>
            ))}
          </div>

          {activePreset?.install && (
            <div className={styles.installHint} role="note">
              <span>{activePreset.install.hint}</span>
              <code className={styles.installCmd}>{activePreset.install.cmd}</code>
            </div>
          )}

          <FormField label="Command" hint="The program to spawn, e.g. bash, aider, claude.">
            <TextInput
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="bash"
              autoFocus
              disabled={pending}
              required
            />
          </FormField>

          <FormField label="Working directory" hint="Optional — defaults to the kernel's working dir.">
            <TextInput
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/Users/you/code/project"
              disabled={pending}
            />
          </FormField>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <footer className={styles.footer}>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || command.trim().length === 0}>
              {pending ? 'Spawning…' : 'Spawn'}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
};
