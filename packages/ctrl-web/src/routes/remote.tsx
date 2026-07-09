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
import { deriveSession, loadAccount, DEV_ACCOUNT } from '@/lib/remote-account';
import { type RemoteAllowEntry, type RemoteState } from '@/lib/remote-connection';
import { MobileLocalPreview } from '@/components/remote/MobileLocalPreview';
import { type RemoteNavEntry } from '@/components/remote/MobileRemoteShell';
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

  // WYSIWYG preview: the visible functions become the phone's bottom-nav tabs.
  // The preview embeds the REAL phone shell (MobileLocalPreview) fed by this
  // machine's gate, so toggling a function here changes the phone's tabs live
  // and each tab shows real local data — what you configure is what the phone
  // shows, because it is literally the same shell.
  const previewEntries: RemoteNavEntry[] = entries
    .filter((e) => permFor(cfg, e.key).visible)
    .map((e) => ({ key: e.key, label: e.label, icon: e.icon }));

  return (
    <div className={styles.page}>
      <div className={styles.split}>
        <div className={styles.previewCol}>
          <div className={styles.previewLabel}>What your phone shows</div>
          <MobileLocalPreview entries={previewEntries} />
          <div className={styles.previewNote}>
            The same app your phone renders remotely — swipe from the right (or tap ✦) for Irisy.
          </div>
        </div>
        <div className={styles.configCol}>
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
      </div>
    </div>
  );
}

// Connection card — account model (dev scheme). The desktop is reachable on the
// room+key DERIVED from the signed-in account; the phone that signs in with the
// same account lands in the same room and connects — no pairing link, no
// per-device passcode (the derived key is the credential, relay stays
// zero-knowledge). Dev credentials live in remote-account.ts.
const REACHABLE_KEY = 'ctrl.remote.reachable.v1';

function ConnectCard({ buildAllowlist }: { buildAllowlist: () => RemoteAllowEntry[] }): ReactElement {
  const [reachable, setReachable] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REACHABLE_KEY) !== '0'; // default on (dev)
    } catch {
      return true;
    }
  });
  const [state, setState] = useState<RemoteState>('disconnected');
  const hostRef = useRef<RemoteHost | null>(null);
  const allowRef = useRef(buildAllowlist);
  allowRef.current = buildAllowlist;
  const account = loadAccount() ?? DEV_ACCOUNT;

  useEffect(() => {
    if (!reachable) {
      hostRef.current?.stop();
      hostRef.current = null;
      setState('disconnected');
      return;
    }
    let alive = true;
    void deriveSession(account).then((s) => {
      if (!alive) return;
      const host = new RemoteHost(
        s.room,
        s.keyB64,
        () => Promise.resolve(allowRef.current()),
        { onState: setState },
        { keepAlive: true },
      );
      hostRef.current = host;
      void host.start();
    });
    return () => {
      alive = false;
      hostRef.current?.stop();
      hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachable, account.username, account.password]);

  const toggle = (): void => {
    const next = !reachable;
    setReachable(next);
    try {
      localStorage.setItem(REACHABLE_KEY, next ? '1' : '0');
    } catch {
      /* best-effort */
    }
  };

  const dotState = reachable && state === 'paired' ? 'live' : 'idle';

  return (
    <section className={styles.connect}>
      <div className={styles.connectMain}>
        <div className={styles.statusDot} data-state={dotState} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.connectTitle}>
            {reachable ? 'This desktop is reachable from your phone' : 'Phone access is off'}
          </div>
          <div className={styles.connectHint}>
            {reachable ? (
              <>
                Sign in on your phone as <b>{account.username}</b> (same account) to see these
                functions. Data flows end-to-end; the relay can&apos;t read it.
              </>
            ) : (
              <>Turn on to reach these functions from your phone by signing in with your account.</>
            )}
          </div>
        </div>
      </div>
      <div className={styles.connectActions}>
        <button
          type="button"
          className={styles.toggle}
          role="switch"
          aria-checked={reachable}
          data-on={reachable || undefined}
          onClick={toggle}
          title={reachable ? 'Reachable' : 'Off'}
        >
          <span className={styles.knob} />
        </button>
      </div>
    </section>
  );
}
