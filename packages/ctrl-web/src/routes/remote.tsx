// Remote Window — L1 config page (ADR-005 §2 semantic co-view, option B).
// Manages what a remotely-connected phone sees + can do: an allowlist of
// functions (built-in faces + installed packs), each toggleable visible / view
// vs act. The connection card pairs a phone to this desktop (live wiring = S3).
//
// This is the "L1 button page to configure/manage the remote phone" bao named.
// Plan: vault/ctrl/plan-remote-window.md.
import { useEffect, useState, type ReactElement } from 'react';
import { loadInstalledPacks } from '@/lib/feature-pack';
import { type FeaturePack } from '@/components/featurepack/FeaturePackScene';
import {
  loadRemoteConfig,
  saveRemoteConfig,
  permFor,
  withPerm,
  type RemoteConfig,
} from '@/lib/remote-config';
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

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Remote Window</h1>
        <p className={styles.sub}>
          Open CTRL on your phone and use these functions remotely. Pick what the phone can
          see and whether it can act.
        </p>
      </header>

      <ConnectCard />

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

// Connection card — pairs a phone to this desktop. Live pairing (LAN URL +
// session token, then relay for cross-NAT) lands in S3; today it states the
// flow honestly so the page is usable without over-promising.
function ConnectCard(): ReactElement {
  return (
    <section className={styles.connect}>
      <div className={styles.connectMain}>
        <div className={styles.statusDot} data-state="idle" />
        <div>
          <div className={styles.connectTitle}>No phone connected</div>
          <div className={styles.connectHint}>
            Start a session to get a one-time code. On your phone, open CTRL and enter it —
            you&apos;ll see the functions you allowed above.
          </div>
        </div>
      </div>
      <button type="button" className={styles.connectBtn} disabled title="Live pairing lands next">
        Start session
      </button>
    </section>
  );
}
