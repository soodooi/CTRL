// MobilePreview — a live phone-frame preview of the mobile app, shown on the
// desktop Mobile (L1) page so you can see + feel the mobile experience without a
// phone (ADR-005 §2). It renders REAL components: the generic SurfaceRenderer for
// each pack's surface (no per-pack code) + the Irisy conversation as a slide-in
// sheet (bao 2026-07-08: the conversation must be there; reach it by swiping from
// the right edge or tapping the Irisy button — maps the desktop's right chat
// column onto the phone).
//
// Sample surfaces here use English placeholder content on purpose: the point on
// show is the GENERIC RENDERER (any pack, any domain), and real packs supply
// their own localized labels via `describe` (the pack data, not this code).
import { useRef, useState, type ReactElement } from 'react';
import { SurfaceView, type Action, type Surface } from './SurfaceRenderer';
import styles from './MobilePreview.module.css';

export interface PackTab {
  key: string;
  label: string;
  icon: string;
  surface: Surface;
}

export function MobilePreview({ tabs }: { tabs: PackTab[] }): ReactElement {
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const [chatOpen, setChatOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const touchX = useRef<number | null>(null);

  const cur = tabs.find((t) => t.key === active) ?? tabs[0];

  const onAction = (a: Action): void => {
    // Preview: show what would round-trip through the gate (verb/source/op).
    setLog((l) => [`${a.verb} -> ${a.source ?? cur?.surface.pack}.${a.op ?? a.id}`, ...l].slice(0, 4));
  };

  // Swipe-from-right-edge opens the chat (with a visible button as the
  // discoverable affordance so it isn't a hidden-only gesture).
  const onTouchStart = (e: React.TouchEvent): void => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touchX.current;
    const end = e.changedTouches[0]?.clientX ?? null;
    if (start != null && end != null && start - end > 60) setChatOpen(true);
    touchX.current = null;
  };

  return (
    <div className={styles.phone}>
      <div className={styles.screen} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className={styles.notch} />
        <div className={styles.appbar}>
          <span>{cur?.surface.title ?? cur?.label}</span>
          <span className={styles.kb}>describe:{cur?.surface.pack}</span>
        </div>

        <div className={styles.body}>
          {cur != null && <SurfaceView surface={cur.surface} onAction={onAction} />}
          {log.length > 0 && (
            <div className={styles.log}>
              {log.map((l, i) => (
                <div key={i} className={styles.logRow}>
                  {l}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Irisy conversation — the discoverable affordance for the swipe-in sheet. */}
        <button
          type="button"
          className={styles.irisyFab}
          onClick={() => setChatOpen(true)}
          aria-label="Talk to Irisy"
        >
          <span className={styles.irisySpark}>✦</span>
        </button>

        <div className={styles.nav}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={styles.tab}
              data-active={t.key === active || undefined}
              onClick={() => setActive(t.key)}
            >
              <span className={styles.tabIcon}>{t.icon}</span>
              <span className={styles.tabLabel}>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Chat sheet — slides in from the right (desktop's right column on a phone). */}
        <div className={styles.chatSheet} data-open={chatOpen || undefined}>
          <div className={styles.chatHead}>
            <span className={styles.chatTitle}>
              <span className={styles.irisySpark}>✦</span> Irisy
            </span>
            <button type="button" className={styles.chatClose} onClick={() => setChatOpen(false)}>
              ×
            </button>
          </div>
          <div className={styles.chatBody}>
            <div className={styles.msgUser}>How are today&apos;s top movers?</div>
            <div className={styles.msgAsst}>
              Choppy at highs — the streak leaders are all in robotics. Want me to pin them to the
              monitor table?
            </div>
            <div className={styles.msgHint}>
              Talks to Irisy on your desktop — same assistant, tunneled over the gate.
            </div>
          </div>
          <div className={styles.chatComposer}>
            <input className={styles.chatInput} placeholder="Ask Irisy…" readOnly />
            <button type="button" className={styles.chatSend}>
              ↑
            </button>
          </div>
        </div>
        {chatOpen && <div className={styles.scrim} onClick={() => setChatOpen(false)} />}
      </div>
    </div>
  );
}
