# Vault §8 — manual smoke test

ADR-002 substrate § vault v1 §8 ships in v0.1.146+ (`feat/vault-adr-002-s8`). This document drives a full smoke through every flow listed in §8 acceptance. Allow ~15 minutes for a clean pass.

Driver: `bao`. Reviewer for each block: visual + filesystem check.

## Prereqs

1. Install the build:
   - Open CTRL → Settings → About → Check for Updates → install **v0.1.147** (or whatever is latest at `https://github.com/soodooi-releases/releases/latest`).
   - Auto-updater preserves Input Monitoring (stable signing identity); the Ctrl hotkey must still summon the cockpit after install.
2. Vault root:
   - The vault lives at `$HOME/Documents/CTRL/`. First boot of v0.1.147 seeds the feature-layer files — confirm before running the flows:
     ```sh
     ls -la "$HOME/Documents/CTRL/.ctrl/"
     #     sourcing.yaml  daily-notes.yaml  sourcing-prompt.md  review-queue/
     ls -la "$HOME/Documents/CTRL/templates/"
     #     daily.md  meeting.md
     ```
3. Vault notes to seed before the run (so the tree isn't empty):
   ```sh
   mkdir -p "$HOME/Documents/CTRL/notes"
   cat > "$HOME/Documents/CTRL/notes/alpha.md" <<'MD'
   ---
   title: Alpha
   tags: [project]
   ---
   This is alpha. See [[beta]] for related.
   MD
   cat > "$HOME/Documents/CTRL/notes/beta.md" <<'MD'
   ---
   title: Beta
   tags: [project]
   ---
   Beta concept. Linked from [[alpha]].
   MD
   cat > "$HOME/Documents/CTRL/notes/lonely.md" <<'MD'
   ---
   title: Lonely
   ---
   Nobody links here.
   MD
   ```
4. (Optional but recommended) seed the sourcing inbox:
   ```sh
   mkdir -p "$HOME/Documents/CTRL/sourcing"
   cat > "$HOME/Documents/CTRL/sourcing/clipboard-1.md" <<'MD'
   ---
   source: clipboard
   ---
   Quick capture about rust ownership patterns.
   MD
   cat > "$HOME/Documents/CTRL/sourcing/link-1.md" <<'MD'
   ---
   source: link
   url: https://example.com/something
   ---
   https://example.com/something — interesting article.
   MD
   ```

---

## Flow A — L1 vault chip activates the L2 navigator

**Setup**: cockpit visible (Ctrl), no other workspace open.
**Action**: click the `Vault` icon in the L1 PrimaryRail (book + bookmark glyph, sits between Pool and Coding).
**Expected**:
- The L1 chip enters the active visual state.
- The L2 column slides into view at `200 px` wide (look for the title `VAULT`, a monospace path showing `~/Documents/CTRL`, a search input, and the `+ Note` / `Today` / `Review` row).
- The window does NOT auto-expand; only the L2 column appears.
**Fail signals**: L2 stays at 0 px, no title, console shows React render error.

## Flow B — L2 search + folder tree

**Setup**: Flow A complete.
**Action**: scroll the L2 body — the tree should render folders alphabetically. Type `alpha` into the search box.
**Expected**:
- Without typing: tree shows `notes`, `templates`, `daily` (if any daily notes exist), `sourcing`. The `.ctrl/` folder must NOT appear.
- With `alpha` typed: only `notes/alpha.md` appears.
- Clearing the search restores the full tree.
**Fail signals**: `.ctrl/` visible in the tree (regression — §8.5 hidden); search hangs > 1 s; results don't match.

## Flow C — `+ Note` writes a new vault file

**Setup**: Flow A complete.
**Action**: click `+ Note`. An inline path input appears with `notes/untitled.md`. Edit to `notes/test-c.md`. Press Enter.
**Expected**:
- Tree refreshes; `notes/test-c.md` appears.
- The new file opens as a `vault-md` tab in the workspace; the body is empty; the YAML frontmatter contains a `created` ISO timestamp.
- File on disk: `cat "$HOME/Documents/CTRL/notes/test-c.md"` shows the frontmatter block.
**Fail signals**: no tab opens, file doesn't appear in the tree, `created` timestamp missing.

## Flow D — `Today` opens (or creates) the daily note

**Setup**: today's daily note does not yet exist (`ls "$HOME/Documents/CTRL/daily/"` should be empty or absent of `$(date +%Y-%m-%d).md`).
**Action**: click `Today`.
**Expected**:
- A `vault-md` tab opens with `daily/2026-MM-DD.md` (today's date).
- Body comes from `templates/daily.md` with `{{date}}` substituted; visible heading is the date.
- Frontmatter contains `type: journal` and `tags: [daily]`.
- File exists on disk.
**Action 2**: click `Today` again.
**Expected 2**: same path opens; no duplicate file; no extra tab.
**Fail signals**: writes `daily/.md` (date placeholder unsubstituted); template content not visible; second click overwrites the body.

## Flow E — wikilink type → atom render

**Setup**: open `notes/alpha.md` from L2 (single click).
**Action**: in the body, place the cursor at end of `See [[beta]]`. Type ` and [[gamma]]` (gamma does not exist in the vault).
**Expected**:
- `[[beta]]` already renders as an accent-coloured chip (solid border).
- The newly-typed `[[gamma]]` renders as a danger-coloured dashed chip (broken-link styling).
- Both chips show literal `[[name]]` text inside.
**Fail signals**: chips render as plain text; broken-link chip styled identically to resolved; the InputRule produces malformed HTML in source mode.

## Flow F — wikilink click → vault tab

**Setup**: Flow E complete; `notes/alpha.md` open.
**Action**: click the `[[beta]]` chip.
**Expected**:
- A new `vault-md` tab opens with `notes/beta.md`.
- Tab title reads `beta`.
- The `[[alpha]]` chip inside beta is reciprocally clickable.
**Action 2**: click the broken `[[gamma]]` chip.
**Expected 2**: no navigation (broken link has no target). No console error.
**Fail signals**: click does nothing for `[[beta]]`; broken-link click opens a blank tab; the wrong note opens (stem-index regression).

## Flow G — wikilink source mode round-trip

**Setup**: Flow E complete; `notes/alpha.md` open.
**Action**: click `Source` in the viewer chrome to switch from WYSIWYG to CodeMirror raw markdown.
**Expected**:
- Source view shows the raw frontmatter block + the body containing literal `[[beta]]` and `[[gamma]]` (no HTML span fragments leaked into the markdown).
**Action 2**: switch back to `Preview`.
**Expected 2**: chips reappear (no orphaned `<span>` text).
**Fail signals**: source view shows `<span data-wikilink>` or escaped HTML; switching back to Preview produces double-rendered chips.

## Flow H — BacklinksDrawer reveals reverse links

**Setup**: open `notes/beta.md` in a workspace tab.
**Action**: scroll to the workspace bottom; click the `Backlinks` chevron to expand the drawer.
**Expected**:
- Drawer header shows `BACKLINKS` label with count `1`.
- Expanded list shows one row: `notes/alpha.md` with a snippet containing `... See [[beta]] ...`.
- Click the row → opens `notes/alpha.md` as a new vault-md tab.
**Fail signals**: count badge shows `0`; snippet missing; click does nothing.

## Flow I — `.ctrl/` is hidden from the user tree

**Setup**: L2 visible.
**Action**: scroll the L2 tree.
**Expected**:
- The `notes`, `daily`, `templates`, `sourcing` folders are visible.
- The `.ctrl` folder is NOT visible.
- `git status -uall "$HOME/Documents/CTRL"` (or `ls -la`) on disk SHOULD still show `.ctrl/sourcing.yaml`, `.ctrl/daily-notes.yaml`, `.ctrl/sourcing-prompt.md`.
**Fail signals**: `.ctrl/` listed in the tree (regression).

## Flow J — first-boot seed files exist

**Setup**: clean install of v0.1.147 with vault not yet created (or `rm -rf $HOME/Documents/CTRL/.ctrl/sourcing.yaml` before launching once).
**Action**: launch CTRL.
**Expected**:
- `$HOME/Documents/CTRL/.ctrl/sourcing.yaml` exists with `version: 1`, `inbox_dir: sourcing`, and the three triggers.
- `$HOME/Documents/CTRL/.ctrl/daily-notes.yaml` exists with the `path_template`.
- `$HOME/Documents/CTRL/.ctrl/sourcing-prompt.md` exists.
- `$HOME/Documents/CTRL/templates/daily.md` + `meeting.md` exist.
**Action 2**: edit `daily-notes.yaml` (e.g. change `path_template` to `journal/{YYYY}-{MM}-{DD}.md`). Restart CTRL.
**Expected 2**: the file is not overwritten — user edits preserved.
**Fail signals**: any seed missing on first boot; any seed overwritten on relaunch.

## Flow K — Sourcing inbox badge polls the count

**Setup**: prereq seed of `sourcing/clipboard-1.md` + `sourcing/link-1.md` from prereqs (2 items).
**Action**: open L2 vault.
**Expected**:
- The `Review` button shows `2` in the badge; the count chip is rendered with the accent colour (data-pending).
**Action 2**: drop another markdown file: `echo '---\nsource: test\n---\n\nfresh' > "$HOME/Documents/CTRL/sourcing/extra.md"`. Wait ≤ 8 seconds.
**Expected 2**: badge updates to `3` without manual refresh.
**Fail signals**: badge stuck at `0`; never updates after drop.

## Flow L — Sourcing routine writes a review queue

**Setup**: Flow K complete (badge shows ≥ 1).
**Action**: click `Review`.
**Expected**:
- A `sourcing-review` workspace tab opens with header `Sourcing review` and the review-queue path (e.g. `.ctrl/review-queue/2026-06-02.md`).
- The tab body lists one card per sourcing item with fields: source path, type chip, suggest path, frontmatter JSON, optional backlinks.
- On disk: `cat "$HOME/Documents/CTRL/.ctrl/review-queue/$(date +%Y-%m-%d).md"` exists and contains `## sourcing/...` headers.
**Fail signals**: empty state; tab shows raw markdown unparsed; the review-queue file is missing.

## Flow M — Sourcing review Accept

**Setup**: Flow L complete; sourcing review tab open.
**Action**: pick `sourcing/clipboard-1.md`. Click `Accept`.
**Expected**:
- The card flashes busy, then the sourcing file moves: `ls "$HOME/Documents/CTRL/sourcing/clipboard-1.md"` returns no such file.
- The proposal target appears under `notes/inbox/...md` (or wherever the suggest path pointed).
- Frontmatter of the new file contains both the original (`source: clipboard`) and the proposed enrichment (`type`, `sourced_at`).
- The L2 `Review` badge count decreases by 1.
**Fail signals**: original sourcing file still on disk; suggested-path file absent; frontmatter loses the original `source`.

## Flow N — Sourcing review Reject

**Setup**: Flow L complete; another sourcing item visible.
**Action**: pick `sourcing/link-1.md`. Click `Reject`.
**Expected**:
- The sourcing file is deleted from disk.
- The card disappears from the tab.
- Badge count decreases by 1.
**Fail signals**: file remains; card persists.

## Flow O — Sourcing review Edit

**Setup**: at least one item remaining in the inbox after K-N.
**Action**: pick that item; click `Edit`.
**Expected**:
- A `vault-md` tab opens with the original sourcing file (e.g. `sourcing/extra.md`).
- User can edit body / frontmatter.
- Switching back to the sourcing review tab and clicking `Accept` then uses the edited body.
**Fail signals**: Edit click does nothing; opens the wrong file; opens a blank tab.

## Flow P — legacy `/vault` URL is a no-op rail activator

**Setup**: cockpit visible, vault L1 not active.
**Action**: open browser dev tools or trigger any code path that calls `navigate({ to: '/vault' })` (e.g. from a hypothetical deep link).
**Expected**:
- The L1 Vault chip enters active state.
- The L2 panel mounts.
- The TanStack route renders nothing (no legacy VaultBrowser shell).
**Fail signals**: 404; legacy 3-pane shell reappears; console route error.

## Flow Q — manual smoke close-out

**Setup**: tabs may be open.
**Action**:
1. Confirm `cargo test --manifest-path src-tauri/Cargo.toml --lib "kernel::vault"` reports all green when bao runs locally.
2. Confirm `npx tsc --noEmit` in `packages/ctrl-web` reports zero errors.
3. Confirm `bash scripts/check-adr-acceptance.sh` reports all ADR items closed.

---

## Cleanup

```sh
# Optional reset between runs:
rm -rf "$HOME/Documents/CTRL/.ctrl/review-queue/"*.md
rm -rf "$HOME/Documents/CTRL/sourcing/"*.md
rm -rf "$HOME/Documents/CTRL/notes/test-c.md"
rm -rf "$HOME/Documents/CTRL/notes/inbox/"
# Keep seeds + alpha/beta/lonely to re-run flows H/I/J without re-seeding.
```

## Known limitations of this manual run

- The 9 AM cron + count-threshold auto-fire of `vault_sourcing_run` is NOT in v1 — only the manual `Review` click drives the routine. (`§8.9` future work.)
- The wikilink autocomplete popup is NOT in v1 — InputRule fires on `]]` close, the user must type the full target before the chip materialises. (`§8.9` future work.)
- The kernel `vault_list` `include_hidden` flag is not exposed; the L2 tree filters `.ctrl/` in the frontend. (`§8.9` future work.)
