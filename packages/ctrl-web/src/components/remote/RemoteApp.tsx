// RemoteApp — the phone-side entry when CTRL is opened via a pairing link
// (ADR-005 §2, option B). Connects to the desktop over the relay (E2E), gets the
// allowlist, and renders the allowed functions natively in the mobile shell.
// gate calls tunnel to the desktop's :17873 gate — the phone runs no kernel.
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { RemoteConnection, type RemoteAllowEntry, type RemoteState } from '@/lib/remote-connection';
import { MobileRemoteShell, type RemoteNavEntry } from './MobileRemoteShell';
import { StockCockpit, type CockpitData } from '@/components/featurepack/stock/StockCockpit';
import type { StockResult } from '@/components/featurepack/stock/StockCard';
import styles from './RemoteApp.module.css';

const rememberKey = (room: string): string => `ctrl.remote.pass.${room}`;

export function RemoteApp({ room, keyB64 }: { room: string; keyB64: string }): ReactElement {
  const [state, setState] = useState<RemoteState>('connecting');
  const [allow, setAllow] = useState<RemoteAllowEntry[]>([]);
  const [needPass, setNeedPass] = useState(false);
  const [passInput, setPassInput] = useState('');
  const connRef = useRef<RemoteConnection | null>(null);
  const passRef = useRef<string>('');

  useEffect(() => {
    let remembered: string | undefined;
    try {
      remembered = localStorage.getItem(rememberKey(room)) ?? undefined;
    } catch {
      remembered = undefined;
    }
    const conn = new RemoteConnection(
      room,
      keyB64,
      {
        onState: setState,
        onAllowlist: (entries) => {
          setAllow(entries);
          setNeedPass(false);
          // The passcode we used just worked → remember it for silent reconnect.
          try {
            const p = passRef.current;
            if (p) localStorage.setItem(rememberKey(room), p);
          } catch {
            /* best-effort */
          }
        },
        onDenied: () => setNeedPass(true),
      },
      { keepAlive: true, passcode: remembered },
    );
    passRef.current = remembered ?? '';
    connRef.current = conn;
    void conn.connect();
    return () => conn.close();
  }, [room, keyB64]);

  const submitPass = (): void => {
    const p = passInput.trim();
    if (p === '' || connRef.current == null) return;
    passRef.current = p;
    connRef.current.setPasscode(p);
    setPassInput('');
  };

  const navEntries: RemoteNavEntry[] = useMemo(
    () => allow.map((e) => ({ key: e.key, label: e.label, icon: e.icon })),
    [allow],
  );

  const renderContent = (key: string): ReactNode => {
    const conn = connRef.current;
    if (conn == null) return null;
    // Stock pack → the native cockpit, its data tunneled through the desktop gate.
    if (key === 'pack.ctrl-stock-cn') {
      const load = async (): Promise<CockpitData> => {
        const grab = (tool: string): Promise<StockResult | undefined> =>
          conn.invoke<StockResult>(tool).catch(() => undefined);
        const [mood, ladder, leaders] = await Promise.all([
          grab('market_mood'),
          grab('limit_ladder'),
          grab('leaders'),
        ]);
        return { mood, ladder, leaders };
      };
      return <StockCockpit load={load} />;
    }
    return (
      <div className={styles.soon}>
        {allow.find((e) => e.key === key)?.label ?? key} is available on the phone soon.
      </div>
    );
  };

  if (needPass && allow.length === 0) {
    return (
      <div className={styles.status}>
        <div className={styles.passTitle}>Enter the passcode</div>
        <div className={styles.statusText}>Shown on your desktop&apos;s Remote Window page.</div>
        <input
          className={styles.passInput}
          inputMode="numeric"
          autoFocus
          value={passInput}
          onChange={(e) => setPassInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitPass()}
          placeholder="6-digit code"
        />
        <button type="button" className={styles.passBtn} onClick={submitPass}>
          Connect
        </button>
      </div>
    );
  }

  if (state !== 'paired' && allow.length === 0) {
    return (
      <div className={styles.status}>
        <div className={styles.spinner} />
        <div className={styles.statusText}>
          {state === 'disconnected' ? 'Disconnected — retrying…' : 'Connecting to your desktop…'}
        </div>
      </div>
    );
  }

  return (
    <>
      {state !== 'paired' && (
        <div className={styles.banner}>Reconnecting…</div>
      )}
      <MobileRemoteShell entries={navEntries} renderContent={renderContent} />
    </>
  );
}
