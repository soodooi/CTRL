// Discover — the share-and-be-shared commons (ADR-006 §5).
//
// Browse tool DEFINITIONS others have shared and install them locally; they
// run on YOUR own data + keys. Only definitions travel — no user data, no
// keys (the manifest holds a keychain key_ref, never a key). Like a recipe
// box: take a recipe, cook it with your own ingredients.
//
// v0: a small bundled commons of sample shared tools + a paste/import box.
// Later: a real shared index (git-backed / MCP-registry-style / CTRL-cloud
// listing — listings only, never user content per ADR-006 §3.8).

import { useState, type ReactElement } from 'react';
import {
  exportConnector,
  importConnector,
  loadConnectors,
  saveConnector,
  type ConnectorManifest,
} from '@/lib/connector';

interface DiscoverProps {
  onInstalled: (m: ConnectorManifest) => void;
  styles: Record<string, string>;
}

// Bundled commons (sample shared tool definitions — no keys, no data).
const COMMONS: ConnectorManifest[] = [
  {
    id: 'invoice-gen',
    title: 'Invoice generator',
    base_url: 'http://localhost:0',
    tools: [
      {
        name: 'list_invoices',
        title: 'List invoices',
        description: 'Your recent invoices',
        method: 'GET',
        path: '/invoices',
        render: 'table',
        read_only: true,
        mock: [
          { no: 'INV-001', client: 'Acme', amount: 1200, status: 'Paid' },
          { no: 'INV-002', client: 'Globex', amount: 800, status: 'Sent' },
        ],
      },
    ],
    use_mock: true,
  },
  {
    id: 'lead-tracker',
    title: 'Lead tracker',
    base_url: 'http://localhost:0',
    tools: [
      {
        name: 'list_leads',
        title: 'List leads',
        description: 'Your sales leads',
        method: 'GET',
        path: '/leads',
        render: 'table',
        read_only: true,
        mock: [
          { name: 'Jane Doe', source: 'Referral', stage: 'New' },
          { name: 'Sam Lee', source: 'Website', stage: 'Contacted' },
        ],
      },
    ],
    use_mock: true,
  },
];

export function Discover({ onInstalled, styles }: DiscoverProps): ReactElement {
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const install = (m: ConnectorManifest): void => {
    saveConnector(m);
    onInstalled(m);
    setMsg(`Installed "${m.title}" — it's now in Your tools, running on your machine.`);
  };

  const installPaste = (): void => {
    try {
      const m = importConnector(paste.trim());
      onInstalled(m);
      setPaste('');
      setMsg(`Installed "${m.title}". Add your key + base URL in the tool to connect your data.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const share = async (m: ConnectorManifest): Promise<void> => {
    const def = exportConnector(m);
    try {
      await navigator.clipboard.writeText(def);
      setMsg(`Copied "${m.title}" definition to clipboard — send it to anyone. No keys or data included.`);
    } catch {
      setMsg(def); // clipboard blocked — show the definition to copy manually
    }
  };

  const mine = loadConnectors();

  return (
    <div className={styles.discover}>
      <h1 className={styles.discoverTitle}>Discover</h1>
      <p className={styles.discoverSub}>
        Tools one-person companies share. Install one — it runs locally on
        <strong> your</strong> data and keys. Only the tool definition travels, never data.
      </p>

      <div className={styles.discoverSection}>Your tools — share a definition</div>
      <div className={styles.discoverGrid}>
        {mine.map((m) => (
          <div key={m.id} className={styles.discoverCard}>
            <div className={styles.discoverCardName}>{m.title}</div>
            <div className={styles.discoverCardMeta}>{m.tools.length} tool(s)</div>
            <button type="button" className={styles.discoverShare} onClick={() => void share(m)}>
              Share
            </button>
          </div>
        ))}
      </div>

      <div className={styles.discoverSection}>From the commons — install</div>
      <div className={styles.discoverGrid}>
        {COMMONS.map((m) => (
          <div key={m.id} className={styles.discoverCard}>
            <div className={styles.discoverCardName}>{m.title}</div>
            <div className={styles.discoverCardMeta}>{m.tools.length} tool(s)</div>
            <button type="button" className={styles.discoverInstall} onClick={() => install(m)}>
              Install
            </button>
          </div>
        ))}
      </div>

      <div className={styles.discoverPaste}>
        <div className={styles.discoverPasteLabel}>Got a shared tool definition? Paste it:</div>
        <textarea
          className={styles.discoverPasteBox}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder='{"id":"my-tool","title":"...","tools":[...]}'
          rows={4}
        />
        <button
          type="button"
          className={styles.discoverInstall}
          onClick={installPaste}
          disabled={!paste.trim()}
        >
          Install from definition
        </button>
      </div>

      {msg && <div className={styles.discoverMsg}>{msg}</div>}
    </div>
  );
}
