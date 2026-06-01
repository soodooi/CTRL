#!/usr/bin/env node
/**
 * Pre-push check (diff-aware): detect Chinese (CJK) characters in NEW lines.
 *
 * Default behavior: scan only lines added in this push. Pre-existing CJK is
 * counted as "legacy debt" (informational, non-blocking).
 *
 * Env overrides:
 *   FULL_SCAN=1          — scan whole tree (periodic audit mode)
 *   CHINESE_ALLOWED_DIRS — comma-separated list of repo-relative path prefixes
 *                          where CJK is allowed (e.g., "i18n/zh,locales/zh")
 *   CHINESE_ALLOWED_FILES — comma-separated list of basenames where CJK is
 *                            allowed (e.g., "translate.js,zh-CN.json")
 *
 * Customize for your project: extend isAllowedChineseLine() with project-
 * specific allow patterns (e.g., DB column names, version strings).
 */

import { readFileSync, statSync, existsSync, readdirSync } from 'fs'
import { join, resolve, extname, relative, basename } from 'path'
import { execSync } from 'node:child_process'

const ROOT = resolve(process.cwd())
const FULL_SCAN = process.env.FULL_SCAN === '1'

const CHINESE_RE = /[一-鿿]/
const CODE_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.jsx', '.vue', '.css', '.html', '.cjs', '.mjs', '.toml', '.json', '.sql', '.go', '.py', '.rs', '.java', '.kt'])
const SKIP_DIRS = new Set(['node_modules', '.wrangler', 'dist', 'build', '.git', '.olym', 'lib'])

const CHINESE_ALLOWED_DIRS = (process.env.CHINESE_ALLOWED_DIRS || '').split(',').filter(Boolean)
const CHINESE_ALLOWED_FILES = new Set((process.env.CHINESE_ALLOWED_FILES || '').split(',').filter(Boolean))

function isAllowedChineseLine(line) {
  const trimmed = line.trim()
  // Regex pattern definition: `[一-龥]` etc — these define CJK matchers themselves
  if (trimmed.includes('[一-龥]') || trimmed.includes('[\\u4e00')) return true
  // package.json metadata
  if (trimmed.startsWith('"version"') || trimmed.startsWith('"name"')) return true
  return false
}

function isCodeFile(p) {
  if (!CODE_EXTENSIONS.has(extname(p))) return false
  if (CHINESE_ALLOWED_FILES.has(basename(p))) return false
  if (p.includes('package-lock.json') || p.includes('pnpm-lock.yaml') || p.includes('yarn.lock')) return false
  const rel = p.replace(/\\/g, '/')
  if (CHINESE_ALLOWED_DIRS.some(d => rel.startsWith(d))) return false
  if (/\blib\//.test(rel)) return false
  return true
}

function getPushRange() {
  if (FULL_SCAN) return null
  try {
    const upstream = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const range = `${upstream}..HEAD`
    execSync(`git rev-list --count ${range}`, { stdio: 'ignore' })
    return range
  } catch {
    return null
  }
}

function getChangedLines(range) {
  // Map of file -> Set of newly-added line contents in this push
  const map = new Map()
  if (!range) return map
  let diff
  try {
    diff = execSync(`git diff --unified=0 ${range}`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  } catch {
    return map
  }
  let currentFile = null
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/)
    if (fileMatch) {
      currentFile = fileMatch[1]
      if (!map.has(currentFile)) map.set(currentFile, new Set())
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++') && currentFile) {
      map.get(currentFile).add(line.slice(1))
    }
  }
  return map
}

function walk(dir, files = []) {
  if (SKIP_DIRS.has(basename(dir))) return files
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return files }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, files)
    else if (isCodeFile(p)) files.push(p)
  }
  return files
}

const range = getPushRange()
const changedLines = getChangedLines(range)

let newViolations = []
let legacyDebtCount = 0

if (FULL_SCAN || changedLines.size === 0) {
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    let content
    try { content = readFileSync(file, 'utf8') } catch { continue }
    content.split('\n').forEach((line, i) => {
      if (CHINESE_RE.test(line) && !isAllowedChineseLine(line)) {
        if (FULL_SCAN) newViolations.push({ file: rel, line: i + 1, code: line.trim().substring(0, 100) })
        else legacyDebtCount++
      }
    })
  }
} else {
  for (const [file, lines] of changedLines.entries()) {
    if (!isCodeFile(file)) continue
    for (const line of lines) {
      if (CHINESE_RE.test(line) && !isAllowedChineseLine(line)) {
        newViolations.push({ file, code: line.trim().substring(0, 100) })
      }
    }
  }
}

if (newViolations.length === 0) {
  console.log('[OK] No newly added CJK characters in this push.')
  if (legacyDebtCount > 0) {
    console.log(`Legacy debt: ${legacyDebtCount} pre-existing CJK line(s) in repo (informational).`)
  }
  process.exit(0)
} else {
  console.error(`[BLOCKED] ${newViolations.length} CJK violation(s) in newly added lines:`)
  for (const v of newViolations.slice(0, 20)) {
    console.error(`  ${v.file}${v.line ? ':' + v.line : ''}: ${v.code}`)
  }
  if (newViolations.length > 20) console.error(`  ... and ${newViolations.length - 20} more`)
  console.error('\nPolicy: code (incl. comments / UI text / API responses) must be English.')
  console.error('Override: set CHINESE_ALLOWED_DIRS or CHINESE_ALLOWED_FILES env if needed.')
  process.exit(1)
}
