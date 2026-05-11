# @manidala/olym-core

Generic AI-native framework primitives — Drizzle column factories, Zod field templates, and MCP auto-register utility. Framework-only; concrete entity ontologies live in host-specific domain packages.

## Install

```bash
npm install @manidala/olym-core
```

## What's in this package

```
src/
├── ontology/_helpers.ts   — Drizzle column factories (idCol / tsCols / softDeleteCols)
│                            + Zod field templates (ulidField / epochMsField / softDeleteFields)
├── mcp/auto-register.ts   — registerEntity / registerDomain — derives 5 read-only MCP tools per entity
└── index.ts               — re-exports the above
```

## What's NOT in this package

- Concrete entity ontologies (Product / Order / Customer / etc.) — host-specific, define in your own `<your-project>-domain` package
- Persona enum values — host-specific
- LogicalD1 binding names + map — host-specific (per-project D1 layout)
- Adapter ports (LLM / Supplier / Commerce / Auth / Storage) — see `@manidala/olym-runtime`
- Hono router scaffolding — see `@manidala/olym-runtime`
- RBAC middleware — see `@manidala/olym-runtime`

## Quick start

Define a host-specific entity using the column factories:

```ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { idCol, softDeleteCols, softDeleteFields, ulidField } from '@manidala/olym-core'

export const products = sqliteTable(
  'products',
  {
    id: idCol(),
    name: text('name').notNull(),
    status: text('status', { enum: ['draft', 'active'] as const }).notNull().default('draft'),
    ...softDeleteCols(),
  },
  (table) => ({
    idx_status: index('idx_products_status').on(table.status),
  })
)

export const SelectProduct = createSelectSchema(products)

export const productOntology = {
  description: 'Product entity — host-defined.',
  insert: z.object({
    id: ulidField,
    name: z.string().min(1).describe('Display name.'),
    status: z.enum(['draft', 'active']).default('draft').describe('Lifecycle.'),
    ...softDeleteFields,
  }),
  select: SelectProduct,
} as const
```

Register it via `registerDomain()` for MCP tool auto-derivation:

```ts
import { registerDomain } from '@manidala/olym-core'
import { productOntology } from './entities/products.js'

const registry = registerDomain({
  name: 'my-project',
  entities: { products: productOntology },
})

console.log(`Registered ${registry.entityCount} entities, ${registry.toolCount} MCP tools`)
// → "Registered 1 entities, 5 MCP tools"
```

Each entity gets 5 read-only MCP tools auto-derived from per-field `.describe()`:

- `mcp_<entity>_get` — by id
- `mcp_<entity>_list` — with filter + pagination
- `mcp_<entity>_search` — full-text query
- `mcp_<entity>_count` — with filter
- `mcp_<entity>_describe` — return schema as JSON

## API

### Drizzle column factories

| Symbol | Returns |
|---|---|
| `idCol()` | `text('id').primaryKey().$defaultFn(() => ulid())` |
| `tsCols()` | `{ created_at, updated_at }` (NOT NULL, epoch ms) |
| `softDeleteCols()` | `{ created_at, updated_at, deleted_at }` (deleted_at nullable) |

### Zod field templates

| Symbol | Type |
|---|---|
| `ulidField` | optional ULID string, auto-generated if omitted |
| `epochMsField` | optional integer epoch ms, auto-set if omitted |
| `tsFields` | `{ created_at, updated_at }` Zod object spread |
| `softDeleteFields` | `{ created_at, updated_at, deleted_at }` |

### MCP auto-register

| Symbol | Purpose |
|---|---|
| `registerEntity({ entityName, ontology })` | Register one entity (5 tools generated) |
| `registerDomain({ name, entities })` | Bulk register many entities, returns `DomainRegistry` |
| `getRegisteredTools()` | All registered tools across all entities |
| `getEntityTools(name)` | Tools for one entity |
| `clearRegistry()` | Test-only — call in `beforeEach` |
| `deriveReadOnlyTools(input)` | Pure derivation without registering |

## License

All Rights Reserved — see [LICENSE](../../LICENSE) at repo root.
