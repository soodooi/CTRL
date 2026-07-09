// MobileLocalPreview — the desktop Mobile page's left column. It renders the
// REAL phone shell (MobileRemoteShell — the exact component the phone runs)
// inside a desktop phone frame, fed by LOCAL data (this machine's :17873 gate)
// instead of the relay. So what you configure here IS what the phone shows: the
// same shell, the same generic SurfaceRenderer, the same Irisy — only the data
// source differs (local gate here, tunneled over the relay on the phone). There
// is no separate "preview" mock any more, so the two can never drift.
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { MobileRemoteShell, type RemoteNavEntry } from './MobileRemoteShell';
import { SurfaceView, type Action, type Surface } from './SurfaceRenderer';
import { loadLocalSurface, runLocalAction, localChat } from '@/lib/remote-surface';
import styles from './MobileLocalPreview.module.css';

export function MobileLocalPreview({ entries }: { entries: RemoteNavEntry[] }): ReactElement {
  const renderContent = (key: string): ReactNode => <LocalSurfaceTab packKey={key} />;
  return (
    <div className={styles.phone}>
      <div className={styles.screen}>
        <div className={styles.notch} />
        <MobileRemoteShell
          entries={entries}
          renderContent={renderContent}
          onChat={localChat}
          fill
        />
      </div>
    </div>
  );
}

// One function's surface, loaded through the LOCAL gate + rendered generically —
// the desktop-side twin of RemoteApp's RemoteSurfaceTab (which loads it over the
// tunnel). Same SurfaceView, so a pack looks identical here and on the phone.
function LocalSurfaceTab({ packKey }: { packKey: string }): ReactElement {
  const [surface, setSurface] = useState<Surface | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchSurface = (): void => {
    void loadLocalSurface(packKey).then((s) => {
      setSurface(s);
      setLoaded(true);
    });
  };

  useEffect(() => {
    setLoaded(false);
    fetchSurface();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packKey]);

  const onAction = (a: Action): void => {
    void runLocalAction(a.op ?? a.id, a.args ?? {})
      .then(fetchSurface)
      .catch(() => {});
  };

  if (!loaded) {
    return (
      <div className={styles.pad}>
        <div className={styles.spinner} />
      </div>
    );
  }
  if (surface == null) {
    return <div className={styles.pad}>This function has no mobile view yet.</div>;
  }
  return <SurfaceView surface={surface} onAction={onAction} />;
}
