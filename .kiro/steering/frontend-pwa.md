---
inclusion: fileMatch
fileMatchPattern: "packages/ctrl-web/**"
---

# Frontend PWA

Read ADR-001, ADR-003, and the owning feature ADR before assessment or changes. The stack is React 18, strict TypeScript, Vite 5, TanStack Router/Query, Zustand, and Framer Motion. Routing is code-defined in `src/app.tsx`, not file-based.

Preserve the persistent shell, content-type viewer model, Tauri `invoke()` boundary, token-authenticated event WS, hosted remote entry, and desktop service-worker removal. Plan the whole layout/state flow before local UI edits; screenshots verify design rather than create it. Keep all code and UI text English.

Validate with:

```bash
npm --workspace @ctrl/web run typecheck
npm --workspace @ctrl/web run test
```

Use Playwright/visual verification for UI behavior. Do not run watch mode from an agent command.
