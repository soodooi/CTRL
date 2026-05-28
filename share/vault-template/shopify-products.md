---
title: Shopify Products
keycaps: [ctrl.builtin.shopify-publish, ctrl.builtin.amazon-publish, ctrl.builtin.translate, ctrl.builtin.clipboard-ai-rewrite]
schema:
  - { key: sku, label: SKU, type: text }
  - { key: title, label: Title, type: text }
  - { key: price, label: Price, type: number, min: 0 }
  - { key: stock, label: Stock, type: number, min: 0 }
  - { key: status, label: Status, type: select, options: [draft, published, archived] }
  - { key: tags, label: Tags, type: tags }
---

| SKU       | Title                            | Price | Stock | Status    | Tags                   |
|-----------|----------------------------------|-------|-------|-----------|------------------------|
| TEE-001   | Linen Tee — Sand                 | 39    | 120   | published | apparel, summer        |
| TEE-002   | Linen Tee — Charcoal             | 39    | 80    | published | apparel, basics        |
| MUG-014   | Ceramic Mug — 12oz Stone         | 18    | 240   | draft     | home, ceramics         |
| BAG-007   | Canvas Tote — Natural            | 24    | 60    | published | bags, summer           |
| HAT-003   | Bucket Hat — Olive               | 28    | 0     | archived  | apparel, summer, hat   |
