// No-docker guided install (bao 2026-07-05): the wire contract between the
// kernel's guidance (pack_provision.rs::NEEDS_CONTAINER_RUNTIME +
// container_runtime_guidance) and the frontend card. Pure — no React/CSS/kernel
// imports — so it unit-tests standalone and locks the Rust↔TS coupling.

export const RUNTIME_SENTINEL = 'NEEDS_CONTAINER_RUNTIME';

export interface RuntimeGuidance {
  platform: string;
  headline: string;
  steps: string[];
  commands: string[];
  docs_url: string;
  /** Kernel says this platform can one-click auto-run the commands (macOS +
   *  Homebrew present). Off → guide-only, no "Install it for me" button. */
  auto_installable: boolean;
}

/** Parse a `mcp_pack_provision` error into runtime guidance, or null when the
 *  error is something else. The JSON is always the message TAIL, so a transport
 *  layer wrapping a prefix around it is tolerated. Never throws. */
export function parseRuntimeGuidance(msg: string): RuntimeGuidance | null {
  const at = msg.indexOf(RUNTIME_SENTINEL);
  if (at < 0) return null;
  try {
    const g = JSON.parse(msg.slice(at + RUNTIME_SENTINEL.length).trim()) as {
      kind?: string;
      platform?: unknown;
      headline?: unknown;
      steps?: unknown;
      commands?: unknown;
      docs_url?: unknown;
      auto_installable?: unknown;
    };
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    return {
      platform: typeof g.platform === 'string' ? g.platform : 'this machine',
      headline: typeof g.headline === 'string' ? g.headline : 'A container runtime is required.',
      steps: strings(g.steps),
      commands: strings(g.commands),
      docs_url: typeof g.docs_url === 'string' ? g.docs_url : '',
      auto_installable: g.auto_installable === true,
    };
  } catch {
    return null;
  }
}
