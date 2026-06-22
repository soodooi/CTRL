// Extract runnable shell blocks from an assistant reply, so Irisy's proposed
// commands get a one-click "run in terminal" button (companion B0/B1:
// propose → user approves → execute; Irisy never auto-runs).

export interface RunnableBlock {
  code: string;
  lang: 'bash' | 'sh';
}

const MAX_RUNNABLE_BLOCK_BYTES = 4096;

export function extractRunnableBlocks(content: string): RunnableBlock[] {
  // Multiline, non-greedy. `[\s\S]` matches across newlines without the /s
  // flag. A fresh regex per call avoids shared-lastIndex bugs.
  const re = /```(bash|sh)\n([\s\S]*?)```/g;
  const blocks: RunnableBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const lang = match[1] === 'sh' ? 'sh' : 'bash';
    const code = (match[2] ?? '').replace(/\n+$/, '');
    if (code.length === 0) continue;
    if (code.length > MAX_RUNNABLE_BLOCK_BYTES) continue;
    blocks.push({ code, lang });
  }
  return blocks;
}
