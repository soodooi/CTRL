// OllamaSetupBanner — Pi-first setup affordance (bao 2026-06-05).
//
// CTRL's Pi-first refactor (commit d71a65a + 43c61f6) makes Pi
// connect directly to Ollama via `~/.pi/agent/models.json`. That
// assumes the user has Ollama installed AND hermes3:8b pulled. This
// banner closes the gap end-to-end:
//
//   1. Polls `ollama_status` (Tauri command, kernel-side
//      `ollama_install::probe_now`) every 4 s.
//   2. Renders a top banner when reachability != Running OR the
//      default model is missing.
//   3. NotInstalled → "Install Ollama" button → opens
//      https://ollama.com/download in the system browser.
//   4. Installed (binary on PATH, server down) → "Open Ollama app"
//      hint — we don't try to `ollama serve` ourselves; the macOS
//      Ollama app is the user-facing entry point and auto-starts a
//      menu-bar agent.
//   5. Running + missing default model → "Download hermes3:8b
//      (~4.7 GB)" button → triggers `ollama_pull_default` Tauri
//      command and listens for `ollama-pull-progress` events to
//      render a live percentage.
//
// Banner auto-hides when reachability=Running AND has_default_model.
// No prose, one chip, one action — matches CTRL ambient hotkey
// philosophy (no wizards, no multi-step setup screens).

import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import styles from './OllamaSetupBanner.module.css';

type Reachability = 'not_installed' | 'installed' | 'running';

interface OllamaInstallStatus {
  reachability: Reachability;
  has_default_model: boolean;
  installed_models: string[];
  pull_pct: number | null;
  pull_status_line: string | null;
  last_pull_error: string | null;
  last_probe_ms: number;
}

const POLL_INTERVAL_MS = 4_000;
const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

export const OllamaSetupBanner = (): ReactElement | null => {
  const [status, setStatus] = useState<OllamaInstallStatus | null>(null);
  const [pulling, setPulling] = useState(false);

  // Pull the initial status + set up the polling loop. Pi-first only
  // matters on macOS / Linux for now (the Windows path defers Ollama
  // to a future surface); the Tauri command is still safe to call
  // anywhere — it returns NotInstalled on Windows because `which`
  // fails, and the banner just gracefully degrades to an install hint.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const s = await invoke<OllamaInstallStatus>('ollama_status');
        if (!cancelled) {
          setStatus(s);
        }
      } catch {
        // Tauri command failure — keep last known status, retry on
        // next tick. Not surfacing to the user; the polling loop
        // recovers automatically when the kernel side comes back.
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      }
    };
    void tick();

    return (): void => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, []);

  // While a pull is in flight, kernel emits `ollama-pull-progress`
  // events on every progress line — listen for live percentage
  // updates without waiting for the 4 s poll.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void (async () => {
      unlisten = await listen<OllamaInstallStatus>(
        'ollama-pull-progress',
        (event) => {
          setStatus(event.payload);
          if (event.payload.pull_pct === 100 || event.payload.has_default_model) {
            setPulling(false);
          }
        },
      );
    })();
    return (): void => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const openOllamaDownload = useCallback(() => {
    // Tauri opener plugin not bundled here — use window.open (works
    // in dev WebView and PWA). On macOS native shell this opens
    // the user's default browser.
    window.open(OLLAMA_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  }, []);

  const triggerPull = useCallback(async () => {
    setPulling(true);
    try {
      const s = await invoke<OllamaInstallStatus>('ollama_pull_default');
      setStatus(s);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ollama_pull_default failed', e);
      setPulling(false);
    }
  }, []);

  if (!status) return null;
  if (status.reachability === 'running' && status.has_default_model) {
    return null;
  }

  // Pull in progress — show percentage + descriptive line.
  if (pulling || (status.pull_pct !== null && status.pull_pct < 100)) {
    const pct = status.pull_pct ?? 0;
    return (
      <div className={styles.banner} role="status" aria-live="polite">
        <span className={styles.label}>Downloading hermes3:8b</span>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.pct}>{pct}%</span>
        {status.pull_status_line ? (
          <span className={styles.subtle}>{status.pull_status_line}</span>
        ) : null}
      </div>
    );
  }

  // Pull failed — show error + retry.
  if (status.last_pull_error) {
    return (
      <div className={styles.banner} role="alert">
        <span className={styles.label}>
          hermes3:8b download failed
        </span>
        <span className={styles.subtle}>{status.last_pull_error}</span>
        <button
          type="button"
          className={styles.action}
          onClick={() => void triggerPull()}
        >
          Retry
        </button>
      </div>
    );
  }

  // Ollama not installed — open download.
  if (status.reachability === 'not_installed') {
    return (
      <div className={styles.banner} role="status">
        <span className={styles.label}>Ollama not installed</span>
        <span className={styles.subtle}>
          Irisy needs a local LLM. Install Ollama to enable chat.
        </span>
        <button
          type="button"
          className={styles.action}
          onClick={openOllamaDownload}
        >
          Install Ollama
        </button>
      </div>
    );
  }

  // Binary installed but daemon down.
  if (status.reachability === 'installed') {
    return (
      <div className={styles.banner} role="status">
        <span className={styles.label}>Ollama is installed but not running</span>
        <span className={styles.subtle}>
          Open the Ollama app (menu bar) to start the local server.
        </span>
      </div>
    );
  }

  // Reachable, just missing the default model.
  return (
    <div className={styles.banner} role="status">
      <span className={styles.label}>hermes3:8b not installed</span>
      <span className={styles.subtle}>
        Required for Pi-native tool calling (~4.7 GB).
      </span>
      <button
        type="button"
        className={styles.action}
        onClick={() => void triggerPull()}
      >
        Download
      </button>
    </div>
  );
};
