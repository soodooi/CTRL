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
import { getOrCreateIdentity, rotatePasscode, type RemoteIdentity } from '@/lib/remote-identity';
import { REMOTE_APP_BASE, type RemoteAllowEntry, type RemoteState } from '@/lib/remote-connection';
import { MobilePreview } from '@/components/remote/MobilePreview';
import { SAMPLE_TABS } from '@/components/remote/mobile-sample';
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
      <div className={styles.split}>
        <div className={styles.previewCol}>
          <div className={styles.previewLabel}>What your phone shows</div>
          <MobilePreview tabs={SAMPLE_TABS} />
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

// Connection card — the unattended "reach my own desktop anytime" model
// (RustDesk/ToDesk parity, 2026-07-07 research). "Stay reachable" keeps a stable
// device (persistent id + E2E key + passcode) registered on the relay in the
// background, so the phone connects any time via a durable link — no trip to the
// desktop. A separate one-time link covers the attended "share with someone
// else" case. The relay stays zero-knowledge either way.
const REACHABLE_KEY = 'ctrl.remote.reachable.v1';

function ConnectCard({ buildAllowlist }: { buildAllowlist: () => RemoteAllowEntry[] }): ReactElement {
  const [reachable, setReachable] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REACHABLE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [identity, setIdentity] = useState<RemoteIdentity | null>(null);
  const [state, setState] = useState<RemoteState>('disconnected');
  const [copied, setCopied] = useState(false);
  const [share, setShare] = useState<string | null>(null);
  const hostRef = useRef<RemoteHost | null>(null);
  const shareHostRef = useRef<RemoteHost | null>(null);
  const allowRef = useRef(buildAllowlist);
  allowRef.current = buildAllowlist;

  // Persistent host: runs whenever "stay reachable" is on (survives restarts via
  // the stored flag). Re-runs when the identity's passcode rotates.
  const idKey = `${identity?.deviceId ?? ''}:${identity?.passcode ?? ''}`;
  useEffect(() => {
    if (!reachable) {
      hostRef.current?.stop();
      hostRef.current = null;
      setIdentity((cur) => cur ?? null);
      setState('disconnected');
      return;
    }
    const id = getOrCreateIdentity();
    setIdentity(id);
    const host = new RemoteHost(
      id.deviceId,
      id.keyB64,
      () => Promise.resolve(allowRef.current()),
      { onState: setState },
      { passcode: id.passcode, keepAlive: true },
    );
    hostRef.current = host;
    void host.start();
    return () => host.stop();
    // idKey re-triggers on passcode rotation so the host adopts the new passcode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachable, idKey]);

  const toggle = (): void => {
    const next = !reachable;
    setReachable(next);
    try {
      localStorage.setItem(REACHABLE_KEY, next ? '1' : '0');
    } catch {
      /* best-effort */
    }
  };

  const link =
    identity != null ? `${REMOTE_APP_BASE}/?remote=${identity.deviceId}#k=${identity.keyB64}` : '';
  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const startShare = (): void => {
    const room = toB64url(crypto.getRandomValues(new Uint8Array(12)));
    const keyB64 = toB64url(generateKeyBytes());
    const host = new RemoteHost(room, keyB64, () => Promise.resolve(allowRef.current()), {}, {
      keepAlive: false,
    });
    void host.start();
    shareHostRef.current?.stop();
    shareHostRef.current = host;
    setShare(`${REMOTE_APP_BASE}/?remote=${room}#k=${keyB64}`);
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
          {reachable && identity != null ? (
            <>
              <button
                type="button"
                className={styles.connectUrl}
                onClick={() => copy(link)}
                title="Copy the link — open it on your phone (bookmark it to reconnect anytime)"
              >
                {copied ? 'Copied' : link}
              </button>
              <div className={styles.passRow}>
                <span className={styles.passLabel}>Passcode</span>
                <span className={styles.passCode}>{identity.passcode}</span>
                <button
                  type="button"
                  className={styles.passReset}
                  onClick={() => setIdentity(rotatePasscode())}
                  title="Rotate — remembered phones must re-enter it"
                >
                  Reset
                </button>
              </div>
              <div className={styles.connectHint}>
                Open the link on your phone and enter the passcode once — it&apos;ll reconnect any
                time. The relay only ever forwards encrypted data.
              </div>
              {share != null && (
                <button type="button" className={styles.shareUrl} onClick={() => copy(share)}>
                  one-time share: {share}
                </button>
              )}
            </>
          ) : (
            <div className={styles.connectHint}>
              Turn this on to reach these functions from your phone at any time. Your desktop stays
              connected in the background; data flows end-to-end, the relay can&apos;t read it.
            </div>
          )}
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
        {reachable && (
          <button type="button" className={styles.shareBtn} onClick={startShare}>
            Share once
          </button>
        )}
      </div>
    </section>
  );
}
