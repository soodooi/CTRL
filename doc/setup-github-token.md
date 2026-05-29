# Setup — GitHub token for kernel-local skill discovery

> Phase 1 (走通) only. ADR-023: production search moves behind the shared
> `ctrl-skills` Worker so end users need NO GitHub token. This PAT is the
> dev/walk-through path while we prove the first-keycap pipeline locally.

The kernel command `search_skills` queries the GitHub **code search** API
(`filename:SKILL.md`), which requires authentication. The token is read from
the macOS Keychain — never hardcoded, never shipped.

## 1. Create a fine-grained PAT

GitHub → Settings → Developer settings → **Fine-grained personal access tokens**
→ Generate new token:

- **Repository access**: Public repositories (read-only) — that's all skill
  discovery needs.
- **Permissions**: none beyond the default public read. (Code search works with
  a token that has no extra scopes; classic tokens with `public_repo` also work.)
- Copy the token (starts with `github_pat_…` or `ghp_…`).

## 2. Store it in the Keychain

The kernel reads service `app.ctrl`, account `github` (matches
`shell::KeychainStore` / `commands::skills`):

```bash
security add-generic-password -s app.ctrl -a github -w "<PASTE_TOKEN>" -U
```

Verify:

```bash
security find-generic-password -s app.ctrl -a github -w | head -c 8
```

(Prints the first 8 chars — confirms it's stored. `-U` updates if it already
exists.)

## 3. Use it

Once stored, `search_skills` works — Irisy's skill search + the Pool/workbench
search surface call it. No restart needed (the command reads the Keychain per
call).

To rotate: re-run the `add-generic-password … -U` command with a new token.
To remove: `security delete-generic-password -s app.ctrl -a github`.
