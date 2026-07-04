# Linked Base Template — one `smart_table_base_scaffold` call

Build a whole base (multiple tables + their relations) in ONE call. Do NOT
hand-write the table files. Replace ALLCAPS placeholders with your domain values.

```
smart_table_base_scaffold(
  base_name: "<BASE NAME>",
  tables: [
    {
      name: "<PARENT>",            // e.g. Contacts
      fields: [
        { key: "name",        label: "Name",         type: "text" },
        { key: "<field_key>",  label: "<Field Label>", type: "<type>" }
      ]
    },
    {
      name: "<CHILD>",            // e.g. Deals
      fields: [
        { key: "name",     label: "<Child Label>", type: "text" },
        // A LINK field: link_to = the other table's NAME. The tool wires the
        // reference + resolves the path. Do NOT set type/table/display by hand.
        { key: "<parent>", label: "<Parent Label>", link_to: "<PARENT>", display: "name" },
        { key: "status",   label: "Status",         type: "select", options: ["a","b","c"] }
      ]
    }
  ]
)
```

## Concrete example: CRM

```
smart_table_base_scaffold(
  base_name: "CRM",
  tables: [
    { name: "Contacts", fields: [
        { key: "name",    label: "Name",    type: "text" },
        { key: "company", label: "Company", type: "text" },
        { key: "email",   label: "Email",   type: "url" }
    ]},
    { name: "Deals", fields: [
        { key: "name",    label: "Deal",    type: "text" },
        { key: "amount",  label: "Amount",  type: "currency" },
        { key: "stage",   label: "Stage",   type: "select", options: ["lead","won","lost"] },
        { key: "contact", label: "Contact", link_to: "Contacts", display: "name" }
    ]}
  ]
)
```

Produces `tables/crm/contacts.md`, `tables/crm/deals.md`, and `tables/crm/_base.md`.
The Deals `contact` field becomes `type: reference` pointing at Contacts.

## Verify

1. `smart_table_describe` on `tables/<base>/<child>.md` — the `relations` array
   holds the reference entry.
2. Seed rows with `smart_table_batch_append_rows`.
