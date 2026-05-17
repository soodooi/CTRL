#!/usr/bin/env node
// ctrl — CTRL keycap CLI entry point.
// Subcommands:
//   ctrl new-keycap <name> [--ts | --py]   scaffold a new keycap project
//   ctrl dev [path]                        start dev server, auto-register with running CTRL
//   ctrl publish [path]                    push to ctrl-market (v1.1)
//
// Dispatch wrapper — actual command impls under ../src/.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0];
const rest = args.slice(1);

async function main() {
  switch (cmd) {
    case 'new-keycap':
    case 'new': {
      const { run } = await import(join(__dirname, '..', 'src', 'new-keycap.js'));
      await run(rest);
      break;
    }
    case 'dev': {
      const { run } = await import(join(__dirname, '..', 'src', 'dev.js'));
      await run(rest);
      break;
    }
    case 'publish': {
      console.error('ctrl publish — not yet implemented (v1.1; market backend pending)');
      process.exit(1);
      break;
    }
    case '-v':
    case '--version':
    case 'version':
      console.log('ctrl 0.1.0');
      break;
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      console.log(`ctrl — CTRL keycap CLI

Commands:
  ctrl new-keycap <name>          Scaffold a new keycap (TypeScript MCP server)
  ctrl new-keycap <name> --py     Scaffold in Python instead
  ctrl dev [path]                 Start keycap in dev mode (auto-registers)
  ctrl publish [path]             Push to ctrl-market  (v1.1, not yet)
  ctrl version                    Show CLI version
`);
      break;
    default:
      console.error(`unknown command: ${cmd}\nRun 'ctrl help' for usage.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
