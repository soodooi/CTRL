---
name: render-html
description: The mandatory house style and spec for any HTML you produce — web-research reports, summaries, comparisons, dashboards. Render rich output as a self-contained, good-looking HTML document that goes to the workspace (the chat dialog stays conversational), is editable and saved in the vault.
category: output
---

# Render output as HTML — house style + spec

When you present **web-research results**, a report, a comparison, or any rich
output that deserves a real layout, do NOT dump it into the chat as plain text or
bare markdown. Produce a **self-contained HTML document** following this spec and
route it to the workspace; in the chat, leave only a one-line pointer ("I put the
results in the workspace"). The dialog stays for conversation — the HTML is the
artifact.

## Hard constraints (the renderer is a locked sandbox)

The HTML is rendered in `<iframe sandbox="">` and saved as a plain vault file, so:

- Output **ONE self-contained document**: `<!doctype html>` → `<head>` with
  `<meta charset="utf-8">` and a single inline `<style>` → `<body>`.
- **ZERO JavaScript.** Scripts never run in the sandbox. No `<script>`, no
  `onclick`, no inline handlers.
- **No external resources.** No CDN `<link>`, no remote fonts / images / CSS.
  Inline everything so it loads instantly and works offline. Images only as
  `data:` URIs, otherwise omit them.
- All styling lives in the one inline `<style>` block. Use a system font stack.

## House style (good-looking, not a wall of markdown)

Inline these tokens and patterns so every artifact looks consistent and clean:

- Palette: page `#faf9f7`, ink `#1a1a1a`, muted `#6b6b6b`, accent `#c2410c`,
  card `#ffffff`, hairline `#e8e6e2`.
- Layout: centered column, `max-width: 720px`, generous padding, `line-height:
  1.65`, `border-radius: 12px` on cards, comfortable vertical rhythm.
- Structure content as **cards**, never one long text block.
- A header block (title + subtitle / date) at the top.
- Links use the accent color and show their domain.

## Research-report template (copy and adapt)

For web-research output, fill this shape — header, a plain-language synthesis,
one card per source (title links out + domain + a 1–2 line snippet), a footer
with the source count and which provider was used:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{TOPIC}</title>
<style>
  :root { --page:#faf9f7; --ink:#1a1a1a; --muted:#6b6b6b; --accent:#c2410c; --card:#fff; --line:#e8e6e2; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--page); color:var(--ink);
         font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:720px; margin:0 auto; padding:40px 24px 64px; }
  header h1 { font-size:1.7rem; margin:0 0 4px; }
  header .sub { color:var(--muted); margin:0 0 28px; }
  .synthesis { font-size:1.05rem; margin:0 0 28px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:16px 18px; margin:0 0 14px; }
  .card a { color:var(--accent); font-weight:600; text-decoration:none; }
  .card a:hover { text-decoration:underline; }
  .card .domain { color:var(--muted); font-size:.85rem; margin:2px 0 8px; }
  .card .snippet { margin:0; color:#333; }
  footer { color:var(--muted); font-size:.85rem; border-top:1px solid var(--line);
           margin-top:28px; padding-top:14px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>{TOPIC}</h1>
    <p class="sub">{ONE_LINE_CONTEXT} · {DATE}</p>
  </header>
  <p class="synthesis">{2-4 sentence plain-language synthesis of what you found}</p>

  <div class="card">
    <a href="{URL}">{TITLE}</a>
    <div class="domain">{DOMAIN}</div>
    <p class="snippet">{1-2 line snippet}</p>
  </div>
  <!-- one .card per source -->

  <footer>Sources: {N} · via {PROVIDER}</footer>
</main>
</body>
</html>
```

## Editable · saved · shareable

- Write the document into the vault (e.g. `Research/{topic}.html`) so the user
  **owns it as plain text**. Opened in the workspace it is editable and
  **auto-saves** (local is truth — no Save button), and it survives offline.
- Keep it a single clean file with inline styles only — that is what keeps it
  editable in place and shareable as one portable document.
