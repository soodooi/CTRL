// RightRail — 64px right column. Hosts:
//   1. Irisy mascot pinned top (always visible)
//   2. Context items per current workspace (instance list / categories /
//      filters) — supplied via the RailContext provider so any route can
//      populate it without prop-drilling through AppLayout.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { IrisyMascot, type IrisyState } from './primitives/IrisyMascot';
import styles from './RightRail.module.css';

export type RailTone = 'active' | 'success' | 'warning' | 'danger' | 'idle';

export interface RailItem {
  id: string;
  label: string;
  glyph?: string;
  tone?: RailTone;
  badge?: number;
  active?: boolean;
  onClick?: () => void;
}

interface RailContextValue {
  items: ReadonlyArray<RailItem>;
  setItems: (items: ReadonlyArray<RailItem>) => void;
  irisyState: IrisyState;
  setIrisyState: (state: IrisyState) => void;
}

const RailContext = createContext<RailContextValue | null>(null);

export const RailProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [items, setItems] = useState<ReadonlyArray<RailItem>>([]);
  const [irisyState, setIrisyState] = useState<IrisyState>('idle');
  const value = useMemo(
    () => ({ items, setItems, irisyState, setIrisyState }),
    [items, irisyState],
  );
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
};

export const useRail = (): RailContextValue => {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error('useRail must be used inside <RailProvider>');
  return ctx;
};

/** Convenience hook for routes that want to populate the rail. Pass a
 *  memoized items array — otherwise the rail re-renders every tick. The
 *  hook clears the rail on unmount so route swaps don't leak items. */
export const useRailItems = (items: ReadonlyArray<RailItem>): void => {
  const { setItems } = useRail();
  useEffect(() => {
    setItems(items);
    return () => setItems([]);
  }, [items, setItems]);
};

export const RightRail = (): ReactElement => {
  const { items, irisyState } = useRail();

  const handleClick = useCallback((item: RailItem) => {
    item.onClick?.();
  }, []);

  return (
    <aside className={styles.rail} aria-label="Context rail">
      {/* Irisy portal — presides over the rail at the top. */}
      <div className={styles.portal}>
        <div className={styles.mascot}>
          <div className={styles.mascotHalo} />
          <IrisyMascot state={irisyState} size={48} />
        </div>
        <span className={styles.mascotName}>Irisy</span>
      </div>

      {/* Navigation rail — context items for the current workspace. */}
      <nav className={styles.nav} aria-label="Workspace context">
        {items.length === 0 && (
          <span className={styles.empty}>no items</span>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.item}
            data-active={item.active ?? false}
            onClick={() => handleClick(item)}
            title={item.label}
            aria-label={item.label}
          >
            {item.glyph ? (
              <span className={styles.itemGlyph}>{item.glyph}</span>
            ) : (
              <span className={styles.itemDot} data-tone={item.tone ?? 'idle'} />
            )}
            {item.badge !== undefined && item.badge > 0 && (
              <span className={styles.itemBadge}>
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
};
