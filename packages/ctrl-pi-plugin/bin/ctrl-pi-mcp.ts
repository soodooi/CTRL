#!/usr/bin/env -S node --experimental-strip-types
// ctrl-pi-mcp — launch the Pi brain MCP server.
//
// Reads CTRL_PI_PORT / CTRL_PI_HOST / CTRL_PI_TOKEN env. Prints the bound
// URL on stdout so the kernel supervisor can capture it.

import { startMcpServer } from '../src/mcp-server.ts';

async function main(): Promise<void> {
  const server = await startMcpServer();
  // stdout is the contract with the kernel supervisor (one JSON line).
  process.stdout.write(
    `${JSON.stringify({
      event: 'ready',
      url: server.url,
      port: server.port,
      mcp: `${server.url}/mcp`,
      health: `${server.url}/healthz`,
    })}\n`,
  );

  const shutdown = async (signal: string) => {
    process.stderr.write(`ctrl-pi-mcp: received ${signal}, shutting down\n`);
    await server.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e: unknown) => {
  process.stderr.write(`ctrl-pi-mcp: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
