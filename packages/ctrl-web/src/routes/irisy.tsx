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
import { KeycapOutputPane } from '@/components/workspace/KeycapOutputPane';
import { useKeycapOutputStore } from '@/lib/keycap-output-store';
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

// Chat mode surface (post 2026-05-29 restructure): Irisy chat is now
// SHELL-LEVEL, so the route renders only the keycap-output pane when a
// run is active. Idle visit to `/irisy` shows an empty hint — the chat
// itself is always present in the shell's Irisy column.
const IrisyRunSurface = (): React.ReactElement => {
  const hasRun = useKeycapOutputStore((s) => s.running || s.keycapId !== null);
  if (!hasRun) {
    return (
      <div className={styles.fallback}>
        <span className={styles.fallbackMuted}>
          Talk to Irisy on the right — output appears here when a keycap runs.
        </span>
      </div>
    );
  }
  return (
    <div className={styles.runOutput}>
      <KeycapOutputPane />
    </div>
  );
};

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
    return <IrisyRunSurface />;
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
    if (!manifest) {
      setToast({ kind: 'error', text: 'Manifest missing — finish creation first.' });
      return;
    }
    // C2 gate (kernel.rs install_into): non-empty server_code is rejected
    // for variants other than mcp-server because no executor runs the TS.
    // The Irisy keycap-creator persona emits TS even for builtin variants
    // — drop it here when the variant has no executor, so the install
    // succeeds with manifest-only. Pattern D (mcp-server) keeps the code.
    const manifestVariant = (manifest as { variant?: string }).variant;
    const effectiveServerCode = manifestVariant === 'mcp-server'
      ? (serverCode ?? '')
      : '';
    useKeycapCreatorStore.getState().setInstalling();
    try {
      await invoke('install_keycap', {
        args: {
          manifest,
          server_code: effectiveServerCode,
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
          <InstallBar onInstall={() => void handleInstall()} />
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
