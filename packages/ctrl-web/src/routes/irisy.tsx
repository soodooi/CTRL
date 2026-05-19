// [H-2026-05-18-001] Irisy route — mode-aware.
//
// `?intent=create-keycap[&prefill=<base64 utf-8>]` → keycap-creator shell
// (the lane-B deliverable: chat + manifest preview + code preview +
// install gate).
//
// Any other URL → minimal placeholder. The general-purpose Irisy chat
// from Athena's `feat/athena-irisy-v0.2` branch is not in scope here;
// when it merges, this fall-through becomes the entry point.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreatorShell } from '@/components/irisy/CreatorShell';
import { ChatPane } from '@/components/irisy/ChatPane';
import { ManifestPreview } from '@/components/irisy/ManifestPreview';
import { CodePreview } from '@/components/irisy/CodePreview';
import { InstallBar } from '@/components/irisy/InstallBar';
import { DiscardConfirm } from '@/components/irisy/DiscardConfirm';
import { useKeycapCreatorStore } from '@/lib/irisy-keycap-store';
import { defaultTransport } from '@/lib/llm-transport';
import { runChatTurn } from '@/lib/irisy-llm-runner';
import {
  IRISY_KEYCAP_CREATOR_FEW_SHOTS,
  IRISY_KEYCAP_CREATOR_PROMPT,
} from '@/personas/irisy/keycap-creator';
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import { invoke } from '@/lib/bridge';
import styles from './irisy.module.css';

type IrisyMode = 'create-keycap' | 'chat';

function decodePrefill(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const bin = atob(raw);
    return decodeURIComponent(
      bin
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
  } catch {
    return null;
  }
}

function readUrlParams(): { mode: IrisyMode; prefill: string | null } {
  if (typeof window === 'undefined') return { mode: 'chat', prefill: null };
  const params = new URLSearchParams(window.location.search);
  const intent = params.get('intent');
  const prefill = decodePrefill(params.get('prefill'));
  return {
    mode: intent === 'create-keycap' ? 'create-keycap' : 'chat',
    prefill,
  };
}

// Z2 (install_keycap Tauri command) ships tomorrow per zeus. Until then
// the Install button stays greyed with a tooltip. Flip this flag once
// the command is registered.
const BACKEND_INSTALL_READY = true;

export const IrisyRoute = (): React.ReactElement => {
  const { mode, prefill } = useMemo(readUrlParams, []);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const transportRef = useRef(defaultTransport());
  const queryClient = useQueryClient();

  const setInstalledIds = useKeycapCreatorStore((s) => s.setInstalledIds);
  const hydratePrefill = useKeycapCreatorStore((s) => s.hydratePrefill);
  const discard = useKeycapCreatorStore((s) => s.discard);
  const phase = useKeycapCreatorStore((s) => s.phase);

  const keycapsQuery = useQuery<KeycapSummary[]>({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
    enabled: mode === 'create-keycap',
  });

  useEffect(() => {
    if (mode !== 'create-keycap') return;
    if (prefill !== null) hydratePrefill(prefill);
    // hydratePrefill only fires once per mount; deps intentionally narrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!keycapsQuery.data) return;
    setInstalledIds(keycapsQuery.data.map((k) => k.id));
  }, [keycapsQuery.data, setInstalledIds]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (mode !== 'create-keycap') {
    return (
      <div className={styles.fallback}>
        <p>Open Irisy with <code>?intent=create-keycap</code> to start building a keycap.</p>
        <p className={styles.fallbackMuted}>
          The general-purpose Irisy chat ships from a sibling lane.
        </p>
      </div>
    );
  }

  const handleSubmit = async (text: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await runChatTurn({
        transport: transportRef.current,
        systemPrompt: IRISY_KEYCAP_CREATOR_PROMPT,
        fewShots: IRISY_KEYCAP_CREATOR_FEW_SHOTS,
        userText: text,
      });
    } finally {
      setBusy(false);
      // Clear field-pending after each completed turn so a stale pending
      // marker doesn't survive a successful patch round-trip.
      useKeycapCreatorStore.getState().setFieldPending(null);
    }
  };

  const handleInstall = async (): Promise<void> => {
    const state = useKeycapCreatorStore.getState();
    const manifest = state.validated;
    const serverCode = state.serverTs;
    if (!manifest || !serverCode) {
      setToast({ kind: 'error', text: 'Manifest or server code missing — finish creation first.' });
      return;
    }
    useKeycapCreatorStore.getState().setInstalling();
    try {
      await invoke('install_keycap', {
        args: {
          manifest,
          server_code: serverCode,
          server_code_filename: 'server.ts',
        },
      });
      useKeycapCreatorStore.getState().setInstalled();
      setToast({ kind: 'success', text: `Installed ${manifest.name} · keyboard refreshed` });
      queryClient.invalidateQueries({ queryKey: ['keycaps'] });
    } catch (e: unknown) {
      useKeycapCreatorStore.getState().setInstallFailed();
      const message = e instanceof Error ? e.message : 'install_keycap failed';
      setToast({ kind: 'error', text: message });
    }
  };

  const handleDiscardConfirm = (): void => {
    discard();
    setDiscardOpen(false);
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/irisy');
    }
  };

  return (
    <>
      <CreatorShell
        header={
          <>
            <span>Irisy &middot; Creating keycap</span>
            <button
              type="button"
              className={styles.discardButton}
              onClick={() => setDiscardOpen(true)}
              aria-label="Discard and restart"
            >
              Discard &amp; restart
            </button>
          </>
        }
        chat={<ChatPane onSubmit={(t) => void handleSubmit(t)} busy={busy} />}
        manifest={<ManifestPreview />}
        code={<CodePreview />}
        bar={
          <InstallBar
            backendReady={BACKEND_INSTALL_READY}
            onInstall={() => void handleInstall()}
          />
        }
      />
      <DiscardConfirm
        open={discardOpen}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={handleDiscardConfirm}
      />
      {toast && (
        <div
          className={`${styles.toast} ${toast.kind === 'success' ? styles.toastOk : styles.toastErr}`}
          role="status"
        >
          {toast.text}
        </div>
      )}
      {phase === 'installed' && (
        <div className={`${styles.toast} ${styles.toastOk}`} role="status">
          Installed &middot; Try it now &rarr;
        </div>
      )}
    </>
  );
};
