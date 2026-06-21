// smart-table — the content-type MODULE declaration.
//
// One place that says what this module IS: the content type it renders, which
// vault files it claims, the :17873 kernel gate tools it owns (ADR-002 §14 three
// verbs), and the kernel QuerySource backing it. The platform's viewer registry
// and the vault discovery scan reference THIS instead of scattering the same
// literals across files — so "smart table" is a single declarable thing, not a
// loose pile of registrations.
//
// This is the seed of CTRL's "every capability is an installable module" model
// (project-ctrl-modular-intent-platform). There is no platform module loader
// yet; this is a co-located descriptor the existing registry consumes. Canonical
// capability spec: vault/ctrl/spec-smart-table-capabilities.md.

/** Content type the platform maps to SmartTableViewer. The file on disk stays
 *  plain markdown (vim test); this is a render hint, not a storage format. */
export const SMART_TABLE_CONTENT_TYPE = 'text/x-ctrl-smart-table';

/** A vault file IS a smart table when its frontmatter declares a non-empty
 *  `schema:` block. The single source of that rule for discovery + routing. */
export const isSmartTableFrontmatter = (frontmatter: unknown): boolean => {
  if (!frontmatter || typeof frontmatter !== 'object') return false;
  const schema = (frontmatter as { schema?: unknown }).schema;
  return Array.isArray(schema) && schema.length > 0;
};

export interface SmartTableModule {
  id: string;
  contentType: string;
  /** The :17873 gate tools this module owns (ADR-002 §14: describe / query /
   *  produce). Documents the module's kernel surface in one place. */
  gateTools: readonly string[];
  /** Kernel QuerySource implementing §14 read/produce for this content type. */
  querySource: string;
  /** Canonical capability spec (vault). */
  doc: string;
}

export const smartTableModule: SmartTableModule = {
  id: 'smart-table',
  contentType: SMART_TABLE_CONTENT_TYPE,
  gateTools: [
    'smart_table.describe',
    'smart_table.query',
    'smart_table.update_cell',
    'smart_table.append_row',
    'smart_table.add_view',
    'smart_table.run_ai_column',
  ],
  querySource: 'vault_smart_table::SmartTable',
  doc: 'vault/ctrl/spec-smart-table-capabilities.md',
};
