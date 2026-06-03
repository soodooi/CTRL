// SourcingReviewTab — workspace tab that parses Irisy's daily sourcing
// proposals from `vault/.ctrl/review-queue/<date>.md` and lets the user
// Accept / Edit / Reject each item.
//
// (ADR-002 substrate § vault v1 §8.6 review-flow, 2026-06-01 — memory
// `decision_vault_adr_002_section_8`.)
//
// File schema produced by the Irisy routine (`vault/.ctrl/sourcing-prompt.md`):
//
//   ## sourcing/<original-filename>
//   - **type**: <class>
//   - **suggest path**: <target>
//   - **frontmatter**: <yaml block on next line, fenced>
//   - **backlinks**: <list>
//   - **actions**: [Accept] [Edit] [Reject]
//
// The parser is forgiving — anything that diverges from the schema is
// surfaced as a plain text "raw" item so the user can still act on it.

import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  vaultDelete,
  vaultMove,
  vaultRead,
  vaultWrite,
} from '@/lib/kernel';
import { useWorkspaceStore } from '@/lib/workspace-store';
import styles from './SourcingReviewTab.module.css';

interface Proposal {
  sourcingPath: string;
  type: string;
  suggestPath: string;
  frontmatter: Record<string, unknown>;
  backlinks: string[];
  notes: string;
}

interface SourcingReviewTabProps {
  /** Vault-relative path of the review-queue file to render. */
  reviewPath: string;
}

const RAW_SECTION = 'raw';

export const SourcingReviewTab = ({
  reviewPath,
}: SourcingReviewTabProps): ReactElement => {
  const queryClient = useQueryClient();
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  const {
    data: queueText,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['vault-review-queue', reviewPath],
    queryFn: async () => {
      const entry = await vaultRead(reviewPath);
      return typeof entry.body === 'string' ? entry.body : '';
    },
    staleTime: 5_000,
    retry: false,
  });

  const proposals = useMemo(() => parseQueue(queueText ?? ''), [queueText]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vault-review-queue', reviewPath] });
    queryClient.invalidateQueries({ queryKey: ['vault-list'] });
  }, [queryClient, reviewPath]);

  const handleAccept = useCallback(
    async (p: Proposal) => {
      if (!p.suggestPath) return;
      setProcessing((s) => ({ ...s, [p.sourcingPath]: true }));
      try {
        // Read the sourcing item first so we can write it under the
        // suggested path with the proposed frontmatter merged in. We
        // keep the original body verbatim — Irisy's job is to
        // classify, the user's job is to edit prose.
        const original = await vaultRead(p.sourcingPath);
        const body =
          typeof original.body === 'string' ? original.body : '';
        await vaultWrite({
          path: p.suggestPath,
          content: body,
          frontmatter: {
            ...(original.frontmatter ?? {}),
            ...p.frontmatter,
          },
        });
        await vaultDelete(p.sourcingPath);
        refresh();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('sourcing accept failed', err);
      } finally {
        setProcessing((s) => ({ ...s, [p.sourcingPath]: false }));
      }
    },
    [refresh],
  );

  const handleReject = useCallback(
    async (p: Proposal) => {
      setProcessing((s) => ({ ...s, [p.sourcingPath]: true }));
      try {
        await vaultDelete(p.sourcingPath);
        refresh();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('sourcing reject failed', err);
      } finally {
        setProcessing((s) => ({ ...s, [p.sourcingPath]: false }));
      }
    },
    [refresh],
  );

  // Static import — the dynamic import in the previous draft paid
  // an unnecessary chunk-load round-trip on every Edit click (the
  // module is already in the workspace bundle).
  const handleEdit = useCallback(
    (p: Proposal) => {
      useWorkspaceStore.getState().openTab(
        {
          id: `vault:${p.sourcingPath}`,
          kind: 'vault-md',
          title: p.sourcingPath.split('/').pop() ?? p.sourcingPath,
          vaultPath: p.sourcingPath,
        },
        { activate: true },
      );
    },
    [],
  );

  if (isLoading) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>Loading review queue…</p>
      </div>
    );
  }

  if (error || !queueText) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>No review queue for today</h2>
        <p className={styles.emptyText}>
          When Irisy processes <code>vault/sourcing/</code> it writes
          proposals to <code>{reviewPath}</code>. Run{' '}
          <code>/integrate sourcing</code> in the chat, or wait for the
          9 AM scan.
        </p>
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Review queue is empty</h2>
        <p className={styles.emptyText}>
          Sourcing inbox is clear — nothing to triage right now.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h2 className={styles.title}>Sourcing review</h2>
        <p className={styles.path}>{reviewPath}</p>
      </header>
      <ul className={styles.list}>
        {proposals.map((p) => {
          const busy = processing[p.sourcingPath] === true;
          return (
            <li key={p.sourcingPath} className={styles.item} data-busy={busy || undefined}>
              <div className={styles.itemHead}>
                <span className={styles.itemSource}>{p.sourcingPath}</span>
                {p.type ? (
                  <span className={styles.itemType}>{p.type}</span>
                ) : null}
              </div>
              {p.suggestPath ? (
                <p className={styles.line}>
                  <span className={styles.lineLabel}>Suggest →</span>{' '}
                  <code className={styles.lineCode}>{p.suggestPath}</code>
                </p>
              ) : null}
              {Object.keys(p.frontmatter).length > 0 ? (
                <pre className={styles.fm}>
                  {JSON.stringify(p.frontmatter, null, 2)}
                </pre>
              ) : null}
              {p.backlinks.length > 0 ? (
                <p className={styles.line}>
                  <span className={styles.lineLabel}>Backlinks:</span>{' '}
                  {p.backlinks.join(', ')}
                </p>
              ) : null}
              {p.notes ? (
                <p className={styles.notes}>{p.notes}</p>
              ) : null}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.action} ${styles.accept}`}
                  disabled={busy || !p.suggestPath}
                  onClick={() => void handleAccept(p)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={styles.action}
                  disabled={busy}
                  onClick={() => void handleEdit(p)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.reject}`}
                  disabled={busy}
                  onClick={() => void handleReject(p)}
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ---------- parser ----------

/**
 * Parse the review-queue markdown file Irisy produces. Sections start
 * with `## sourcing/<path>`. Within each section we look for the
 * structured fields documented in the sourcing-prompt.md schema —
 * unknown lines are appended to `notes` so they aren't lost.
 */
const parseQueue = (text: string): Proposal[] => {
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const out: Proposal[] = [];
  let current: Proposal | null = null;

  const flush = (): void => {
    if (current) out.push(current);
    current = null;
  };

  const sourcingHeader = /^##\s+sourcing\/(.+)\s*$/;
  const typeLine = /^[*-]\s+\*\*type\*\*:\s*(.+)$/i;
  const suggestLine = /^[*-]\s+\*\*suggest path\*\*:\s*(.+)$/i;
  const backlinksLine = /^[*-]\s+\*\*backlinks\*\*:\s*(.+)$/i;
  const frontmatterLine = /^[*-]\s+\*\*frontmatter\*\*:\s*(.*)$/i;

  let fmAccumulating = false;
  let fmBuf = '';

  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = sourcingHeader.exec(line);
    if (m) {
      if (fmAccumulating && current) {
        current.frontmatter = parseFrontmatterJson(fmBuf);
        fmBuf = '';
        fmAccumulating = false;
      }
      flush();
      current = {
        sourcingPath: `sourcing/${m[1]}`,
        type: '',
        suggestPath: '',
        frontmatter: {},
        backlinks: [],
        notes: '',
      };
      continue;
    }
    if (!current) continue;

    if (fmAccumulating) {
      if (line.startsWith('```')) {
        current.frontmatter = parseFrontmatterJson(fmBuf);
        fmBuf = '';
        fmAccumulating = false;
        continue;
      }
      fmBuf += `${raw}\n`;
      continue;
    }

    const t = typeLine.exec(line);
    if (t && t[1] !== undefined) {
      current.type = t[1].trim();
      continue;
    }
    const s = suggestLine.exec(line);
    if (s && s[1] !== undefined) {
      current.suggestPath = s[1].trim().replace(/^`(.+)`$/, '$1');
      continue;
    }
    const b = backlinksLine.exec(line);
    if (b && b[1] !== undefined) {
      current.backlinks = b[1]
        .split(/[,;]/)
        .map((x) => x.trim().replace(/^`(.+)`$/, '$1'))
        .filter(Boolean);
      continue;
    }
    const f = frontmatterLine.exec(line);
    if (f && f[1] !== undefined) {
      const inline = f[1].trim();
      if (inline.startsWith('{')) {
        current.frontmatter = parseFrontmatterJson(inline);
      } else if (inline === '') {
        // Block style follows — opening fence on next ```.
        fmAccumulating = false;
      } else {
        // Plain text — assume key=value pairs separated by `;`.
        current.frontmatter = parsePairs(inline);
      }
      continue;
    }
    if (line.startsWith('```')) {
      // Treat the next ``` block as a frontmatter JSON / YAML payload.
      fmAccumulating = true;
      fmBuf = '';
      continue;
    }
    if (line.startsWith('- **actions**')) {
      // Action chips are static UI; skip.
      continue;
    }
    if (line.trim() === '') continue;
    current.notes = current.notes ? `${current.notes}\n${line}` : line;
  }

  if (fmAccumulating && current) {
    current.frontmatter = parseFrontmatterJson(fmBuf);
  }
  flush();
  return out;
};

const parseFrontmatterJson = (raw: string): Record<string, unknown> => {
  const t = raw.trim();
  if (!t) return {};
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    // Fall through to pair-style.
  }
  return parsePairs(t);
};

const parsePairs = (raw: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const seg of raw.split(/[;\n]/)) {
    const s = seg.trim();
    if (!s) continue;
    const colon = s.indexOf(':');
    if (colon < 0) continue;
    const key = s.slice(0, colon).trim().replace(/[`"']/g, '');
    const value = s
      .slice(colon + 1)
      .trim()
      .replace(/[`"']/g, '');
    if (key && key !== RAW_SECTION) out[key] = value;
  }
  return out;
};
