// ClusterWorkspace — multi-source aggregator template (T6 in the
// workspace-type matrix). Renders a vertical stack of "GroupCards", one
// per auto-detected group, each with a tab strip across its sessions.
//
// The grouping function is supplied by the consumer so the same template
// can serve Code Space (group by git remote / fs root), Meeting (group
// by meeting_id), screen recording (group by recording session), etc.
//
// Phase 1B contract — kept intentionally minimal:
//   - `sources` is a flat array; the caller doesn't need to pre-group
//   - `groupBy(source)` returns a stable group_id + group_label
//   - `renderPreview(source)` paints whatever the active tab should
//     show (a terminal tail, a transcript, etc.)
//   - `onOpen(source)` is fired when the user wants the focused view
//
// The Right Rail is the consumer's responsibility — Code Space wires
// it via useRailItems in code-space.tsx.

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { TabStrip, type LedTone } from '@/components/primitives';
import styles from './ClusterWorkspace.module.css';

// Cluster sources use the brand LedTone palette so dots match the rest
// of the cockpit (status bar instruments, history rail, etc.).
export type SessionTone = LedTone;

export interface ClusterSource<T> {
  id: string;
  label: string;
  tone?: SessionTone;
  data: T;
}

export interface ClusterGroupKey {
  id: string;
  label: string;
}

interface ClusterWorkspaceProps<T> {
  title: string;
  meta?: string;
  headerActions?: ReactNode;
  sources: ReadonlyArray<ClusterSource<T>>;
  groupBy: (source: ClusterSource<T>) => ClusterGroupKey;
  renderPreview: (source: ClusterSource<T>) => ReactNode;
  renderFooter?: (source: ClusterSource<T>) => ReactNode;
  onOpen?: (source: ClusterSource<T>) => void;
  onAddToGroup?: (group: ClusterGroupKey) => void;
  emptyTitle?: string;
  emptyHint?: ReactNode;
}

interface Group<T> {
  key: ClusterGroupKey;
  sources: ClusterSource<T>[];
}

const tabTone = (tone: SessionTone | undefined): LedTone => tone ?? 'unknown';

export function ClusterWorkspace<T>({
  title,
  meta,
  headerActions,
  sources,
  groupBy,
  renderPreview,
  renderFooter,
  onOpen,
  onAddToGroup,
  emptyTitle = 'Nothing here yet',
  emptyHint,
}: ClusterWorkspaceProps<T>): ReactElement {
  const groups = useMemo<Group<T>[]>(() => {
    const map = new Map<string, Group<T>>();
    for (const source of sources) {
      const key = groupBy(source);
      const existing = map.get(key.id);
      if (existing) existing.sources.push(source);
      else map.set(key.id, { key, sources: [source] });
    }
    return Array.from(map.values());
  }, [sources, groupBy]);

  if (groups.length === 0) {
    return (
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{title}</h1>
            {meta && <span className={styles.meta}>{meta}</span>}
          </div>
          <div className={styles.actions}>{headerActions}</div>
        </header>
        <div className={styles.empty}>
          <h2 className={styles.emptyHeadline}>{emptyTitle}</h2>
          {emptyHint && <div className={styles.emptyHint}>{emptyHint}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {meta && <span className={styles.meta}>{meta}</span>}
        </div>
        <div className={styles.actions}>{headerActions}</div>
      </header>
      <div className={styles.body}>
        {groups.map((group) => (
          <GroupCard
            key={group.key.id}
            group={group}
            renderPreview={renderPreview}
            renderFooter={renderFooter}
            onOpen={onOpen}
            onAddToGroup={onAddToGroup}
          />
        ))}
      </div>
    </div>
  );
}

interface GroupCardProps<T> {
  group: Group<T>;
  renderPreview: (source: ClusterSource<T>) => ReactNode;
  renderFooter?: (source: ClusterSource<T>) => ReactNode;
  onOpen?: (source: ClusterSource<T>) => void;
  onAddToGroup?: (group: ClusterGroupKey) => void;
}

function GroupCard<T>({
  group,
  renderPreview,
  renderFooter,
  onOpen,
  onAddToGroup,
}: GroupCardProps<T>): ReactElement {
  const [activeId, setActiveId] = useState<string>(group.sources[0]?.id ?? '');
  const active =
    group.sources.find((s) => s.id === activeId) ?? group.sources[0];

  if (!active) return <></>;

  return (
    <section className={styles.card} aria-label={group.key.label}>
      <header className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{group.key.label}</h2>
        <span className={styles.cardCount}>
          {group.sources.length}{' '}
          {group.sources.length === 1 ? 'session' : 'sessions'}
        </span>
        <div className={styles.cardSpacer} />
        {onAddToGroup && (
          <button
            type="button"
            className={styles.cardAction}
            onClick={() => onAddToGroup(group.key)}
            aria-label="Add session to this group"
            title="Add session"
          >
            +
          </button>
        )}
      </header>

      <TabStrip
        items={group.sources.map((s) => ({
          id: s.id,
          label: s.label,
          tone: tabTone(s.tone),
        }))}
        activeId={activeId}
        onChange={setActiveId}
        ariaLabel={`${group.key.label} sessions`}
        className={styles.tabs}
      />

      <div className={styles.cardBody}>{renderPreview(active)}</div>

      {(renderFooter || onOpen) && (
        <footer className={styles.cardFoot}>
          <div>{renderFooter?.(active)}</div>
          {onOpen && (
            <button
              type="button"
              className={styles.openButton}
              onClick={() => onOpen(active)}
            >
              Open ›
            </button>
          )}
        </footer>
      )}
    </section>
  );
}
