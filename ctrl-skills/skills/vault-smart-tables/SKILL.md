---
name: vault-smart-tables
description: >
  Create and manage structured data tables (smart tables) in the CTRL vault —
  field types, reference/relation fields between tables, views, and querying.
  Use when the user asks to create a table, base, CRM, tracker, inventory, or
  any structured dataset in the vault, or when linking tables together.
version: 1.1.0
author: CTRL
metadata:
  hermes:
    tags: [ctrl, vault, smart-table, database, crm, base]
---

# Vault Smart Tables

Smart tables are markdown files with a YAML `schema` in the frontmatter and a
pipe-table body. They live under `tables/` in the vault and are queryable via
`smart_table_describe` + `smart_table_query`.

## When to use

- User asks to "build a CRM / tracker / inventory / base" in the vault
- User wants linked/related tables (e.g. Deals → Contacts)
- User wants to query, filter, or sort existing table data
- User wants to add a field, change a type, or wire a relation to an existing table

## Requirements first — propose, don't demand a spec

A real user asks vaguely ("build me a CRM", "track my job applications"). They
will NOT hand you fields, types, and relations — that is YOUR job. Do NOT reply
with a blank questionnaire asking them to list every column either. Instead:

1. **Propose a sensible structure from domain knowledge.** Name the table(s),
   their key fields (with types), and the relations. For a CRM that is
   `Contacts (name, company, email)` + `Deals (name, amount, stage, contact →
   Contacts)`. If the domain is unfamiliar, RESEARCH it first with `web_search`
   (what does a "<domain> tracker" usually track?) — do not invent blindly.
2. **Ask only the genuinely ambiguous choices — at most 1-2**, each with a
   sensible default, e.g. "Deals usually have a stage — I'll use lead/won/lost
   unless you have your own." Never interrogate; a user should confirm in one
   short reply, not fill a form.
3. **Confirm briefly, then build in ONE `smart_table_base_scaffold` call.** If
   the user already gave a precise spec, skip the proposal and just build.

The goal: the user says three words, you do the thinking, they nod, it exists.

## File structure

Every smart table is one `.md` file under `tables/`:

```yaml
---
title: <Table Title>
schema:
  - { key: <field_key>, label: <Display Label>, type: <type> }
  - { key: <field_key>, label: <Display Label>, type: <type>, <type-specific-opts> }
views:
  - { kind: grid, name: <view name> }
  - { kind: kanban, name: <view name>, group_by: <field_key> }
---
| <Label> | <Label> | ... |
|---|---|---|
| <value> | <value> | ... |
```

The body is a standard markdown pipe table. Column order in the body must match
the schema field order. One row = one record.

## Field types

| type | extra keys | notes |
|------|-----------|-------|
| text | — | plain string |
| number | — | numeric |
| currency | symbol: "$" | displays with currency symbol |
| select | options: [a, b, c] | dropdown |
| date | — | date value |
| rating | max: 5 | star rating 1..max |
| url | — | URL/link |
| reference | table: \<path\>.md, display: \<key\> | **relation to another table** |

### Lookup fields (derived)

A `lookup` field pulls a value from a referenced record through a reference field:

```yaml
- { key: name, label: Name, type: lookup, via: stock_ref, target: name }
```

- `via` = the reference field key on this table
- `target` = the field key to pull from the referenced record

## Reference fields (linking tables) — critical syntax

To create a relation between two tables, use `type: reference` with `table`
and `display`:

```yaml
- { key: contact, label: Contact, type: reference, table: crm/contacts.md, display: name }
```

Rules:
- `table` is **relative to the vault root** (e.g. `crm/contacts.md`, not
  `../crm/contacts.md` or `tables/crm/contacts.md`).
- `display` is the field key from the target table to show (e.g. `name`).
- In the table body, put the display value of the referenced row (e.g. `Jane Doe`).
- `smart_table_describe` shows `type: "text"` for the field in its `fields`
  array, but populates the `relations` array with
  `{ field_key, kind: "reference", target_table, display }` — **check
  `relations`, not `fields`, to confirm a reference was recognized.**

### Pitfall: wrong syntax silently fails

`type: link` + `link_to: <Table>` is **not valid**. The field will be silently
treated as plain text with no relation. Always use `type: reference` +
`table: <path>.md` + `display: <key>`.

## Multi-table bases

A "base" (like a CRM) is multiple smart table files in a subdirectory under
`tables/`, with reference fields wiring them together:

```
tables/
  crm/
    contacts.md   ← name, company, email
    deals.md      ← contact field: type: reference, table: crm/contacts.md, display: name
```

### Build a linked base in ONE call — `smart_table_base_scaffold`

**Do NOT hand-create the tables one by one.** The gate has a dedicated tool that
builds the whole multi-sheet base (all tables + the reference relations + the
`_base.md` manifest) in a single atomic call:

```
smart_table_base_scaffold(
  base_name: "CRM",
  tables: [
    { name: "Deals", fields: [
        { key: "name",    label: "Deal",    type: "text" },
        { key: "amount",  label: "Amount",  type: "currency" },
        { key: "stage",   label: "Stage",   type: "select", options: ["lead","won","lost"] },
        { key: "contact", label: "Contact", link_to: "Contacts", display: "name" }
    ]},
    { name: "Contacts", fields: [
        { key: "name",    label: "Name",    type: "text" },
        { key: "company", label: "Company", type: "text" },
        { key: "email",   label: "Email",   type: "url" }
    ]}
  ]
)
```

Key points:
- **`link_to: "<other table's name>"`** on a field makes it a REFERENCE (relation)
  to that table — the tool resolves the path itself. Do NOT set `type`, `table`,
  or `display` by hand for a link field; just `link_to` (+ optional `display`,
  the target field to show, default `name`). Order of tables does not matter —
  links resolve across the whole spec.
- It creates `tables/<base>/<slug>.md` per table + `tables/<base>/_base.md`
  (the base manifest). The base then opens in the Tables workspace with a tab
  per data-table.
- **One call, no ordering, no hand-written frontmatter** — this is the ONLY way
  you should build a related-table base. It cannot fail on frontmatter shape.

Then:
1. **Verify with `smart_table_describe`** on a table — check the `relations`
   array is populated (not just `fields`).
2. **Seed rows** with `smart_table_append_row` / `smart_table_batch_append_rows`.

## Querying

- `smart_table_describe(path)` — returns `fields`, `operators`, and
  `relations`. **Always call this first** to understand a table's structure
  before querying or editing.
- `smart_table_query(path)` — returns all rows as JSON objects. Supports
  `filters`, `sort`, `group_by`, `limit`, `conjunction`.

Path argument for both tools is relative to vault root (e.g.
`tables/crm/deals.md`).

## Views

- `grid` — standard spreadsheet view. Always include one as default.
- `kanban` — grouped by a select field; requires `group_by: <field_key>`.

## Creating & editing tables — use the smart_table tools, NEVER hand-write

Smart-table files have structured frontmatter (schema arrays, relations, views).
**Do NOT create them with `write_file` or `vault_write`** — hand-writing the YAML
is exactly what triggers `"frontmatter must be a JSON object"` and can clobber
sibling files. Use the gate's smart_table tools; they own the on-disk format:

| Goal | Tool |
|------|------|
| Build a linked multi-table BASE (CRM, tracker, inventory…) | **`smart_table_base_scaffold`** (one call — see above) |
| Create ONE standalone table | `smart_table_create(name, fields:[{key,label,type,options?}])` |
| Add a row / rows | `smart_table_append_row` / `smart_table_batch_append_rows` |
| Set a cell, add/change/drop a field, add a relation | `smart_table_produce(path, op)` — one typed verb (`op` = set_cell / upsert_rows / delete_rows / add_field{…,relation?} / update_field / delete_field) |
| Read structure / rows | `smart_table_describe` / `smart_table_query` |

The frontmatter shown in "File structure" above is the on-disk RESULT of these
tools — read it to understand the model, not to hand-write. If you ever feel the
urge to `write_file` a table, stop and pick the matching tool from this table.

## Real examples in this vault

| file | what it demonstrates |
|------|---------------------|
| `tables/stocks-positions.md` | reference + lookup field (pulls name from Watchlist) |
| `tables/stocks-watchlist.md` | two reference fields (sector + theme) |

(Call `smart_table_describe` on one of these to see a real `relations` array
before building your own. To build a NEW base, use `smart_table_base_scaffold`
— do not copy these files by hand.)

See `references/field-syntax-examples.md` for full frontmatter excerpts of
these tables, and `templates/linked-two-table-base.md` for a copy-ready
scaffold.
