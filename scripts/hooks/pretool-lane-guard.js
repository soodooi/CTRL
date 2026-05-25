#!/usr/bin/env node
// PreToolUse hook — lane guard for the multi-agent fleet.
//
// Reads tool_input.file_path (Edit / Write / NotebookEdit) and decides:
//   - approve  : worker may write here
//   - block    : path violates lane ownership and not in active handoff
//   - warn     : path is in shared-files warnlist (allowed but flagged)
//
// Resolution order (per .olym/steering/lane-ownership.yaml comments):
//   1. Not a write tool        → approve (defer to other hooks)
//   2. cwd has no .lane file   → approve (zeus, no restriction)
//   3. denylist_explicit hit   → block
//   4. allowlist hit           → approve
//   5. my lane ownership hit   → approve
//   6. active handoff (assigned to my lane) touches[] hit → approve
//   7. warnlist hit            → approve + emit warning
//   8. fall-through            → block (or warn during observation period)
//
// Observation mode:
//   Set OBSERVE_ONLY=1 in env.OBSERVE_LANE_GUARD or read first line of
//   `.lane-guard-mode` file (values: "warn" | "block"). Default: "warn"
//   for the first 2 weeks, switch to "block" after stability check.
//
// Spec: .olym/specs/multi-agent-fleet/spec.md §8

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const REPO = process.cwd()
const LANE_FILE = join(REPO, '.lane')
const OWNERSHIP = join(REPO, '.olym/steering/lane-ownership.yaml')
const HANDOFF_DIR = join(REPO, '.olym/handoffs')
const MODE_FILE = join(REPO, '.lane-guard-mode')

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({ decision, reason: reason || '' }))
  process.exit(0)
}

function readMode() {
  if (process.env.OBSERVE_LANE_GUARD === '1') return 'warn'
  if (existsSync(MODE_FILE)) {
    const m = readFileSync(MODE_FILE, 'utf8').trim().toLowerCase()
    if (m === 'block' || m === 'warn') return m
  }
  return 'warn' // default during observation period
}

function readMyLane() {
  if (!existsSync(LANE_FILE)) return null
  return readFileSync(LANE_FILE, 'utf8').trim() || null
}

function globToRegex(glob) {
  // Minimal glob → regex: ** = any path segments incl. /, * = any non-/, ? = single char
  let r = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      r += '.*'
      i++
      // Skip the / that often follows **
      if (glob[i + 1] === '/') i++
    } else if (c === '*') {
      r += '[^/]*'
    } else if (c === '?') {
      r += '[^/]'
    } else if ('.+()[]{}|^$\\'.includes(c)) {
      r += '\\' + c
    } else {
      r += c
    }
  }
  r += '$'
  return new RegExp(r)
}

function readOwnership() {
  if (!existsSync(OWNERSHIP)) return { lanes: {}, allowlist: [], warnlist: [], denylist_explicit: [], frozen_lanes: new Set() }
  const text = readFileSync(OWNERSHIP, 'utf8')
  const out = { lanes: {}, allowlist: [], warnlist: [], denylist_explicit: [], frozen_lanes: new Set() }

  const lines = text.split('\n')
  let mode = null // 'lanes' | 'allowlist' | 'warnlist' | 'denylist_explicit'
  let curLane = null
  let inFiles = false

  for (const l of lines) {
    if (/^lanes:\s*$/.test(l)) { mode = 'lanes'; curLane = null; continue }
    if (/^allowlist:\s*$/.test(l)) { mode = 'allowlist'; continue }
    if (/^warnlist:\s*$/.test(l)) { mode = 'warnlist'; continue }
    if (/^denylist_explicit:\s*$/.test(l)) { mode = 'denylist_explicit'; continue }
    if (/^[a-z]/.test(l)) { mode = null; continue } // top-level non-our key

    if (mode === 'lanes') {
      const laneMatch = l.match(/^  ([a-z][a-z0-9-]*):\s*$/)
      if (laneMatch) { curLane = laneMatch[1]; out.lanes[curLane] = []; inFiles = false; continue }
      // G-030: per-lane status: frozen marker (cold-storage)
      if (curLane && /^\s{4}status:\s*frozen\b/.test(l)) { out.frozen_lanes.add(curLane); continue }
      if (curLane && /^\s{4}files:\s*$/.test(l)) { inFiles = true; continue }
      if (curLane && inFiles) {
        const m = l.match(/^\s{6}-\s*"?([^"#]+)"?/)
        if (m) out.lanes[curLane].push(m[1].trim())
      }
    } else if (mode === 'allowlist' || mode === 'warnlist' || mode === 'denylist_explicit') {
      const m = l.match(/^\s+-\s*"?([^"#]+)"?/)
      if (m) out[mode].push(m[1].trim())
    }
  }
  return out
}

function activeHandoffsForLane(lane) {
  if (!existsSync(HANDOFF_DIR)) return []
  const ACTIVE = new Set(['in_progress', 'claimed', 'open'])
  const SKIP = new Set(['INDEX.md', 'README.md', '_template.md'])
  const out = []
  for (const name of readdirSync(HANDOFF_DIR)) {
    if (!name.endsWith('.md') || SKIP.has(name)) continue
    const body = readFileSync(join(HANDOFF_DIR, name), 'utf8')
    const fm = body.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) continue
    const meta = {}
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^([a-z_]+):\s*(.*)$/)
      if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    if (!ACTIVE.has(meta.status)) continue
    if (meta.assigned_to !== lane) continue
    const touchesMatch = body.match(/^touches:\s*\n((?:\s{2,}-\s*.+\n?)+)/m)
    const touches = touchesMatch
      ? touchesMatch[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
      : []
    out.push({ id: meta.id, touches })
  }
  return out
}

function pathMatchesAny(relPath, globs) {
  for (const g of globs) {
    if (globToRegex(g).test(relPath)) return g
  }
  return null
}

// ── Main ───────────────────────────────────────────────────

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let input
  try { input = JSON.parse(raw) } catch { return emit('approve', 'malformed input — defer') }

  const tool = input.tool_name || ''
  if (!WRITE_TOOLS.has(tool)) return emit('approve')

  const filePath = input.tool_input?.file_path || input.tool_input?.notebook_path
  if (!filePath) return emit('approve')

  // Normalize to repo-relative POSIX path
  const abs = resolve(filePath)
  let rel = relative(REPO, abs).split(sep).join('/')
  if (rel.startsWith('..') || rel === '') return emit('approve', 'outside repo — defer')

  const myLane = readMyLane()
  if (!myLane) return emit('approve') // zeus, no lane restriction

  const own = readOwnership()
  const mode = readMode()

  // G-030: frozen lane check (cold-storage). Block writes if my lane is frozen.
  // Exception: zeus (no .lane file) bypassed earlier; this only fires for actual lane workers.
  if (own.frozen_lanes.has(myLane)) {
    const reason = `[lane-guard] FROZEN: lane '${myLane}' is in cold-storage (status: frozen). ` +
                   `See olympus-roster.md "Lane-only Retirement" + .olym/specs/olym-lane-retirement/spec.md. ` +
                   `Reactivate via bao approval first.`
    return emit('block', reason) // frozen always blocks even in warn mode
  }

  // 3. denylist_explicit
  const deny = pathMatchesAny(rel, own.denylist_explicit)
  if (deny) {
    const reason = `[lane-guard] DENY: ${rel} matches denylist (${deny}). zeus-only file. Open a handoff if you need a change.`
    return emit('block', reason) // denylist always blocks even in warn mode
  }

  // 4. allowlist
  const allow = pathMatchesAny(rel, own.allowlist)
  if (allow) return emit('approve')

  // 5. my lane ownership
  const myOwnership = own.lanes[myLane] || []
  const ownHit = pathMatchesAny(rel, myOwnership)
  if (ownHit) return emit('approve')

  // 6. active handoff touches[]
  const handoffs = activeHandoffsForLane(myLane)
  for (const h of handoffs) {
    const hit = pathMatchesAny(rel, h.touches)
    if (hit) return emit('approve', `authorized by ${h.id} (touches: ${hit})`)
  }

  // 7. warnlist
  const warn = pathMatchesAny(rel, own.warnlist)
  if (warn) {
    return emit('approve', `[lane-guard] WARN: ${rel} is a shared file (${warn}). Coordinate via zeus to avoid conflicts.`)
  }

  // 8. fall-through
  const reason = `[lane-guard] ${mode.toUpperCase()}: ${rel} is outside lane '${myLane}'. ` +
                 `Open a handoff with assigned_to: <owning-lane> first, or ask zeus.`
  if (mode === 'block') return emit('block', reason)
  return emit('approve', reason) // warn mode
})
