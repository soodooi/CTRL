import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type HotkeyEvent = {
  kind: 'single-ctrl';
  captured_text: string | null;
  cursor_x: number;
  cursor_y: number;
  latency_ms: number;
};

export function subscribeHotkey(
  handler: (evt: HotkeyEvent) => void,
): Promise<UnlistenFn> {
  return listen<HotkeyEvent>('hotkey', (e) => handler(e.payload));
}
