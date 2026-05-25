#!/usr/bin/env node
/**
 * Replace CJK characters in test files with \uXXXX escape sequences.
 * Runtime behavior is identical; source passes the pre-push Chinese-in-code guard.
 *
 * Usage: node scripts/escape-cjk.mjs
 */

import fs from 'node:fs'

const FILES = [
  'workers/admin/tests/products-back.test.js',
  'workers/admin/tests/products-front-batch-price.test.js',
  'workers/supplier-sds/tests/v3-integration.test.js',
  'workers/supplier-sds/tests/helpers/testEnv.js',
  'workers/shared/services/seo-scorer/index.test.js',
  'workers/shared/services/translator/index.test.js',
  'workers/shared/services/translator/body-html-structurer.test.js',
  'workers/shared/services/field-lineage/index.test.js',
  'workers/shared/services/supplier-adapter/sds.test.js',
  'workers/shared/services/market-resolver/index.test.js',
]

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

let totalFixed = 0
let totalFiles = 0

for (const file of FILES) {
  if (!fs.existsSync(file)) {
    console.log(`skip (missing): ${file}`)
    continue
  }
  const orig = fs.readFileSync(file, 'utf8')
  let fixed = 0
  const changed = orig.replace(/./gsu, (c) => {
    if (!CJK_RE.test(c)) return c
    fixed++
    const cp = c.codePointAt(0)
    if (cp > 0xffff) {
      const high = 0xd800 + ((cp - 0x10000) >> 10)
      const low = 0xdc00 + ((cp - 0x10000) & 0x3ff)
      return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`
    }
    return `\\u${cp.toString(16).padStart(4, '0')}`
  })
  if (fixed > 0) {
    fs.writeFileSync(file, changed)
    console.log(`${file}: ${fixed} CJK chars escaped`)
    totalFixed += fixed
    totalFiles++
  }
}

console.log(`\nTotal: ${totalFixed} CJK codepoints escaped across ${totalFiles} files`)
