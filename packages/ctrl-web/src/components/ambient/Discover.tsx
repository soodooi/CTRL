// Discover — app-store-style feature pack browser (ADR-006 §5).
//
// bao 2026-06-12: the old Discover was a dead hardcoded card list — no search,
// no categories, couldn't hold many packs. Rebuilt app-store style: prominent
// search (most sessions start with a query), category chips, a card grid that
// scales, a featured banner, and a "create one" CTA (flexible, not a fixed
// catalog). Listings come from the MCP Registry; no dev-hardcoded seed set.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  installPack,
  uninstallPack,
  loadInstalledPacks,
  packSecretFields,
  PACKS_CHANGED_EVENT,
  type PackListing,
  type SecretField,
} from '@/lib/feature-pack';
import { loadDiscoverListings, connectRemoteMcp } from '@/lib/pack-registry';
import type { FeaturePack } from '@/components/featurepack/FeaturePackScene';
import { fctHasFiles, fctOwnership, revealFct, setFctEnabled, type FctItem } from '@/lib/fct';
import type { LocalAppConnector, SelectionFact } from '@/lib/local-apps';
import { LocalApps } from './LocalApps';
import { PackCreator } from './PackCreator';
import { PackConfig } from './PackConfig';
import styles from './Discover.module.css';

interface DiscoverProps {
  installed?: FeaturePack[];
  fcts?: FctItem[];
  onUseFct?: (ref: string) => void;
  /** Refetch the catalogue after an availability change, so the shown state is
   *  the kernel's and not this component's guess. (ADR-005 irisy §12 v42 U15) */
  onFctsChanged?: () => void;
  /** Hand a local application's explicit selection to the current session.
   *  (ADR-005 irisy §12 v42 U22) */
  onUseSelection?: (connector: LocalAppConnector, facts: SelectionFact[]) => void;
}

type LibraryMode = 'find' | 'installed' | 'create';

export function Discover({
  installed = [],
  fcts = [],
  onUseFct,
  onFctsChanged,
  onUseSelection,
}: DiscoverProps): ReactElement {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<LibraryMode>('find');
  const [cat, setCat] = useState('All');
  // Discover listings come from the MCP Registry (browsable remote servers) —
  // no dev-hardcoded seed catalog (bao 2026-06-26). Empty until the kernel
  // fetch returns; degrades to empty offline (ADR-002 §7.4).
  const [listings, setListings] = useState<PackListing[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [togglingRef, setTogglingRef] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [configPack, setConfigPack] = useState<{
    mcpId: string;
    name: string;
    fields: SecretField[];
  } | null>(null);

  useEffect(() => {
    const refresh = (): void => {
      void loadInstalledPacks()
        .then((ps) => setInstalledIds(new Set(ps.map((p) => p.id))))
        .catch(() => {});
    };
    refresh();
    window.addEventListener(PACKS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PACKS_CHANGED_EVENT, refresh);
  }, []);

  // Pull the existing registry owner again instead of creating a second search
  // or catalogue path. (ADR-002 substrate §7.4 v90; ADR-003 frontend §8.5 v45)
  const refreshListings = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setMsg(null);
    try {
      setListings(await loadDiscoverListings());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshListings();
  }, [refreshListings]);

  const categories = useMemo(
    () => [
      'All',
      ...Array.from(
        new Set([
          ...installed.map((p) => p.category ?? 'Installed'),
          ...listings.map((p) => p.category),
        ]),
      ),
    ],
    [installed, listings],
  );

  const installedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fcts.filter((fct) => {
      if (mode !== 'installed') return false;
      if (!q) return true;
      return `${fct.name} ${fct.summary}`.toLowerCase().includes(q);
    });
  }, [fcts, mode, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // An installed pack already renders its own card above — drop any registry
    // listing that shares its id so it doesn't show twice.
    const installedIds = new Set(installed.map((p) => p.id));
    return mode === 'find'
      ? listings.filter((p) => {
          if (installedIds.has(p.id)) return false;
          if (cat !== 'All' && p.category !== cat) return false;
          if (!q) return true;
          return `${p.name} ${p.summary} ${p.category}`.toLowerCase().includes(q);
        })
      : [];
  }, [query, cat, listings, installed, mode]);

  const install = async (p: PackListing): Promise<void> => {
    setInstallingId(p.id);
    setMsg(null);
    try {
      await installPack(p.manifest);
      const secrets = packSecretFields(p.manifest);
      if (secrets.length > 0) {
        setConfigPack({ mcpId: p.id, name: p.name, fields: secrets });
      } else {
        setMsg(`Added FCT "${p.name}" to Installed FCTs. It was not activated.`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingId(null);
    }
  };

  const uninstall = async (p: PackListing): Promise<void> => {
    setUninstallingId(p.id);
    setMsg(null);
    try {
      await uninstallPack(p.id);
      setMsg(`Removed FCT "${p.name}".`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUninstallingId(null);
    }
  };

  const connect = async (p: PackListing): Promise<void> => {
    setConnectingId(p.id);
    setMsg(null);
    try {
      const tools = await connectRemoteMcp(p);
      setMsg(
        `Added FCT "${p.name}" with ${tools.length} ${tools.length === 1 ? 'action' : 'actions'}.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setConnectingId(null);
    }
  };

  const importPack = async (): Promise<void> => {
    setImporting(true);
    setMsg(null);
    try {
      const manifest = JSON.parse(importText.trim()) as Record<string, unknown>;
      await installPack(manifest);
      setImportText('');
      setMsg('Added a shared FCT to Installed FCTs. It was not activated.');
    } catch (e) {
      setMsg(e instanceof Error ? `Add FCT failed: ${e.message}` : String(e));
    } finally {
      setImporting(false);
    }
  };

  // Feature the first installable listing (registry servers are remote/browse-
  // only). With no bundled packs and a remote-only registry, nothing is
  // featured — the banner simply doesn't render.
  const featured = listings.find((p) => p.kind !== 'remote');
  const showFeatured = mode === 'find' && cat === 'All' && !query && featured != null;

  const removeFct = async (fct: FctItem): Promise<void> => {
    if (!fct.ref.startsWith('pack:')) return;
    const id = fct.ref.slice('pack:'.length);
    setUninstallingId(id);
    setMsg(null);
    try {
      await uninstallPack(id);
      setMsg(`Removed FCT "${fct.name}".`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setUninstallingId(null);
    }
  };

  // Ownership is only useful if the user can reach the files it names.
  // (ADR-002 substrate §15.4.1 v88; ADR-005 irisy §12 v42 U18)
  const revealFctFiles = async (fct: FctItem): Promise<void> => {
    setMsg(null);
    try {
      const path = await revealFct(fct.ref);
      setMsg(`Showing ${path}`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  // Disable is the reversible half of managing what is installed: it stops a
  // capability being offered without deleting its files or configuration.
  // (ADR-002 substrate §15.4.1 v88; ADR-005 irisy §12 v42 U15/U18)
  const toggleFct = async (fct: FctItem): Promise<void> => {
    const next = fct.enabled === false;
    setTogglingRef(fct.ref);
    setMsg(null);
    try {
      await setFctEnabled(fct.ref, next);
      setMsg(next ? `Enabled "${fct.name}".` : `Disabled "${fct.name}". It is still installed.`);
      onFctsChanged?.();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setTogglingRef(null);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <div className={styles.titleRow}>
          <span className={styles.title}>FCT Library</span>
          <span className={styles.titleSub}>Find, install, manage, or create reusable FCTs</span>
          <button
            type="button"
            className={styles.refreshBtn}
            disabled={refreshing}
            onClick={() => void refreshListings()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className={styles.chips} role="tablist" aria-label="FCT Library mode">
          {(['find', 'installed', 'create'] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              role="tab"
              aria-selected={mode === nextMode}
              className={`${styles.chip} ${mode === nextMode ? styles.chipOn : ''}`}
              onClick={() => {
                setMode(nextMode);
                if (nextMode === 'create') setCreatorOpen(true);
              }}
            >
              {nextMode === 'find' ? 'Find FCTs' : nextMode === 'installed' ? 'Installed FCTs' : 'Create FCT'}
            </button>
          ))}
        </div>
        {mode !== 'create' && (
          <div className={styles.search}>
            <span aria-hidden="true">⌕</span>
            <input
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'find' ? 'Find FCTs…' : 'Search installed FCTs…'}
            />
          </div>
        )}
        {mode === 'find' && (
          <div className={styles.chips}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.chip} ${cat === c ? styles.chipOn : ''}`}
                onClick={() => setCat(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.scroll}>
        {mode === 'find' && (
          <>
        <div className={styles.create}>
          <span className={styles.createIc}>✦</span>
          <div className={styles.createBody}>
            <h4>Nothing fits? Create an FCT</h4>
            <p>Describe what you need, review the result, then add it to Installed FCTs.</p>
          </div>
          <button type="button" className={styles.createBtn} onClick={() => {
            setMode('create');
            setCreatorOpen(true);
          }}>Create FCT</button>
        </div>

        <details className={styles.importRow}>
          <summary className={styles.importSummary}>Add a shared FCT</summary>
          <textarea
            className={styles.importBox}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'{"name":"...","actions":[...]}'}
            rows={3}
          />
          <button
            type="button"
            className={styles.createBtn}
            disabled={!importText.trim() || importing}
            onClick={() => void importPack()}
          >
            {importing ? 'Adding…' : 'Add FCT'}
          </button>
        </details>
          </>
        )}

        {mode === 'create' && !creatorOpen && (
          <div className={styles.create}>
            <div className={styles.createBody}>
              <h4>Create FCT</h4>
              <p>Authoring is separate from the FCT selected in your current Irisy session.</p>
            </div>
            <button type="button" className={styles.createBtn} onClick={() => setCreatorOpen(true)}>
              Create FCT
            </button>
          </div>
        )}

        {showFeatured && (
          <div className={styles.featured}>
            <span className={styles.bigIc}>{featured.icon}</span>
            <div className={styles.fBody}>
              <div className={styles.fTag}>Featured</div>
              <h3>{featured.name}</h3>
              <p>{featured.summary}</p>
            </div>
            <button
              type="button"
              className={styles.installBtn}
              disabled={installedIds.has(featured.id) || installingId === featured.id}
              onClick={() => void install(featured)}
            >
              {installedIds.has(featured.id) ? 'Installed FCT' : 'Add FCT'}
            </button>
          </div>
        )}

        {/* Local applications are a separate shelf from FCTs: connecting one is
            an explicit act on software the user may not have, and what it offers
            is a live selection rather than an installable capability.
            (ADR-005 irisy §12 v42 U19/U22) */}
        {mode === 'installed' && <LocalApps onUseSelection={onUseSelection} />}

        {mode !== 'create' && (
          <>
            <div className={styles.secHead}>
          <span className={styles.secTitle}>
            {mode === 'installed' ? 'Installed FCTs' : cat === 'All' ? 'Find FCTs' : cat}
          </span>
        </div>
        <div className={styles.grid}>
          {installedMatches.map((fct) => {
            const removable = fct.ref.startsWith('pack:');
            const id = removable ? fct.ref.slice('pack:'.length) : '';
            return (
              <div key={fct.ref} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.cardIc}>✦</span>
                  <span className={styles.cardName}>{fct.name}</span>
                </div>
                <div className={styles.cardDesc}>{fct.summary}</div>
                <div className={styles.cardFoot}>
                  {/* Ownership is stated so the user knows what Remove would
                      delete, and disabling is offered as the reversible option.
                      (ADR-005 irisy §12 v42 U15/U18) */}
                  <span className={styles.cardMeta}>
                    {fctOwnership(fct)}
                    {' · '}
                    {fct.enabled === false
                      ? 'Disabled'
                      : fct.selection_kind === 'selectable'
                        ? 'Available'
                        : 'Unavailable for selection'}
                  </span>
                  <button
                    type="button"
                    className={styles.cardBtn}
                    disabled={togglingRef === fct.ref}
                    onClick={() => void toggleFct(fct)}
                  >
                    {togglingRef === fct.ref ? '…' : fct.enabled === false ? 'Enable' : 'Disable'}
                  </button>
                  {fctHasFiles(fct) && (
                    <button
                      type="button"
                      className={styles.cardBtn}
                      onClick={() => void revealFctFiles(fct)}
                    >
                      Show files
                    </button>
                  )}
                  {removable && (
                    <button
                      type="button"
                      className={styles.cardBtn}
                      disabled={uninstallingId === id}
                      onClick={() => void removeFct(fct)}
                    >
                      {uninstallingId === id ? '…' : 'Remove FCT'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.cardBtn}
                    disabled={fct.selection_kind !== 'selectable' || onUseFct == null}
                    onClick={() => onUseFct?.(fct.ref)}
                  >
                    Use FCT
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.map((p) => {
            const got = installedIds.has(p.id);
            // Registry servers are remote MCP — browsable/openable, not yet
            // runnable as packs (ADR-002 §7.4). Show "Open", not "Install".
            const remote = p.kind === 'remote';
            return (
              <div key={p.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.cardIc}>{p.icon}</span>
                  <span className={styles.cardName}>{p.name}</span>
                </div>
                <div className={styles.cardDesc}>{p.summary}</div>
                <div className={styles.cardFoot}>
                  <span className={styles.cardMeta}>
                    {remote ? (
                      'Available from the registry'
                    ) : (
                      <>
                        {p.installs != null && <b>{p.installs}</b>}
                        {p.installs != null ? ' installs' : ''}
                        {p.rating != null ? ` · ★ ${p.rating}` : ''}
                      </>
                    )}
                  </span>
                  {remote ? (
                    <button
                      type="button"
                      className={styles.cardBtn}
                      disabled={p.remoteUrl == null || connectingId === p.id}
                      onClick={() => void connect(p)}
                      title={p.remoteUrl ?? 'No remote endpoint listed'}
                    >
                      {connectingId === p.id ? '…' : 'Add FCT'}
                    </button>
                  ) : got ? (
                    <button
                      type="button"
                      className={`${styles.cardBtn} ${styles.cardBtnGot}`}
                      disabled={uninstallingId === p.id}
                      onClick={() => void uninstall(p)}
                    >
                      {uninstallingId === p.id ? '…' : 'Remove FCT'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.cardBtn}
                      disabled={installingId === p.id}
                      onClick={() => void install(p)}
                    >
                      {installingId === p.id ? '…' : 'Add FCT'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {installedMatches.length === 0 && filtered.length === 0 && (
            <div className={styles.empty}>
              {mode === 'installed' ? 'No installed FCTs match.' : 'No FCTs match. Try Create FCT.'}
            </div>
          )}
            </div>
          </>
        )}

        {msg != null && <div className={styles.msg}>{msg}</div>}
      </div>
      {creatorOpen && (
        <PackCreator
          onClose={() => setCreatorOpen(false)}
          onInstalled={() => {
            setMode('installed');
            setMsg('FCT added to Installed FCTs. It was not activated.');
          }}
        />
      )}
      {configPack != null && (
        <PackConfig
          mcpId={configPack.mcpId}
          packName={configPack.name}
          fields={configPack.fields}
          onClose={() => setConfigPack(null)}
          onDone={() => setMsg(`Configured "${configPack.name}" — key saved to your keychain.`)}
        />
      )}
    </div>
  );
}
