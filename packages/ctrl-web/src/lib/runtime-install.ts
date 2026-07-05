// One-click container-runtime install (bao 2026-07-05) — the auto-run half of
// the no-docker guided install. Thin bridge to the human-only Tauri commands
// (`install_container_runtime` / `runtime_install_status`) + the live progress
// event. Desktop-only: off Tauri, `listen` throws, so the subscribe is guarded
// and the card falls back to guide-only.
import { invoke, platform } from './bridge';

export interface RuntimeInstallStatus {
  running: boolean;
  current: string | null;
  log_tail: string[];
  done: boolean;
  ok: boolean;
  error: string | null;
}

/** Kick off the platform install sequence (macOS: brew colima + colima start).
 *  Returns the initial status; live lines arrive via onRuntimeInstallProgress. */
export function installContainerRuntime(): Promise<RuntimeInstallStatus> {
  return invoke<RuntimeInstallStatus>('install_container_runtime');
}

/** Subscribe to per-line install progress. No-op (returns a noop unsubscribe)
 *  off desktop, where the Tauri event bridge is absent. */
export async function onRuntimeInstallProgress(
  cb: (s: RuntimeInstallStatus) => void,
): Promise<() => void> {
  if (platform() !== 'tauri') return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<RuntimeInstallStatus>('runtime-install-progress', (e) => {
      cb(e.payload);
    });
    return unlisten;
  } catch {
    return () => {};
  }
}
