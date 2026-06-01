// MCP auto-register — derives 5 read-only tools per entity from the entity ontology.
//
// Per ADR-003 frontend §11. Each entity emits 5 read-only MCP tools, each with a
// PER-VERB input schema (not the entity's insert/select schema verbatim):
//
//   - mcp_<entity>_get      → { id }
//   - mcp_<entity>_list     → { filter?, limit?, cursor? }
//   - mcp_<entity>_search   → { query, limit?, cursor? }
//   - mcp_<entity>_count    → { filter? }
//   - mcp_<entity>_describe → {}  (no input)
//
// The MCP server (logos repo) consumes these definitions; the host worker
// implements the actual D1 query for each verb.

import { z } from 'zod'

// Loose Zod typing — drizzle-zod 0.5 returns ZodObject with "~standard" /
// "~validate" metadata symbols that don't structurally match z.ZodType<T>.
// We only need the parse contract at the MCP host boundary.
export type ZodLikeSchema = {
  parse: (data: unknown) => unknown
  safeParse: (data: unknown) => { success: boolean; data?: unknown; error?: unknown }
}

export interface EntityOntology {
  description: string
  insert: ZodLikeSchema
  select: ZodLikeSchema
}

export interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: ZodLikeSchema
}

export interface RegisterEntityInput {
  entityName: string
  ontology: EntityOntology
}

// ---- Per-verb input schemas --------------------------------------------

// Used by `_get` — minimal id-only input.
const getInputSchema = z.object({
  id: z.string().min(1).describe('Entity id (ULID).'),
})

// Used by `_list` and `_count` — partial filter + pagination.
const listInputSchema = z.object({
  filter: z
    .record(z.unknown())
    .optional()
    .describe('Field-level filter map. Keys must match entity columns. Empty = all rows.'),
  limit: z.number().int().min(1).max(500).optional().default(50).describe('Page size, 1-500.'),
  cursor: z.string().nullable().optional().describe('Opaque pagination cursor from prior call.'),
})

const countInputSchema = z.object({
  filter: z.record(z.unknown()).optional(),
})

// Used by `_search` — full-text query + pagination.
const searchInputSchema = z.object({
  query: z.string().min(1).describe('Full-text query string.'),
  limit: z.number().int().min(1).max(500).optional().default(50),
  cursor: z.string().nullable().optional(),
})

// Used by `_describe` — no input.
const describeInputSchema = z.object({})

// ---- Tool derivation ---------------------------------------------------

// 5 read-only tools per entity (per ADR-003 frontend §11.2):
//   mcp_<entity>_get      — by id
//   mcp_<entity>_list     — with Zod-validated filter
//   mcp_<entity>_search   — full-text
//   mcp_<entity>_count    — with filter
//   mcp_<entity>_describe — return schema as MCP-readable JSON
export function deriveReadOnlyTools(input: RegisterEntityInput): MCPToolDefinition[] {
  const { entityName, ontology } = input

  return [
    {
      name: `mcp_${entityName}_get`,
      description: `Get one ${entityName} by id. ${ontology.description}`,
      inputSchema: getInputSchema as ZodLikeSchema,
    },
    {
      name: `mcp_${entityName}_list`,
      description: `List ${entityName} rows with optional filter + pagination. ${ontology.description}`,
      inputSchema: listInputSchema as ZodLikeSchema,
    },
    {
      name: `mcp_${entityName}_search`,
      description: `Full-text search across ${entityName}. ${ontology.description}`,
      inputSchema: searchInputSchema as ZodLikeSchema,
    },
    {
      name: `mcp_${entityName}_count`,
      description: `Count ${entityName} rows matching filter. ${ontology.description}`,
      inputSchema: countInputSchema as ZodLikeSchema,
    },
    {
      name: `mcp_${entityName}_describe`,
      description: `Return ${entityName} schema as JSON Schema. No input needed. ${ontology.description}`,
      inputSchema: describeInputSchema as ZodLikeSchema,
    },
  ]
}

// In-memory registry — logos repo MCP server consumes this when initializing.
// Module singleton — tests must call clearRegistry() in beforeEach.
const REGISTRY = new Map<string, MCPToolDefinition[]>()

export function registerEntity(input: RegisterEntityInput): void {
  const tools = deriveReadOnlyTools(input)
  REGISTRY.set(input.entityName, tools)
}

export function getRegisteredTools(): MCPToolDefinition[] {
  return Array.from(REGISTRY.values()).flat()
}

export function getEntityTools(entityName: string): MCPToolDefinition[] {
  return REGISTRY.get(entityName) ?? []
}

/** Test-only — call in beforeEach to isolate registry between tests. */
export function clearRegistry(): void {
  REGISTRY.clear()
}

// ---- Domain registration ----------------------------------------------
//
// Host applications (host / iris / pandagooo / etc.) own a "domain":
// a named bundle of entity ontologies. olym-core exposes registerDomain()
// so each host registers its full set in one call instead of N
// registerEntity() calls. The returned DomainRegistry provides counts +
// tool list for diagnostic logging at boot time.

export interface RegisterDomainInput {
  // Domain identifier — host application name (e.g. 'host', 'iris').
  // Per ADR-003 frontend §C3 — distinguishes which project's entities are loaded
  // when an MCP server hosts multiple instances.
  name: string
  // Map of entityName → EntityOntology. Each entity gets 5 MCP tools.
  entities: Record<string, EntityOntology>
}

export interface DomainRegistry {
  name: string
  entityCount: number
  toolCount: number
  tools: MCPToolDefinition[]
}

export function registerDomain(input: RegisterDomainInput): DomainRegistry {
  const tools: MCPToolDefinition[] = []
  for (const [entityName, ontology] of Object.entries(input.entities)) {
    registerEntity({ entityName, ontology })
    tools.push(...getEntityTools(entityName))
  }
  return {
    name: input.name,
    entityCount: Object.keys(input.entities).length,
    toolCount: tools.length,
    tools,
  }
}
