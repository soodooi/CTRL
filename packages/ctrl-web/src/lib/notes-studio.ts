// Notes Studio launcher (ADR-002 §1.9 v47 F3) — opens the vendored notes UI
// (packages/ctrl-notes-ui, built to /notes-ui/ inside this origin) in its own
// Tauri WebviewWindow. Same-origin keeps full IPC (the adapter commands in
// commands/notes_ui.rs); a separate window gives absolute style isolation
// from the PWA (its tailwind preflight never touches ctrl-web) and keeps
// upstream cherry-picks untouched.

const LABEL = 'notes-studio';

/** Open (or focus) the Notes Studio window. Desktop only — browser PWA
 *  falls back to opening the sub-app in a new tab (degraded: no Tauri IPC,
 *  upstream's mock layer takes over). */
export async function openNotesStudio(): Promise<void> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel(LABEL);
    if (existing) {
      await existing.setFocus();
      return;
    }
    const win = new WebviewWindow(LABEL, {
      url: 'notes-ui/index.html',
      title: 'CTRL Notes',
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
    });
    // Surface creation errors (missing bundle etc.) in the console rather
    // than failing silently.
    void win.once('tauri://error', (e) => {
      console.error('notes-studio window failed', e);
    });
  } catch {
    // Not running under Tauri: open the built sub-app in a browser tab.
    window.open('/notes-ui/index.html', '_blank', 'noopener');
  }
}
