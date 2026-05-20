// IPhoneFrame — CSS-only iOS device mockup wrapper.
//
// Per memory `decision_pc_mirrors_mobile_layout.md` (bao 2026-05-18): the PC
// PWA renders the workspace and keyboard as two iPhone Pro Max sized panels.
// The same React tree powers desktop Tauri WebView, browser DevTools mobile
// emulation, and real iOS Safari PWA — only this frame chrome wraps the
// content on desktop. Mobile devices hide the frame (real bezel takes over).
//
// Anti-pattern guarded against: writing a second mobile/desktop component.
// Single codebase, container-only adaptation — see ADR-002 PWA pivot.
//
// Pixel reference: iPhone 15 Pro Max ≈ 390 × 844 CSS px, ~19.5:9 portrait,
// outer-corner radius ≈ 55px, inner screen radius ≈ 47px.

import { type ReactNode } from 'react';
import styles from './IPhoneFrame.module.css';

interface IPhoneFrameProps {
  /** Title shown in the device-mockup chrome (above the notch). */
  title: string;
  /** Optional secondary label (subtle, mono). */
  subtitle?: string;
  /** Content rendered inside the screen area; clipped to the inner radius. */
  children: ReactNode;
  /** When true the frame chrome (bezel + notch) collapses — used on real mobile. */
  bare?: boolean;
}

export const IPhoneFrame = ({
  title,
  subtitle,
  children,
  bare = false,
}: IPhoneFrameProps): React.ReactElement => {
  if (bare) {
    return (
      <section className={styles.bare} aria-label={title}>
        {children}
      </section>
    );
  }

  return (
    <section className={styles.device} aria-label={title}>
      <header className={styles.caption}>
        <span className={styles.captionTitle}>{title}</span>
        {subtitle && <span className={styles.captionSubtitle}>{subtitle}</span>}
      </header>
      <div className={styles.bezel}>
        <div className={styles.sideButtonsLeft} aria-hidden="true">
          <span className={styles.btnMute} />
          <span className={styles.btnVolUp} />
          <span className={styles.btnVolDown} />
        </div>
        <div className={styles.sideButtonsRight} aria-hidden="true">
          <span className={styles.btnPower} />
        </div>
        <div className={styles.screen}>
          <div className={styles.dynamicIsland} aria-hidden="true" />
          <div className={styles.screenInner}>{children}</div>
          <div className={styles.homeIndicator} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
};
