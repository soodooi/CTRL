# Field Syntax Examples

Real frontmatter excerpts from tables in this vault. Use these as authoritative
syntax references — they are confirmed working.

## Simple table: Contacts

`tables/crm/contacts.md`

```yaml
---
title: Contacts
schema:
  - { key: name, label: Name, type: text }
  - { key: company, label: Company, type: text }
  - { key: email, label: Email, type: url }
views:
  - { kind: grid, name: All contacts }
---
| Name | Company | Email |
|---|---|---|
| Jane Doe | Acme Corp | jane@acme.com |
| John Roe | Globex | john@globex.com |
```

## Reference field: Deals → Contacts

`tables/crm/deals.md`

```yaml
---
title: Deals
schema:
  - { key: name, label: Deal, type: text }
  - { key: amount, label: Amount, type: currency }
  - { key: stage, label: Stage, type: select, options: [lead, proposal, negotiation, won, lost] }
  - { key: contact, label: Contact, type: reference, table: crm/contacts.md, display: name }
  - { key: score, label: Score, type: rating, max: 5 }
views:
  - { kind: grid, name: All deals }
  - { kind: kanban, name: By stage, group_by: stage }
---
| Deal | Amount | Stage | Contact | Score |
|---|---|---|---|---|
| Acme Corp | 12000 | won | Jane Doe | 5 |
| Globex | 8000 | lead | John Roe | 3 |
| Initech | 5000 | lost |  | 2 |
```

Note: the `contact` column in the body holds the **display value** (`Jane Doe`),
not a row ID or key. Empty cell = no reference.

## Reference + Lookup: Stocks Positions → Watchlist

`tables/stocks-positions.md`

```yaml
---
schema:
- key: stock
  label: Stock
  type: text
- key: cost
  label: Cost
  type: number
- key: qty
  label: Qty
  type: number
- key: pnl_pct
  label: PnL %
  type: number
- key: weight
  label: Weight %
  type: number
- display: name
  key: stock_ref
  label: Stock ref
  table: stocks-watchlist.md
  type: reference
- key: name
  label: Name
  target: name
  type: lookup
  via: stock_ref
title: Stocks Positions
---
```

The `stock_ref` field references `stocks-watchlist.md` and displays its `name`
field. The `name` lookup field pulls the `name` value from the record that
`stock_ref` points to, via `via: stock_ref` + `target: name`.

## Two reference fields: Stocks Watchlist

`tables/stocks-watchlist.md`

```yaml
---
schema:
- key: code
  label: Code
  type: text
- key: name
  label: Name
  type: text
- key: price
  label: Price
  type: number
# ... more number fields ...
- display: sector
  key: sector
  label: Sector
  table: stocks-sectors.md
  type: reference
- display: theme
  key: theme
  label: Theme
  table: stocks-themes.md
  type: reference
title: Stocks Watchlist
---
```

A table can have multiple reference fields pointing to different tables. Each
needs its own `table` and `display` keys.

## YAML style note

Both inline flow style (`{ key: x, type: y }`) and block style work in the
frontmatter. Inline is more compact for single-field definitions; block style
is clearer when a field has many options. Pick one and be consistent within a
file.
