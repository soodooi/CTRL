// ctrl new-mcp — scaffold a mcp project from template.
//
// Default = TypeScript MCP server (@modelcontextprotocol/sdk + zod).
// --py flag swaps to Python (mcp[cli] / FastMCP).
//
// Layout produced (TS):
//   <name>/
//   ├── manifest.yaml        mcp declaration (per ADR-004 cap § execution v1 spec)
//   ├── package.json
//   ├── tsconfig.json
//   ├── src/server.ts        MCP server skeleton, one tool stub
//   ├── .gitignore
//   └── README.md

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const opts = { lang: 'ts', name: undefined };
  for (const a of argv) {
    if (a === '--ts') opts.lang = 'ts';
    else if (a === '--py' || a === '--python') opts.lang = 'py';
    else if (!a.startsWith('--') && !opts.name) opts.name = a;
  }
  return opts;
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function run(argv) {
  const { name, lang } = parseArgs(argv);
  if (!name) {
    console.error('usage: ctrl new-mcp <name> [--ts | --py]');
    process.exit(1);
  }
  const slug = slugify(name);
  if (!slug) {
    console.error('invalid mcp name');
    process.exit(1);
  }
  const dir = resolve(process.cwd(), slug);

  try {
    await access(dir);
    console.error(`directory exists: ${dir}`);
    process.exit(1);
  } catch {
    // not found → good
  }

  await mkdir(dir, { recursive: true });
  if (lang === 'ts') {
    await scaffoldTs(dir, slug);
  } else {
    await scaffoldPy(dir, slug);
  }
  console.log(`✓ scaffolded ${lang.toUpperCase()} mcp: ${slug}`);
  console.log('');
  console.log(`Next:`);
  console.log(`  cd ${slug}`);
  if (lang === 'ts') {
    console.log(`  npm install`);
    console.log(`  npm run dev`);
  } else {
    console.log(`  uv venv && source .venv/bin/activate`);
    console.log(`  uv pip install -e .`);
    console.log(`  python -m server`);
  }
  console.log(``);
  console.log(`Then in CTRL desktop: Pool → your new mcp appears (after kernel re-scan).`);
}

async function scaffoldTs(dir, slug) {
  const w = (rel, content) => writeFile(join(dir, rel), content, 'utf-8');
  await mkdir(join(dir, 'src'), { recursive: true });

  await w('package.json', JSON.stringify({
    name: slug,
    version: '0.1.0',
    private: true,
    type: 'module',
    bin: { [slug]: './dist/server.js' },
    scripts: {
      build: 'tsc',
      dev: 'tsx watch src/server.ts',
      start: 'node dist/server.js',
    },
    dependencies: {
      '@modelcontextprotocol/sdk': '^1.29.0',
      zod: '^3.23.0',
    },
    devDependencies: {
      tsx: '^4.19.0',
      typescript: '^5.6.0',
      '@types/node': '^22.0.0',
    },
  }, null, 2) + '\n');

  await w('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      outDir: 'dist',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['src/**/*'],
  }, null, 2) + '\n');

  await w('manifest.yaml', `# CTRL mcp manifest (ADR-004 cap § execution v1 §implemented_by spec — v0.2 schema TBD)
id: my.${slug}
name: ${slug}
description: A new CTRL mcp built from \`ctrl new-mcp\`.
variant: mcp-server
runtime:
  command: node
  args: ["./dist/server.js"]
platforms: [macos, windows, linux]
capabilities: []
tools:
  - name: hello
    description: Returns a friendly hello.
    input_schema:
      type: object
      properties:
        who: { type: string, default: "world" }
`);

  await w('src/server.ts', `// MCP server entry — exposes one example tool 'hello'.
// Replace with real logic. See @modelcontextprotocol/sdk docs.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const HelloArgs = z.object({ who: z.string().default('world') });

const server = new Server(
  { name: '${slug}', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'hello',
      description: 'Returns a friendly hello.',
      inputSchema: {
        type: 'object',
        properties: { who: { type: 'string', default: 'world' } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'hello') {
    throw new Error(\`unknown tool: \${req.params.name}\`);
  }
  const { who } = HelloArgs.parse(req.params.arguments ?? {});
  return {
    content: [{ type: 'text', text: \`Hello, \${who}! — from ${slug}\` }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
`);

  await w('.gitignore', `node_modules/\ndist/\n.npmrc\n`);
  await w('README.md', `# ${slug}

A CTRL mcp (MCP server). Scaffolded by \`ctrl new-mcp\`.

## Run

\`\`\`sh
npm install
npm run dev          # tsx watch — auto-reload during dev
\`\`\`

## Add to CTRL desktop

The manifest \`manifest.yaml\` declares this mcp. To make it appear in
Pool, register the manifest with the running CTRL kernel:

\`\`\`sh
ctrl dev .           # auto-registers + watches src/
\`\`\`

## Manifest spec

See \`vault/ctrl/adrs/004-cap.md\` § execution in the CTRL repository for the
MCP-outward, Actor-inward execution model.
`);
}

async function scaffoldPy(dir, slug) {
  const w = (rel, content) => writeFile(join(dir, rel), content, 'utf-8');
  await mkdir(join(dir, 'src'), { recursive: true });

  await w('pyproject.toml', `[project]
name = "${slug}"
version = "0.1.0"
description = "A CTRL mcp built from \`ctrl new-mcp\`."
requires-python = ">=3.11"
dependencies = [
    "mcp[cli]>=1.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project.scripts]
${slug} = "server:main"
`);

  await w('src/server.py', `"""MCP server entry — exposes one example tool 'hello'.

Replace with real logic. See https://github.com/modelcontextprotocol/python-sdk
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("${slug}")


@mcp.tool()
def hello(who: str = "world") -> str:
    """Return a friendly hello."""
    return f"Hello, {who}! — from ${slug}"


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
`);

  await w('manifest.yaml', `id: my.${slug}
name: ${slug}
description: A new CTRL mcp built from \`ctrl new-mcp\`.
variant: mcp-server
runtime:
  command: python
  args: ["-m", "server"]
platforms: [macos, windows, linux]
capabilities: []
tools:
  - name: hello
    description: Returns a friendly hello.
    input_schema:
      type: object
      properties:
        who: { type: string, default: "world" }
`);

  await w('.gitignore', `__pycache__/\n.venv/\n*.egg-info/\ndist/\n`);
  await w('README.md', `# ${slug}

A CTRL mcp (MCP server, Python). Scaffolded by \`ctrl new-mcp --py\`.

## Run

\`\`\`sh
uv venv && source .venv/bin/activate
uv pip install -e .
python -m server
\`\`\`
`);
}
