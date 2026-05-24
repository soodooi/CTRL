# Logseq lazy-install integration (for CTRL)

> Owner: Hephaestus (keycap lane). Spec for [H-2026-05-23-002](../.olym/handoffs/H-2026-05-23-002-irisy-logseq-lazy-integration.md). Status: draft, ready to implement.

Purpose: let CTRL trigger installation of Logseq on the user's machine **post-CTRL-install**, then let Irisy read/write the same vault Logseq edits. CTRL is a downloader, never a distributor — Logseq stays an independent AGPL-3.0 program.

---

## Architecture in one paragraph

CTRL installer **never** bundles Logseq binary. After CTRL.app launches, the About panel (or first-run prompt) shows an `Install Logseq` button. Clicking it triggers a Tauri command `install_logseq()` that shells out to a per-platform installer (`brew install --cask logseq` on mac, `winget install Logseq.Logseq` on win, `flatpak install logseq` on linux). On success, CTRL writes `~/.ctrl/state/logseq.json` with the install path + detected vault dir. Subsequent CTRL boots probe `~/.ctrl/state/logseq.json` and report `installed: true` to the PWA. Irisy + kernel `vault.*` MCP tools point at the **same** vault dir so notes written via CTRL appear in Logseq and vice versa.

---

## File map (what gets created)

```
src-tauri/src/commands/logseq.rs          # NEW — install_logseq + logseq_status + logseq_vault_path
src-tauri/src/commands/mod.rs             # AMEND — register 3 new commands in pwa_invoke_handler!
packages/ctrl-web/src/components/         # AMEND — About panel "Install Logseq" button + status row
  about/AboutPanel.tsx
packages/ctrl-web/src/components/manifest/
  builtin/open-in-logseq.ts               # NEW — keycap manifest (target=mcp-tool)
THIRD_PARTY_LICENSES.md                   # NEW or AMEND — Logseq AGPL-3.0 entry + source URL
doc/setup-logseq-lazy-install.md          # THIS FILE
```

No changes to: `kernel/vault.rs` (already correct — points at `~/.ctrl/vault/` by default; user can repoint to Logseq's vault dir from Settings).

---

## Install paths (per platform)

### macOS — Homebrew (preferred)

```bash
brew install --cask logseq
```

Probe success:

```bash
test -d /Applications/Logseq.app
```

Output to `~/.ctrl/state/logseq.json`:

```json
{
  "installed": true,
  "install_method": "brew-cask",
  "binary_path": "/Applications/Logseq.app/Contents/MacOS/Logseq",
  "installed_at": "2026-05-23T18:30:00Z",
  "version": "0.10.9",
  "vault_dir": null
}
```

### macOS — direct DMG fallback (when brew not present)

```bash
TMPDIR=$(mktemp -d)
curl -fSL -o "$TMPDIR/logseq.dmg" \
  "https://github.com/logseq/logseq/releases/latest/download/logseq-darwin-arm64.dmg"
hdiutil attach "$TMPDIR/logseq.dmg" -nobrowse -quiet
cp -R "/Volumes/Logseq/Logseq.app" /Applications/
hdiutil detach "/Volumes/Logseq" -quiet
rm -rf "$TMPDIR"
```

Notes:
- Use `logseq-darwin-arm64.dmg` on Apple Silicon, `logseq-darwin-x64.dmg` on Intel. Detect via `arch`.
- Never re-sign, re-package, or modify the .app. Drop it into /Applications as-is.
- `binary_path` becomes `/Applications/Logseq.app/Contents/MacOS/Logseq`.

### Windows

```powershell
winget install --id Logseq.Logseq --silent
```

### Linux

```bash
flatpak install flathub com.logseq.Logseq -y
```

Fallback: AppImage download from GitHub releases (`logseq-linux-x64-VERSION.AppImage`), `chmod +x`, prompt user to place in PATH.

---

## Tauri command surface (Rust side)

### `install_logseq() -> Result<InstallOutcome, String>`

```rust
#[derive(Debug, Serialize)]
pub struct InstallOutcome {
    pub kind: &'static str,        // "installed" | "already-installed" | "no-installer" | "user-cancelled" | "error"
    pub method: Option<String>,    // "brew-cask" | "dmg-direct" | "winget" | "flatpak"
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

#[tauri::command]
pub async fn install_logseq(app: AppHandle) -> Result<InstallOutcome, String> {
    // 1. logseq_status() first — short-circuit if already installed
    // 2. detect platform + available installers (which brew / which winget / which flatpak)
    // 3. shell out to chosen installer, stream stdout to app.emit("install.logseq.progress", ...)
    // 4. on success: write ~/.ctrl/state/logseq.json
    // 5. return InstallOutcome
}
```

Use `tokio::process::Command` (NOT `std::process::Command` — would block tokio runtime per memory `feedback_no_mock_data_in_production` + recent audit finding).

### `logseq_status() -> Result<LogseqStatus, String>`

```rust
#[derive(Debug, Serialize)]
pub struct LogseqStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub vault_dir: Option<String>,  // null until user configures shared vault
}
```

Reads `~/.ctrl/state/logseq.json`; if missing, probes filesystem (`/Applications/Logseq.app` exists?).

### `logseq_vault_path(vault_dir: String) -> Result<(), String>`

Persists user-chosen shared vault dir to `~/.ctrl/state/logseq.json`. Also updates `~/.ctrl/config.toml [vault] root = "<dir>"` so kernel `vault.*` MCP tools point at the same dir.

---

## PWA wiring (About panel + keycap)

### About panel block

```tsx
{logseqStatus.installed ? (
  <Row icon="logseq" label="Logseq" value={`v${logseqStatus.version} · ${logseqStatus.vault_dir ?? 'no vault configured'}`} />
) : (
  <Row icon="logseq" label="Logseq">
    <button onClick={handleInstallLogseq} disabled={installing}>
      {installing ? 'Installing…' : 'Install Logseq'}
    </button>
  </Row>
)}
```

Below the install row, always render:

```tsx
<small>Powered by Logseq · AGPL-3.0 · <a href="https://github.com/logseq/logseq">source</a></small>
```

### Keycap manifest (`open-in-logseq`)

`packages/ctrl-web/src/components/manifest/builtin/open-in-logseq.ts`:

```ts
import { z } from 'zod';
import type { KeycapManifest } from '@ctrl/keycap-sdk';

export const openInLogseqManifest: KeycapManifest = {
  id: 'open-in-logseq',
  name: 'Open in Logseq',
  icon: { kind: 'svg', src: '/icons/logseq.svg' },
  target: 'mcp-tool',
  capabilities: ['vault.read', 'shell.open'],
  config_schema: z.object({
    logseq_path: z.string().default('/Applications/Logseq.app'),
  }),
  run: async (ctx) => {
    const focusedNote = await ctx.vault.read(ctx.input.path);  // .md file
    const url = `logseq://graph/${encodeURIComponent(ctx.config.logseq_path)}?page=${encodeURIComponent(focusedNote.title)}`;
    await ctx.shell.open(url);
  },
};
```

Register in `packages/ctrl-web/src/components/manifest/registry.ts` alongside other builtin keycaps.

---

## AGPL-3.0 compliance checklist

Per memory `decision_hermes_mit_compliance` (MIT baseline) + AGPL extra obligations from this conversation:

- [ ] `THIRD_PARTY_LICENSES.md` includes Logseq entry:

  ```markdown
  ## Logseq

  License: AGPL-3.0-or-later
  Source: https://github.com/logseq/logseq
  Copyright: © 2020-present Logseq contributors

  CTRL distributes nothing of Logseq's source or binary; CTRL only
  triggers Logseq's installation via the user's package manager (brew
  cask / winget / flatpak) or downloads Logseq's unmodified release
  artifact. The installed Logseq remains an independent program.

  Full license text: see https://www.gnu.org/licenses/agpl-3.0.txt
  ```

- [ ] About panel renders "Powered by Logseq · AGPL-3.0 · github.com/logseq/logseq" line, visible whenever Logseq is installed.
- [ ] No CTRL code patches, forks, or re-signs Logseq's binary or source.
- [ ] No DRM, no feature lock layered on Logseq's UI.
- [ ] Mesh viewer does NOT proxy Logseq UI cross-device. (AGPL §13 trap; per memory `decision_ctrl_obsidian_philosophy` mesh = CTRL's own cell streams only.)
- [ ] If a user-facing CTRL setting toggles Logseq behavior (e.g., "use Logseq as primary editor"), the toggle only changes CTRL's routing — it never sends commands that modify Logseq's source or configuration files beyond what Logseq's own preferences UI does.

---

## Verification steps (what to run after implementing)

```bash
# 1. clean state
rm -rf /Applications/Logseq.app ~/.ctrl/state/logseq.json

# 2. launch CTRL fresh
killall ctrl 2>/dev/null
open /Applications/CTRL.app

# 3. in CTRL UI: open About panel → click "Install Logseq"
#    expected: "Installing…" → "Installed: v0.10.x"

# 4. confirm Logseq is on disk
test -d /Applications/Logseq.app && echo "PASS" || echo "FAIL"
cat ~/.ctrl/state/logseq.json | jq

# 5. point Logseq at a vault dir (in Logseq UI)
#    then in CTRL Settings: paste the same dir for vault root
#    or call logseq_vault_path() from devtools

# 6. write a note via CTRL Irisy ("create note 'logseq test'")
#    open Logseq → verify the note appears

# 7. edit in Logseq, save
#    in CTRL Irisy: "what's in logseq test?" → returns the edited content

# 8. click "Open in Logseq" keycap on a focused note
#    Logseq jumps to that page
```

Acceptance per handoff H-2026-05-23-002:
- bao runs `Install Logseq`, Logseq lands.
- Same vault dir read/write works both ways.
- About panel + `THIRD_PARTY_LICENSES.md` show AGPL identity.
- No fork, no patch, no bundled binary.

---

## Non-goals (do not expand into these)

- Don't write a Logseq plugin. The integration is at the filesystem + URL-scheme level.
- Don't auto-pick the vault dir. Ask the user; default to `~/.ctrl/vault/` only when the user explicitly confirms.
- Don't add SiYuan / AppFlowy install in this doc. Logseq first; generic framework only if the pattern holds.
- Don't proxy Logseq UI through mesh viewer. AGPL §13.

---

## Future extensions (separate handoffs)

- **SiYuan integration** — same lazy-install pattern, but SiYuan stores blocks in SQLite not pure markdown, so kernel vault.* needs a SiYuan adapter. Out of scope for v1.
- **Plugin discovery** — Logseq has its own plugin marketplace; eventually CTRL can suggest Logseq plugins that pair well with installed keycaps. Out of scope.
- **Cross-device sync via mesh** — once mesh is stable, CTRL can sync the vault dir across user's devices. Logseq users already have iCloud / Dropbox / git options; CTRL mesh is a 4th option, not a replacement.
