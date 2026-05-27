// NewEnvModal — captures the command/cwd needed to spawn a code-space
// env via the kernel's cs_spawn command. Built on the shared `Modal`
// primitive (bao 2026-05-26): backdrop / focus-trap / esc / portal all
// live in one place, this surface owns only the form body + presets.
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
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { Button, FormField, Modal, TextInput } from './primitives';
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
}: Props): ReactElement => {
  const [command, setCommand] = useState<string>(DEFAULT_COMMAND);
  const [cwd, setCwd] = useState('');

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

  const activePreset = PRESETS.find((p) => p.command === command);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New environment"
      subtitle={
        <>
          Spawn a coding session. <strong>bash</strong> always works; other
          presets need a one-time CLI install.
        </>
      }
      maxWidth={480}
      dismissOnBackdropClick={!pending}
      dismissOnEsc={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-env-form"
            disabled={pending || command.trim().length === 0}
          >
            {pending ? 'Spawning…' : 'Spawn'}
          </Button>
        </>
      }
    >
      <form id="new-env-form" onSubmit={handleSubmit} className={styles.form}>
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
      </form>
    </Modal>
  );
};
