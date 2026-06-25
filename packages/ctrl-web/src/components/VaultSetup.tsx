// VaultSetup — point CTRL at the user's own vault (e.g. their Obsidian vault).
//
// The data belongs to the user, so CTRL operates on the vault they pick rather
// than imposing ~/Documents/CTRL/ (vault.rs default is only a fallback). This
// surfaces a first-run prompt (banner) until a vault is chosen, and a settings
// row to change it later. Uses the native OS folder picker (Tauri dialog plugin).

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { vaultGetConfig, vaultSetRoot, pickVaultFolder } from '@/lib/kernel';

interface VaultSetupProps {
  /** `banner` = compact first-run prompt (hidden once configured);
   *  `settings` = always-visible row to change the vault. */
  variant?: 'banner' | 'settings';
}

export const VaultSetup = ({ variant = 'banner' }: VaultSetupProps): ReactElement | null => {
  const { data: config } = useQuery({
    queryKey: ['vault-config'],
    queryFn: vaultGetConfig,
    staleTime: Infinity,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (): Promise<void> => {
    setError(null);
    let dir: string | null = null;
    try {
      dir = await pickVaultFolder();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!dir) return;
    setBusy(true);
    try {
      await vaultSetRoot(dir);
      // Reload so every query re-reads the newly-pointed vault.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (!config) return null;
  // The banner only nags until the user has chosen a vault.
  if (variant === 'banner' && config.configured) return null;

  if (variant === 'settings') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0' }}>
        <div style={{ fontSize: 13, opacity: 0.7 }}>Vault folder</div>
        <code style={{ fontSize: 13, wordBreak: 'break-all', opacity: 0.85 }}>{config.root}</code>
        <div style={{ fontSize: 12, opacity: 0.55 }}>
          {config.configured
            ? 'CTRL operates on this folder. Point it at your Obsidian vault to keep one source of truth.'
            : 'Default fallback — choose your own (Obsidian) vault so CTRL works on your real notes.'}
        </div>
        <div>
          <button type="button" onClick={() => void choose()} disabled={busy}>
            {busy ? 'Switching…' : 'Choose vault folder…'}
          </button>
        </div>
        {error ? <div style={{ color: '#c0392b', fontSize: 12 }}>{error}</div> : null}
      </div>
    );
  }

  // banner
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        margin: '8px',
        borderRadius: 8,
        background: 'rgba(16,150,120,0.08)',
        border: '1px solid rgba(16,150,120,0.25)',
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1 }}>
        CTRL is using a default folder (<code style={{ opacity: 0.7 }}>{config.root}</code>). Point
        it at your own Obsidian vault so it works on your real notes.
      </span>
      <button type="button" onClick={() => void choose()} disabled={busy}>
        {busy ? 'Switching…' : 'Choose vault folder…'}
      </button>
      {error ? <span style={{ color: '#c0392b' }}>{error}</span> : null}
    </div>
  );
};
