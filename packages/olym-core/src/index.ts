// @manidala/olym-core — generic AI-native framework primitives.
//
// Per ADR-002 v1.1.0 §1.4 + §C3. olym-core stays vendor-agnostic; concrete
// entity ontologies live in host-specific domain packages (e.g.
// @<host>/domain (host package)) which call registerDomain(...) at boot to wire their
// entities into the MCP tool surface.
//
// What's IN this package:
//   - Drizzle column factories (idCol / tsCols / softDeleteCols)
//   - Zod field templates (ulidField / epochMsField / softDeleteFields)
//   - MCP auto-register utility (registerEntity / registerDomain)
//   - 5 read-only MCP tools per entity, auto-derived from per-field .describe()
//
// What's NOT in this package:
//   - Concrete entity ontologies (Product / Order / Customer / etc) — host-specific
//   - Persona enum values — host-specific (e.g. @<host>/domain (host package) defines its 4)
//   - LogicalD1 names + D1_BINDING_MAP — host-specific (per-project D1 layout)
//   - SupplierPort / CommerceAdapter / LLMPort / AuthPort / StoragePort — see @manidala/olym-runtime
//   - Hono router scaffolding — see @manidala/olym-runtime
//   - RBAC middleware — see @manidala/olym-runtime

export * from './ontology/_helpers.js'
export * from './mcp/auto-register.js'
