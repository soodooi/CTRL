// local-apps — connect a local application and read its explicit selection.
//
// The LibreOffice bridge shipped in the bundle and was fully implemented in the
// kernel, but nothing in the product could reach it: bundled connectors are
// deliberately not auto-seeded, and no surface offered to connect one. So both
// "connect a local app" and "operate what I selected in it" were unserved by a
// pipeline that already existed end to end underneath.
//
// A local app connector is read-only here. The user's explicit selection in the
// application is the unit of work — CTRL never scrapes the whole document — and
// the connector reports its own unavailable message when there is no selection
// to read, which is a normal state rather than an error.
// (ADR-004 cap §1 v13; ADR-002 substrate §14.12; ADR-005 irisy §12 v42 U19/U22)

import { invoke } from './bridge';
import { gateInvoke } from './kernel';
import { unavailableFact, type DecisionFact } from './decision-registry';

/** Mirrors `OptionalConnector` in `src-tauri/src/shell/builtin_mcps.rs`. */
export interface LocalAppConnector {
  id: string;
  name: string;
  summary: string;
  connected: boolean;
  /** The application this bridges, when the manifest names one. */
  requires?: string | null;
}

export const listLocalAppConnectors = (): Promise<LocalAppConnector[]> =>
  invoke<LocalAppConnector[]>('list_local_app_connectors');

/** Explicit connect. Returns the kernel's refreshed row, not an assumption. */
export const connectLocalApp = (connectorId: string): Promise<LocalAppConnector> =>
  invoke<LocalAppConnector>('connect_local_app', { args: { connectorId } });

/** One row of the connector's declared record shape. */
export interface LocalAppSelectionRow {
  document_id?: string;
  document_type?: string;
  revision?: string;
  selection_kind?: string;
  target?: string;
  content?: string;
  formulas?: string;
  content_hash?: string;
}

interface SourceQueryResult {
  rows?: LocalAppSelectionRow[];
  match_count?: number;
}

/** Read the explicit selection through the governed generic connector verb. */
export async function readLocalAppSelection(
  sourceId: string,
): Promise<LocalAppSelectionRow[]> {
  const result = await gateInvoke<SourceQueryResult>(
    'source_query',
    { source_id: sourceId },
    // Name the connector being addressed. Holding the `source` domain authorizes
    // no connector, so a read of THIS app must not carry authority over any
    // other installed connector. (ADR-002 substrate §17.5 v85)
    `source,source:${sourceId}`,
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

export interface SelectionFact {
  label: string;
  value: string;
}

const MAX_PREVIEW = 400;

/** Rows -> the facts to show. Pure, so the truncation and the "which fields are
 *  present" decisions are testable without a live LibreOffice. */
export function localAppSelectionFacts(rows: LocalAppSelectionRow[]): SelectionFact[] {
  const row = rows[0];
  if (!row) return [];
  const facts: SelectionFact[] = [];
  const push = (label: string, value: string | undefined): void => {
    // An absent field is omitted, never rendered as an empty or invented value.
    if (typeof value === 'string' && value.length > 0) facts.push({ label, value });
  };
  push('Document', row.document_id);
  push('Type', row.document_type);
  push('Selection', row.selection_kind);
  push('Target', row.target);
  push('Revision', row.revision);
  push('Content hash', row.content_hash);
  if (typeof row.content === 'string' && row.content.length > 0) {
    facts.push({
      label: 'Selected content',
      // Bounded so a large range cannot push the rest of the facts off screen.
      // The truncation is visible rather than silent.
      value:
        row.content.length > MAX_PREVIEW
          ? `${row.content.slice(0, MAX_PREVIEW)}… (${row.content.length} characters)`
          : row.content,
    });
  }
  push('Selected formulas', row.formulas);
  return facts;
}

/** No selection is a normal state with a real recovery: make one and retry. The
 *  reason comes from the connector's own `unavailable_message` when the kernel
 *  supplied one. */
export function localAppUnavailableFact(
  connector: LocalAppConnector,
  reason: string,
): DecisionFact {
  return unavailableFact({
    id: `local-app:${connector.id}`,
    subject: `${connector.name} has nothing selected to read.`,
    target: connector.requires ?? connector.name,
    reason,
    retryable: true,
  });
}
