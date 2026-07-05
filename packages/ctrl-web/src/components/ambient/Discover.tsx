// Discover — app-store-style feature pack browser (ADR-006 §5).
//
// bao 2026-06-12: the old Discover was a dead hardcoded card list — no search,
// no categories, couldn't hold many packs. Rebuilt app-store style: prominent
// search (most sessions start with a query), category chips, a card grid that
// scales, a featured banner, and a "create one" CTA (flexible, not a fixed
// catalog). Listings come from the MCP Registry; no dev-hardcoded seed set.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
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
import type { ConnectorManifest } from '@/lib/connector';
import type { FeaturePack } from '@/components/featurepack/FeaturePackScene';
import { PackCreator } from './PackCreator';
import { PackConfig } from './PackConfig';
import styles from './Discover.module.css';

interface DiscoverProps {
  /** Kept for call-site compatibility; packs signal via PACKS_CHANGED_EVENT. */
  onInstalled: (m: ConnectorManifest) => void;
  /** Legacy shared style map — unused now (Discover owns Discover.module.css). */
  styles: Record<string, string>;
  /** Installed packs (incl. builtins like ctrl-ghostfolio) — surfaced + searched
   *  here so the Feature Packs library shows EVERYTHING, not just the registry
   *  (bao 2026-07-05: a builtin pack must be findable in the library). */
  installed?: FeaturePack[];
  /** Open an installed pack's scene (the parent routes to chat + setScene). */
  onOpenPack?: (pack: FeaturePack) => void;
}

export function Discover({ installed = [], onOpenPack }: DiscoverProps): ReactElement {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  // Discover listings come from the MCP Registry (browsable remote servers) —
  // no dev-hardcoded seed catalog (bao 2026-06-26). Empty until the kernel
  // fetch returns; degrades to empty offline (ADR-002 §7.4).
  const [listings, setListings] = useState<PackListing[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
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

  // Pull the registry data source (kernel-side fetch). Degrades to an empty
  // list when offline / on an older binary (ADR-002 § composition §7.4).
  useEffect(() => {
    void loadDiscoverListings()
      .then(setListings)
      .catch(() => {});
  }, []);

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

  // Installed packs (builtins + user-installed) matched against the same search
  // + category — so a builtin like ctrl-ghostfolio is findable in the library.
  const installedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return installed.filter((p) => {
      if (cat !== 'All' && (p.category ?? 'Installed') !== cat) return false;
      if (!q) return true;
      return `${p.name} ${p.summary ?? ''} ${p.category ?? ''}`.toLowerCase().includes(q);
    });
  }, [query, cat, installed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((p) => {
      if (cat !== 'All' && p.category !== cat) return false;
      if (!q) return true;
      return `${p.name} ${p.summary} ${p.category}`.toLowerCase().includes(q);
    });
  }, [query, cat, listings]);

  const install = async (p: PackListing): Promise<void> => {
    setInstallingId(p.id);
    setMsg(null);
    try {
      await installPack(p.manifest);
      const secrets = packSecretFields(p.manifest);
      if (secrets.length > 0) {
        setConfigPack({ mcpId: p.id, name: p.name, fields: secrets });
      } else {
        setMsg(`Installed "${p.name}" — it's now under Packs in the sidebar.`);
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
      setMsg(`Removed "${p.name}".`);
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
        `Connected "${p.name}" — Irisy can now use its ${tools.length} ${
          tools.length === 1 ? 'tool' : 'tools'
        }.`,
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
      setMsg('Imported a shared pack — it\'s now under Packs in the sidebar.');
    } catch (e) {
      setMsg(e instanceof Error ? `Import failed: ${e.message}` : String(e));
    } finally {
      setImporting(false);
    }
  };

  // Feature the first installable listing (registry servers are remote/browse-
  // only). With no bundled packs and a remote-only registry, nothing is
  // featured — the banner simply doesn't render.
  const featured = listings.find((p) => p.kind !== 'remote');
  const showFeatured = cat === 'All' && !query && featured != null;

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <div className={styles.titleRow}>
          <span className={styles.title}>Discover</span>
          <span className={styles.titleSub}>Feature packs — install one, or create your own</span>
        </div>
        <div className={styles.search}>
          <span>🔍</span>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search packs, or say what you want to do…"
          />
        </div>
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
      </div>

      <div className={styles.scroll}>
        <div className={styles.create}>
          <span className={styles.createIc}>✦</span>
          <div className={styles.createBody}>
            <h4>Nothing fits? Have Irisy build one</h4>
            <p>Say "I want a tool that does X" — Irisy generates a pack, you review and install. No JSON.</p>
          </div>
          <button type="button" className={styles.createBtn} onClick={() => setCreatorOpen(true)}>Create</button>
        </div>

        <details className={styles.importRow}>
          <summary className={styles.importSummary}>Have a shared pack? Paste it</summary>
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
            {importing ? 'Importing…' : 'Import'}
          </button>
        </details>

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
              {installedIds.has(featured.id) ? 'Installed' : 'Install'}
            </button>
          </div>
        )}

        <div className={styles.secHead}>
          <span className={styles.secTitle}>{cat === 'All' ? 'All packs' : cat}</span>
        </div>
        <div className={styles.grid}>
          {installedMatches.map((p) => (
            <div key={`inst.${p.id}`} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.cardIc}>{p.icon ?? '⚡'}</span>
                <span className={styles.cardName}>{p.name}</span>
              </div>
              <div className={styles.cardDesc}>{p.summary ?? ''}</div>
              <div className={styles.cardFoot}>
                <span className={styles.cardMeta}>Installed</span>
                <button
                  type="button"
                  className={styles.cardBtn}
                  onClick={() => onOpenPack?.(p)}
                  title={`Open ${p.name}`}
                >
                  Open
                </button>
              </div>
            </div>
          ))}
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
                      'Registry · remote MCP'
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
                      {connectingId === p.id ? '…' : 'Connect'}
                    </button>
                  ) : got ? (
                    <button
                      type="button"
                      className={`${styles.cardBtn} ${styles.cardBtnGot}`}
                      disabled={uninstallingId === p.id}
                      onClick={() => void uninstall(p)}
                    >
                      {uninstallingId === p.id ? '…' : 'Remove'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.cardBtn}
                      disabled={installingId === p.id}
                      onClick={() => void install(p)}
                    >
                      {installingId === p.id ? '…' : 'Install'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {installedMatches.length === 0 && filtered.length === 0 && (
            <div className={styles.empty}>No packs match. Try "Create" above.</div>
          )}
        </div>

        {msg != null && <div className={styles.msg}>{msg}</div>}
      </div>
      {creatorOpen && (
        <PackCreator
          onClose={() => setCreatorOpen(false)}
          onInstalled={() => setMsg("Installed your pack — it's now under Packs in the sidebar.")}
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
