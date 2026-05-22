// DefaultWorkspace — Irisy's page. Per bao 2026-05-22 "首页就给 irisy
// 的页面就行了" — strip all the charts/gauges/sparklines, the home is
// just Irisy + a place to talk to her.

import { useEffect, useState, type ReactElement } from 'react';
import { IrisyMascot } from '@/components/IrisyMascot';
import { useRail } from '@/components/RightRail';
import styles from './default.module.css';

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();
  const [input, setInput] = useState('');

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!input.trim()) return;
    // Phase 1D will wire this to the LLM transport. For now we just
    // park the text so the chat shape is visible without lying about
    // a response that doesn't exist yet.
    setInput('');
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.mascotWrap}>
        <div className={styles.mascotHalo} />
        <IrisyMascot state="idle" size={200} />
      </div>

      <h1 className={styles.greeting}>What are we doing today?</h1>

      <form className={styles.input} onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Irisy, or type / for a keycap…"
          aria-label="Chat with Irisy"
          autoFocus
        />
        <span className={styles.inputHint}>↵</span>
      </form>
    </div>
  );
};
