// TagsPanel — collapsible tag cloud sourced from kernel
// `vault_tags` (frequency-sorted descending).
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)
//
// Click a tag → emits `onSelect(tag)`. NotesApp owns the
// `tagFilter` state and threads it into NotesTree which then
// switches its query source from `vault_list` to
// `vault_notes_by_tag(tag)`. A second click on the active tag
// clears the filter.

import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultTags } from '@/lib/kernel';
import styles from './Notes.module.css';

interface TagsPanelProps {
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

export const TagsPanel = ({ selected, onSelect }: TagsPanelProps): ReactElement => {
  const [open, setOpen] = useState(true);
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['vault-tags'],
    queryFn: () => vaultTags(),
    staleTime: 30_000,
  });

  return (
    <section className={styles.tagsPanel} aria-label="Tags">
      <header className={styles.tagsHeader}>
        <button
          type="button"
          className={styles.tagsToggle}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className={styles.fmChevron}>{open ? '▾' : '▸'}</span>
          <span className={styles.tagsLabel}>
            Tags
            {tags.length > 0 ? (
              <span className={styles.tagsCount}>{tags.length}</span>
            ) : null}
          </span>
        </button>
        {selected ? (
          <button
            type="button"
            className={styles.tagsClear}
            onClick={() => onSelect(null)}
            title="Clear tag filter"
          >
            clear
          </button>
        ) : null}
      </header>
      {open ? (
        <div className={styles.tagsBody}>
          {isLoading ? (
            <p className={styles.muted}>Loading…</p>
          ) : tags.length === 0 ? (
            <p className={styles.muted}>No tags yet.</p>
          ) : (
            <ul className={styles.tagsList}>
              {tags.map(({ tag, count }) => {
                const active = selected === tag;
                return (
                  <li key={tag}>
                    <button
                      type="button"
                      className={styles.tagChip}
                      data-active={active || undefined}
                      onClick={() => onSelect(active ? null : tag)}
                      title={`${count} note${count === 1 ? '' : 's'}`}
                    >
                      <span className={styles.tagName}>#{tag}</span>
                      <span className={styles.tagBadge}>{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
};
