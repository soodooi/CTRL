// Entity ontology shared helpers.
//
// Every entity uses ULID id + epoch-ms timestamps. Extracting these here
// keeps each entity file focused on its DOMAIN fields + describe() metadata,
// not boilerplate. Drift is no longer possible (would be a compile error).

import { integer, text } from 'drizzle-orm/sqlite-core'
import { ulid } from 'ulidx'
import { z } from 'zod'

// ---- Drizzle column factories ------------------------------------------

/** Standard ULID primary key. */
export const idCol = () => text('id').primaryKey().$defaultFn(() => ulid())

/** Standard timestamp pair (created_at + updated_at, NOT NULL, epoch ms). */
export const tsCols = () => ({
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

/** Soft-delete tail (created_at + updated_at + nullable deleted_at). */
export const softDeleteCols = () => ({
  ...tsCols(),
  deleted_at: integer('deleted_at'),
})

// ---- Zod field templates -----------------------------------------------

/** Optional ULID input — auto-generated if omitted. */
export const ulidField = z
  .string()
  .min(1)
  .optional()
  .describe('Entity id (ULID format). Auto-generated if omitted.')

/** Optional epoch-ms timestamp — auto-set if omitted. */
export const epochMsField = z
  .number()
  .int()
  .optional()
  .describe('Unix epoch milliseconds. Auto-set on insert if omitted.')

/** Standard timestamp pair as a Zod object spread. */
export const tsFields = {
  created_at: epochMsField,
  updated_at: epochMsField,
} as const

/** Soft-delete tail as a Zod object spread. */
export const softDeleteFields = {
  ...tsFields,
  deleted_at: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Unix epoch ms of soft-delete. NULL = active row.'),
} as const
