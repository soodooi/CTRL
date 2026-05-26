// Irisy memory substrate (G12) — vault-backed.
//
// Layout (lives inside the user's vault, portable across editors):
//   <vault>/.irisy-memory/
//     MEMORY.md           — index, always loaded into Irisy context
//     user_profile.yml    — YAML profile (strong "ground truth" signal)
//     feedback_<topic>.md — Irisy-learned preferences
//     project_<name>.md   — project state / goal / deadline
//     reference_<sys>.md  — pointers to external systems
//
// Aligns with industry hybrid-memory pattern (mem0 / Letta / OMEGA):
// markdown bullets = contextual hints, YAML profile = ground truth.
//
// No new kernel namespace per zeus REVIEW (2026-05-23) — all IO goes
// through vault.read / vault.write / vault.list, already shipped.

import { invoke } from './bridge';

const MEMORY_DIR = '.irisy-memory';
const MEMORY_INDEX = `${MEMORY_DIR}/MEMORY.md`;
const USER_PROFILE = `${MEMORY_DIR}/user_profile.yml`;

interface VaultEntry {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

interface VaultWriteReply {
  absolute_path: string;
  path: string;
}

export interface MemoryRecord {
  /** Relative path under vault root (e.g. `.irisy-memory/feedback_tone.md`). */
  path: string;
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  alwaysLoad: boolean;
  body: string;
}

const STARTER_MEMORY_INDEX = `# Irisy Memory Index

> Auto-maintained. One line per memory file. Edit at your own risk —
> Irisy regenerates this when you change a memory through the settings
> panel.

- [User profile](user_profile.yml) — your name, role, preferences (YAML for strong ground-truth signal)
`;

const STARTER_USER_PROFILE = `# YAML profile — give Irisy a strong, structured signal about who you are.
# Edit this file directly or use CTRL settings → Memory panel.
name: ""
languages_spoken: []
role: ""
expertise:
  - ""
prefers:
  reply_style: "concise"
  reply_length: "short"
  language: "en"
`;

/**
 * Ensure the memory directory exists and the starter MEMORY.md +
 * user_profile.yml are present. Safe to call on every mount — writes
 * only when the file is missing.
 */
export async function ensureMemoryBootstrap(): Promise<void> {
  const existing = await listMemoryFiles();
  if (!existing.includes(MEMORY_INDEX)) {
    await invoke<VaultWriteReply>('vault_write', {
      args: {
        path: MEMORY_INDEX,
        content: STARTER_MEMORY_INDEX,
        frontmatter: {
          kind: 'memory-index',
          managed_by: 'irisy',
          version: 1,
        },
      },
    });
  }
  if (!existing.includes(USER_PROFILE)) {
    // user_profile is YAML; write as a markdown file whose body is the
    // YAML content. Frontmatter records kind so Irisy knows to load it
    // as profile, not arbitrary memory.
    await invoke<VaultWriteReply>('vault_write', {
      args: {
        path: USER_PROFILE,
        content: STARTER_USER_PROFILE,
        frontmatter: {
          kind: 'user-profile',
          managed_by: 'irisy',
        },
      },
    });
  }
}

/** List every memory file path (.md / .yml) under `.irisy-memory/`. */
export async function listMemoryFiles(): Promise<string[]> {
  try {
    const paths = await invoke<string[]>('vault_list', {
      args: { subdir: MEMORY_DIR },
    });
    return paths;
  } catch {
    return [];
  }
}

/**
 * Load the always-loaded core memory subset for injection into the
 * Irisy system prompt: MEMORY.md index + user_profile.yml + any other
 * file whose frontmatter has `always_load: true`.
 */
export async function loadCoreMemory(): Promise<string> {
  const blocks: string[] = [];
  try {
    const index = await invoke<VaultEntry>('vault_read', {
      args: { path: MEMORY_INDEX },
    });
    if (index.content.trim().length > 0) {
      blocks.push(`# Memory index\n${index.content.trim()}`);
    }
  } catch {
    /* index doesn't exist yet — bootstrap covers it on next mount */
  }
  try {
    const profile = await invoke<VaultEntry>('vault_read', {
      args: { path: USER_PROFILE },
    });
    if (profile.content.trim().length > 0) {
      blocks.push(`# User profile (YAML — ground truth)\n${profile.content.trim()}`);
    }
  } catch {
    /* profile missing — bootstrap writes it next mount */
  }

  const files = await listMemoryFiles();
  for (const path of files) {
    if (path === MEMORY_INDEX || path === USER_PROFILE) continue;
    try {
      const entry = await invoke<VaultEntry>('vault_read', { args: { path } });
      if (entry.frontmatter?.always_load !== true) continue;
      const name = entry.frontmatter?.name ?? path;
      blocks.push(`# ${String(name)}\n${entry.content.trim()}`);
    } catch {
      /* skip unreadable entries */
    }
  }
  return blocks.join('\n\n');
}

/**
 * Persist a memory record. Caller decides path naming (CTRL convention:
 * `<type>_<topic-kebab>.md`). Overwrites on path collision.
 */
export async function recordMemory(record: MemoryRecord): Promise<void> {
  const frontmatter: Record<string, unknown> = {
    name: record.name,
    description: record.description,
    type: record.type,
    always_load: record.alwaysLoad,
    last_updated_at: new Date().toISOString(),
  };
  await invoke<VaultWriteReply>('vault_write', {
    args: {
      path: record.path,
      content: record.body,
      frontmatter,
    },
  });
}
