// ctrl dev — start keycap in dev mode + auto-register with running CTRL kernel.
//
// v0.1 stub: just runs the keycap's `npm run dev` (TS) or `python -m server` (py)
// and prints the runtime command line. Full kernel registration via dynamic
// `--mcp-config` injection lands once Zeus exposes a kernel JSON-RPC for
// "register MCP server at runtime" (TODO).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function run(argv) {
  const target = resolve(process.cwd(), argv[0] ?? '.');
  const manifestPath = resolve(target, 'manifest.yaml');

  if (!existsSync(manifestPath)) {
    console.error(`no manifest.yaml found at ${manifestPath}`);
    console.error(`run \`ctrl new-keycap <name>\` first, or cd into a keycap project.`);
    process.exit(1);
  }

  const manifest = readFileSync(manifestPath, 'utf-8');
  console.log(`[ctrl dev] manifest @ ${manifestPath}`);
  console.log(manifest.split('\n').slice(0, 6).map((l) => `  ${l}`).join('\n'));

  const pkgJson = resolve(target, 'package.json');
  const pyProj = resolve(target, 'pyproject.toml');
  let cmd, args;
  if (existsSync(pkgJson)) {
    cmd = 'npm';
    args = ['run', 'dev'];
  } else if (existsSync(pyProj)) {
    cmd = 'python';
    args = ['-m', 'server'];
  } else {
    console.error('no package.json or pyproject.toml — not a recognised keycap project');
    process.exit(1);
  }

  console.log(`[ctrl dev] launching: ${cmd} ${args.join(' ')}`);
  console.log(`[ctrl dev] (auto-register via kernel JSON-RPC: TODO — for now register manually in CTRL Settings)`);
  console.log('');

  const child = spawn(cmd, args, { cwd: target, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
