// coding-spawn — ensure a Pi TUI env exists for the Coding L1 chip.
//
// ADR-002 substrate § brain v13 (2026-06-07): Coding chip spawns bundled
// Pi via cs_spawn. This helper either reuses an existing non-crashed Pi
// env or starts a fresh one and returns the stream_id so PrimaryRail
// can open the workspace tab at /code-space/<envId>.

import { invoke } from '@tauri-apps/api/core';
import { csList, csSpawn } from '@/lib/kernel';

interface EnvLike {
  stream_id?: string;
  status?: string;
  command?: string;
}

interface PiBinaryPath {
  path: string;
}

const pickExistingCodingEnv = (raw: unknown): string | null => {
  if (!Array.isArray(raw)) return null;
  for (const item of raw as EnvLike[]) {
    if (item?.status === 'crashed') continue;
    const cmd = item?.command ?? '';
    if (cmd.endsWith('/pi') || cmd === 'pi') {
      if (typeof item.stream_id === 'string') return item.stream_id;
    }
  }
  return null;
};

export const ensureCodingEnv = async (): Promise<string> => {
  const envs = await csList();
  const existing = pickExistingCodingEnv(envs);
  if (existing) return existing;

  const { path: piPath } = await invoke<PiBinaryPath>('pi_binary_path');
  const reply = await csSpawn({
    command: piPath,
    args: [],
    env: {},
  });
  return reply.stream_id;
};
