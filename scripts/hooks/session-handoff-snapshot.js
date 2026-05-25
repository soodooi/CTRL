#!/usr/bin/env node
// SessionStart hook — three-column injection for the multi-agent fleet.
//
// Behavior depends on cwd:
//   - cwd has `.lane` file → worker mode. Inject:
//       § My Lane (<lane>) — Active Handoffs assigned to me
//       § Other Lanes — Forbidden Files (so I know what NOT to touch)
//       § Messages for me — handoff bodies updated since I last left
//   - cwd is main tree (no `.lane`) → zeus mode. Inject:
//       § Fleet Status — quick view of each worker tree
//       § Assigned to me (zeus) — handoffs needing orchestrator action
//       § All Active Handoffs — grouped by lane
//
// Memory note (per D-08): worker does NOT write MEMORY.md. This hook is the
// primary channel for delivering up-to-date project state to workers each
// session. Keep injection short — quality over quantity.
//
// Spec: .olym/specs/multi-agent-fleet/spec.md §9

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = process.cwd()
const HANDOFF_DIR = join(REPO, '.olym/handoffs')
const LANE_FILE = join(REPO, '.lane')
const OWNERSHIP = join(REPO, '.olym/steering/lane-ownership.yaml')
const ACTIVE = new Set(['in_progress', 'claimed', 'open'])
const SKIP = new Set(['INDEX.md', 'README.md', '_template.md'])

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    })
  )
}

function readHandoffs() {
  if (!existsSync(HANDOFF_DIR)) return []
  const out = []
  for (const name of readdirSync(HANDOFF_DIR)) {
    if (!name.endsWith('.md') || SKIP.has(name)) continue
    const path = join(HANDOFF_DIR, name)
    const body = readFileSync(path, 'utf8')
    const fm = body.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) continue
    const meta = {}
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^([a-z_]+):\s*(.*)$/)
      if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    const touchesMatch = body.match(/^touches:\s*\n((?:\s{2,}-\s*.+\n?)+)/m)
    const touches = touchesMatch
      ? touchesMatch[1]
          .split('\n')
          .map((l) => l.replace(/^\s*-\s*/, '').trim())
          .filter(Boolean)
      : []
    out.push({ ...meta, touches, _file: name, _mtime: statSync(path).mtimeMs })
  }
  return out
}

function readMyLane() {
  if (!existsSync(LANE_FILE)) return null
  return readFileSync(LANE_FILE, 'utf8').trim() || null
}

function readOwnership() {
  if (!existsSync(OWNERSHIP)) return { lanes: {} }
  // crude YAML parse — top-level lanes only, no quotes/anchors
  const text = readFileSync(OWNERSHIP, 'utf8')
  const lanes = {}
  const lines = text.split('\n')
  let curLane = null
  let inFiles = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^lanes:\s*$/.test(l)) {
      curLane = '__inside__'
      continue
    }
    if (curLane === '__inside__' || curLane !== null) {
      const laneMatch = l.match(/^  ([a-z][a-z0-9-]*):\s*$/)
      if (laneMatch) {
        curLane = laneMatch[1]
        lanes[curLane] = []
        inFiles = false
        continue
      }
      if (curLane && /^\s{4}files:\s*$/.test(l)) {
        inFiles = true
        continue
      }
      if (curLane && inFiles) {
        const fileMatch = l.match(/^\s{6}-\s*"?([^"#]+)"?/)
        if (fileMatch) {
          lanes[curLane].push(fileMatch[1].trim())
        } else if (/^\S/.test(l)) {
          // top-level key reached; stop
          break
        }
      }
    }
  }
  return { lanes }
}

function fmtHandoff(h) {
  const sev = h.severity ? `[${h.severity}]` : ''
  return `- **[${h.id || h._file.replace('.md', '')}]** ${sev} (${h.status}) · ${h.title || 'untitled'}`
}

function fmtTouches(h) {
  if (!h.touches || h.touches.length === 0) return ''
  const head = h.touches.slice(0, 4)
  const tail =
    h.touches.length > 4 ? ` (+${h.touches.length - 4} more, see handoff body)` : ''
  return `  · touches: \`${head.join(', ')}\`${tail}`
}

// ── Worker mode ────────────────────────────────────────────

function readDikeAudits() {
  const dir = join(REPO, '.olym/audits/zeus-quality')
  if (!existsSync(dir)) return { notify: [] }
  const notify = []
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md') || name === 'README.md') continue
      const body = readFileSync(join(dir, name), 'utf8')
      const fm = body.match(/^---\n([\s\S]*?)\n---/)
      if (!fm) continue
      const reqMatch = fm[1].match(/^bao_notify_required:\s*yes\s*$/m)
      if (!reqMatch) continue
      const reasonMatch = fm[1].match(/^bao_notify_reason:\s*(.+)$/m)
      notify.push({ path: name, reason: reasonMatch ? reasonMatch[1].trim() : '(no reason given)' })
    }
  } catch {}
  return { notify }
}

function workerContext(myLane) {
  const all = readHandoffs()
  const own = readOwnership()

  const mineActive = all.filter((h) => ACTIVE.has(h.status) && h.assigned_to === myLane)
  const others = all.filter((h) => ACTIVE.has(h.status) && h.assigned_to !== myLane)

  // Forbidden files: every active handoff in OTHER lanes contributes its
  // touches[] to the forbidden list (they are mid-edit by their owner).
  const forbidden = new Map()
  for (const h of others) {
    if (!h.assigned_to) continue
    if (!forbidden.has(h.assigned_to)) forbidden.set(h.assigned_to, new Set())
    for (const t of h.touches) forbidden.get(h.assigned_to).add(t)
  }

  // Recent updates (handoffs touched in the last 48h, regardless of assignee)
  const cutoff = Date.now() - 48 * 3600 * 1000
  const recent = all
    .filter((h) => h._mtime > cutoff && (h.assigned_to === myLane || h.status === 'verified'))
    .sort((a, b) => b._mtime - a._mtime)
    .slice(0, 5)

  const sections = []

  sections.push(`### My Lane (${myLane}) — Active Handoffs`)
  if (mineActive.length === 0) {
    sections.push('', '_No handoffs assigned to me right now. Pick from open or wait._')
  } else {
    sections.push('')
    for (const h of mineActive) sections.push(fmtHandoff(h) + fmtTouches(h))
  }

  sections.push('', '### Other Lanes — Forbidden Files (do not edit)')
  if (forbidden.size === 0) {
    sections.push('', '_No other lanes have active handoffs._')
  } else {
    sections.push('')
    for (const [lane, files] of [...forbidden.entries()].sort()) {
      sections.push(`**${lane}**:`)
      for (const f of [...files].sort()) sections.push(`  - \`${f}\``)
    }
  }

  // Lane ownership reminder
  const myOwnership = own.lanes[myLane] || []
  if (myOwnership.length > 0) {
    sections.push('', `### My Lane Ownership (\`${myLane}\`)`)
    sections.push('')
    for (const f of myOwnership) sections.push(`  - \`${f}\``)
  }

  if (recent.length > 0) {
    sections.push('', '### Recently Updated (last 48h)')
    sections.push('')
    for (const h of recent) sections.push(fmtHandoff(h))
  }

  sections.push(
    '',
    '> Memory: per D-08 you do NOT write MEMORY.md. Read CLAUDE.md + this',
    '> injection + handoff bodies for context. Push learnings back to zeus',
    '> by adding `@zeus: please record in memory: ...` to a handoff body.',
    '> Cross-lane edits: open a handoff with `assigned_to: <other-lane>`,',
    '> wait for zeus/that lane to acknowledge before editing their files.'
  )

  return sections.join('\n')
}

// ── Zeus mode ────────────────────────────────────────────

function zeusContext() {
  const all = readHandoffs()
  const open = all.filter((h) => ACTIVE.has(h.status))
  const mine = all.filter((h) => ACTIVE.has(h.status) && h.assigned_to === 'zeus')
  // G-011 (H-2026-05-05-013): status=done handoffs awaiting themis review.
  // RFC step 3 trigger: when worker flips status open->done, zeus must dispatch
  // themis (Agent subagent_type code-reviewer) tier B for cross-cutting,
  // tier C for lane-internal.
  const pendingReview = all.filter((h) => h.status === 'done')

  const byLane = new Map()
  for (const h of open) {
    const lane = h.assigned_to || '?'
    if (!byLane.has(lane)) byLane.set(lane, [])
    byLane.get(lane).push(h)
  }

  const sections = []

  // P0 #3 fix (verification §8 dike): surface bao_notify_required:yes
  // independent of zeus forward block — zeus cannot silently drop P0 findings
  const audits = readDikeAudits()
  if (audits.notify.length > 0) {
    sections.push('### ⚠️  Dike P0 Findings (bao notify required)')
    sections.push('')
    for (const f of audits.notify) {
      sections.push(`- ${f.path} — ${f.reason}`)
    }
    sections.push('')
    sections.push('_zeus EOD must include forward block "@bao: dike P0 finding ..." per verification §8.5._')
    sections.push('')
  }

  sections.push('### Fleet Status')
  sections.push('')
  sections.push('_Run `bash scripts/fleet-status.sh` for tree state + counts (incl. dike phase + EOD audit)._')

  sections.push('', '### Assigned to me (zeus)')
  if (mine.length === 0) {
    sections.push('', '_Inbox empty._')
  } else {
    sections.push('')
    for (const h of mine) sections.push(fmtHandoff(h) + fmtTouches(h))
  }

  // G-011: Pending Review (status:done) — zeus must dispatch themis review per
  // protocol/review.md tier ABC + protocol/spec-discipline.md sec 7 RFC step 3.
  if (pendingReview.length > 0) {
    sections.push('', '### ⚠️  Pending Review (dispatch themis per RFC step 3)')
    sections.push('')
    for (const h of pendingReview) sections.push(fmtHandoff(h) + fmtTouches(h))
    sections.push('')
    sections.push('_Action: `Agent(subagent_type: "code-reviewer", ...)` for each. Tier B if cross-cutting, C if lane-internal. After APPROVE -> flip status to verified._')
  }

  sections.push('', '### All Active Handoffs (by lane)')
  if (byLane.size === 0) {
    sections.push('', '_None active._')
  } else {
    for (const [lane, list] of [...byLane.entries()].sort()) {
      if (lane === 'zeus') continue // already listed under "Assigned to me (zeus)" — avoid double-print
      sections.push('', `**${lane}** (${list.length})`)
      for (const h of list) sections.push(fmtHandoff(h) + fmtTouches(h))
    }
  }

  return sections.join('\n')
}

// ── Dispatch ───────────────────────────────────────────────

const myLane = readMyLane()

if (myLane) {
  emit(workerContext(myLane))
} else {
  emit(zeusContext())
}
