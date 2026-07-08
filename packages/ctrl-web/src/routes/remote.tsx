// Remote Window — L1 config page (ADR-005 §2 semantic co-view, option B).
// Manages what a remotely-connected phone sees + can do: an allowlist of
// functions (built-in faces + installed packs), each toggleable visible / view
// vs act. The connection card pairs a phone to this desktop (live wiring = S3).
//
// This is the "L1 button page to configure/manage the remote phone" bao named.
// Plan: vault/ctrl/plan-remote-window.md.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { loadInstalledPacks } from '@/lib/feature-pack';
import { type FeaturePack } from '@/components/featurepack/FeaturePackScene';
import {
  loadRemoteConfig,
  saveRemoteConfig,
  permFor,
  withPerm,
  type RemoteConfig,
} from '@/lib/remote-config';
import { RemoteHost } from '@/lib/remote-host';
import { generateKeyBytes, toB64url } from '@/lib/remote-crypto';
import type { RemoteAllowEntry, RemoteState } from '@/lib/remote-connection';
import styles from './remote.module.css';

interface RemoteEntry {
  key: string;
  label: string;
  icon: string;
}

const BUILTIN_ENTRIES: RemoteEntry[] = [
  { key: 'today', label: 'Today', icon: '◉' },
  { key: 'notes', label: 'Notes', icon: '✎' },
  { key: 'tables', label: 'Tables', icon: '▦' },
  { key: 'coding', label: 'Coding', icon: '⟨⟩' },
];

export function RemoteRoute(): ReactElement {
  const [cfg, setCfg] = useState<RemoteConfig>(() => loadRemoteConfig());
  const [packs, setPacks] = useState<FeaturePack[]>([]);

  useEffect(() => {
    void loadInstalledPacks()
      .then(setPacks)
      .catch(() => {});
  }, []);

  const update = (next: RemoteConfig): void => {
    setCfg(next);
    saveRemoteConfig(next);
  };

  const entries: RemoteEntry[] = [
    ...BUILTIN_ENTRIES,
    ...packs.map((p) => ({ key: `pack.${p.id}`, label: p.name, icon: p.icon ?? '⚡' })),
  ];
  const visibleCount = entries.filter((e) => permFor(cfg, e.key).visible).length;

  // The allowlist a connected phone receives: the visible functions with their
  // labels + canAct. Read live (not captured) so toggles during a session apply
  // on the next `hello`. Deny-by-default is enforced by omission.
  const buildAllowlist = (): RemoteAllowEntry[] =>
    entries
      .filter((e) => permFor(cfg, e.key).visible)
      .map((e) => ({ key: e.key, label: e.label, icon: e.icon, canAct: permFor(cfg, e.key).canAct }));

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Remote Window</h1>
        <p className={styles.sub}>
          Open CTRL on your phone and use these functions remotely. Pick what the phone can
          see and whether it can act.
        </p>
      </header>

      <ConnectCard buildAllowlist={buildAllowlist} />

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Functions on the phone</h2>
          <span className={styles.count}>{visibleCount} shown</span>
        </div>
        <div className={styles.list}>
          {entries.map((e) => {
            const perm = permFor(cfg, e.key);
            return (
              <div key={e.key} className={styles.row} data-off={!perm.visible || undefined}>
                <span className={styles.icon}>{e.icon}</span>
                <span className={styles.label}>{e.label}</span>
                <div className={styles.controls}>
                  <div className={styles.seg} role="radiogroup" aria-label={`${e.label} access`}>
                    <button
                      type="button"
                      className={styles.segBtn}
                      data-active={perm.visible && !perm.canAct || undefined}
                      disabled={!perm.visible}
                      onClick={() => update(withPerm(cfg, e.key, { canAct: false }))}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className={styles.segBtn}
                      data-active={perm.visible && perm.canAct || undefined}
                      disabled={!perm.visible}
                      onClick={() => update(withPerm(cfg, e.key, { canAct: true }))}
                    >
                      Act
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.toggle}
                    role="switch"
                    aria-checked={perm.visible}
                    data-on={perm.visible || undefined}
                    onClick={() => update(withPerm(cfg, e.key, { visible: !perm.visible }))}
                    title={perm.visible ? 'Shown on phone' : 'Hidden'}
                  >
                    <span className={styles.knob} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// Connection card — starts a session: the desktop dials the relay room (0 open
// ports) and serves the allowlist over an E2E channel; the phone joins via the
// connect URL (room in the query, key in the fragment so it never hits a server
// log). Reachable once the relay is deployed; the local host wiring is live.
interface Session {
  url: string;
  host: RemoteHost;
}

function ConnectCard({ buildAllowlist }: { buildAllowlist: () => RemoteAllowEntry[] }): ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<RemoteState>('disconnected');
  const [copied, setCopied] = useState(false);
  const allowRef = useRef(buildAllowlist);
  allowRef.current = buildAllowlist;

  const start = (): void => {
    const room = toB64url(crypto.getRandomValues(new Uint8Array(12)));
    const keyB64 = toB64url(generateKeyBytes());
    const url = `${window.location.origin}/?remote=${room}#k=${keyB64}`;
    const host = new RemoteHost(
      room,
      keyB64,
      () => Promise.resolve(allowRef.current()),
      { onState: setState },
    );
    void host.start();
    setSession({ url, host });
  };

  const stop = (): void => {
    session?.host.stop();
    setSession(null);
    setState('disconnected');
  };

  const copy = (): void => {
    if (session == null) return;
    void navigator.clipboard?.writeText(session.url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const dotState = state === 'paired' ? 'live' : 'idle';
  const title =
    session == null
      ? 'No phone connected'
      : state === 'paired'
        ? 'Session live — open the link on your phone'
        : 'Waiting for the relay…';

  return (
    <section className={styles.connect}>
      <div className={styles.connectMain}>
        <div className={styles.statusDot} data-state={dotState} />
        <div>
          <div className={styles.connectTitle}>{title}</div>
          {session == null ? (
            <div className={styles.connectHint}>
              Start a session to get a one-time link. Open it on your phone — you&apos;ll see the
              functions you allowed above. The link&apos;s key stays end-to-end; the relay never
              reads your data.
            </div>
          ) : (
            <button type="button" className={styles.connectUrl} onClick={copy} title="Copy link">
              {copied ? 'Copied' : session.url}
            </button>
          )}
        </div>
      </div>
      {session == null ? (
        <button type="button" className={styles.connectBtn} onClick={start}>
          Start session
        </button>
      ) : (
        <button type="button" className={styles.connectBtn} data-stop onClick={stop}>
          End session
        </button>
      )}
    </section>
  );
}
