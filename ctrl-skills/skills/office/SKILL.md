---
name: office
description: >
  Read and analyze the user's explicit LibreOffice Writer selection or
  multi-cell Calc range through CTRL Companion without reading or changing
  unselected document content.
version: 1.0.0
author: CTRL
metadata:
  hermes:
    tags: [ctrl, office, libreoffice, writer, calc, read-only]
---

# Work with an explicit LibreOffice selection

Use this skill when the user asks about content currently selected in
LibreOffice Writer or Calc. CTRL Companion is a read-only local source behind
the governed `:17873` gate. The user keeps working in LibreOffice; you consume
only the selection they explicitly expose.

## Required read path

1. Call `source_describe` with `source_id: "ctrl-libreoffice"`.
2. Read its fields, operators, and `unavailable_message` before querying.
3. Call `source_query` with `source_id: "ctrl-libreoffice"` and a structured
   query. An empty filter list reads the one currently exposed selection row.
4. Base the answer only on returned fields. Use `document_type`,
   `selection_kind`, `target`, `content`, `formulas`, and `content_hash` to keep
   the result transparent and attributable.

If the source is unavailable, relay the manifest-owned `unavailable_message`
exactly. Do not invent setup steps and do not ask the user for transport
configuration or credentials.

## Selection boundary

Eligible input is deliberately narrow:

- Writer: one explicit, non-empty text selection.
- Calc: one explicit range containing more than one cell.

A collapsed Writer cursor, whole-document request, implicit Calc active cell,
or unselected content is unavailable by design. Ask the user to make an
eligible explicit selection, then retry the same source query. Never infer or
reconstruct content outside the returned target.

## Useful operations

For Writer selections, you may summarize, explain, rewrite, translate, extract
requirements, identify ambiguity, compare terminology, or check internal
consistency. Preserve the user's meaning and distinguish source text from your
suggestions.

For Calc ranges, you may explain values and formulas, compare rows or columns,
identify gaps or inconsistencies, summarize a matrix, or propose checks. Treat
serialized cell values and formulas as the complete available range; do not
assume neighboring cells.

## Red lines

- This skill is read-only. Never call `source_produce` for LibreOffice.
- Never read a whole document, an implicit active cell, or unselected content.
- Never bypass `source_describe` / `source_query` or the `:17873` gate.
- Never request private transport configuration or credentials.
- Never claim a selection was read when the source returned unavailable.

(ADR-001 spine §4 v20; ADR-002 substrate §14 v78; ADR-005 irisy §11 v37; ADR-010 communication § transports v13)
