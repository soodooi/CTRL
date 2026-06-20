# CTRL — marketing site

Static multi-page site, **no build step**. Plain HTML + one shared `styles.css`.
Brand tokens (cobalt blue + keycap母题) derive from `../doc/design/tokens.json`
and `../brand/brand-tokens.md`. Copy is locked to ADR-006 §5 (OPC positioning)
and §1 (BYOK).

## Pages
| File | Purpose |
|---|---|
| `index.html` | Home — keycap hero, why, how it works, commons teaser |
| `product.html` | Capability deep-dive — morph / routing / MCP·CLI·Skills / on-device / BYOK |
| `download.html` | macOS download + requirements + install steps + Win/Linux roadmap |
| `commons.html` | Share & be shared ecosystem |
| `manifesto.html` | Local-first / plain-text philosophy (long-form) |

## Local preview
```bash
open website/index.html
# or a real server:
python3 -m http.server -d website 8080   # http://localhost:8080
```

## Deploy — Cloudflare Pages → ctrlapplab.com
No build command; output directory = `website/`.

- **Dashboard**: connect the repo → build output `website`, build command (none).
- **CLI** (needs `CLOUDFLARE_API_TOKEN` in env):
  ```bash
  npx wrangler pages deploy website --project-name=ctrl-site
  ```
Then bind the custom domain `ctrlapplab.com` in the Pages project.
`_headers` applies security + cache headers.

> Download buttons point at `github.com/soodooi/CTRL-releases/releases/latest`.
> Closes ADR-006 §6 G1 (public landing / download page).
