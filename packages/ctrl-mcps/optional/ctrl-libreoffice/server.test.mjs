// Verifies the fail-closed optional child contract.
// (ADR-002 substrate §14 v78; ADR-004 cap §1 v13; ADR-010 communication § transports v13)
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  handleMessage,
  normalizeSelection,
  readSelectedContext,
  SourceUnavailableError,
} from './server.mjs';

const writerSelection = {
  document_id: 'writer-doc-1',
  document_type: 'writer',
  revision: '7',
  selection_kind: 'writer_selection',
  target: 'paragraphs:4-5',
  content: 'Selected text',
  formulas: null,
  content_hash: 'sha256:writer-selection',
  unrelated_document_body: 'must not cross the bridge adapter',
};

const calcSelection = {
  document_id: 'calc-doc-1',
  document_type: 'calc',
  revision: 12,
  selection_kind: 'calc_range',
  target: 'Sheet1.A1:B2',
  content: [[1, 2], [3, 4]],
  formulas: [['=1', '=2'], ['', '=A1+B1']],
  content_hash: 'sha256:calc-range',
};

function response(payload, ok = true) {
  return {
    ok,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test('normalizes Writer selection and drops unrelated document data', () => {
  const row = normalizeSelection(writerSelection);
  assert.deepEqual(Object.keys(row), [
    'document_id',
    'document_type',
    'revision',
    'selection_kind',
    'target',
    'content',
    'formulas',
    'content_hash',
  ]);
  assert.equal(row.content, 'Selected text');
  assert.equal(row.formulas, '');
  assert.equal('unrelated_document_body' in row, false);
});

test('normalizes an explicit Calc range as text-safe row fields', () => {
  const row = normalizeSelection(calcSelection);
  assert.equal(row.document_type, 'calc');
  assert.equal(row.revision, '12');
  assert.equal(row.content, '[[1,2],[3,4]]');
  assert.equal(row.formulas, '[["=1","=2"],["","=A1+B1"]]');
});

test('fails honestly when bridge configuration or selection is unavailable', async () => {
  await assert.rejects(
    readSelectedContext({ env: {}, fetchImpl: async () => response(writerSelection) }),
    SourceUnavailableError,
  );
  assert.throws(
    () => normalizeSelection({ ...writerSelection, selection_kind: 'whole_document' }),
    /no eligible Writer selection or Calc range/,
  );
});

test('uses an authenticated loopback request and returns only rows', async () => {
  let observed;
  const result = await readSelectedContext({
    env: {
      CTRL_LIBREOFFICE_BRIDGE_URL: 'http://127.0.0.1:29381/selection',
      CTRL_LIBREOFFICE_BRIDGE_TOKEN: 'test-token',
    },
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return response(calcSelection);
    },
  });
  assert.equal(observed.url, 'http://127.0.0.1:29381/selection');
  assert.equal(observed.options.headers.Authorization, 'Bearer test-token');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].target, 'Sheet1.A1:B2');
});

test('rejects non-loopback bridge URLs before transmitting the token', async () => {
  let called = false;
  await assert.rejects(
    readSelectedContext({
      env: {
        CTRL_LIBREOFFICE_BRIDGE_URL: 'https://example.com/selection',
        CTRL_LIBREOFFICE_BRIDGE_TOKEN: 'must-not-leave-host',
      },
      fetchImpl: async () => {
        called = true;
        return response(writerSelection);
      },
    }),
    /authenticated loopback endpoint/,
  );
  assert.equal(called, false);
});

test('MCP tool call reports unavailable as an error result, never empty success', async () => {
  const reply = await handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'read_selected_context', arguments: {} },
  }, { env: {}, fetchImpl: async () => response(writerSelection) });
  assert.equal(reply.result.isError, true);
  assert.equal(reply.result.content.length, 1);
  assert.equal(reply.result.content[0].text, 'LibreOffice source is unavailable');
  assert.doesNotMatch(reply.result.content[0].text, /bridge|token|url|env/i);
});

// The self-start guard compares this module's URL against argv[1]. `import.meta.url`
// is always fully resolved, so comparing it to an UNRESOLVED argv[1] made the server
// silently do nothing whenever any component of the invocation path was a symlink:
// it exited without output and without an error, and the kernel saw the connection
// close during initialize. A CI runner whose workspace sits under a symlinked path
// hit this, and so would any user whose install root is a link.
// (ADR-010 communication § transports v13)
test('the server starts when spawned through a symlinked path', () => {
  const real = dirname(fileURLToPath(import.meta.url));
  const link = join(mkdtempSync(join(tmpdir(), 'ctrl-lo-link-')), 'pack');
  symlinkSync(real, link);
  const initialize = `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'probe', version: '1' },
    },
  })}\n`;

  for (const entry of [join(real, 'server.mjs'), join(link, 'server.mjs')]) {
    const child = spawnSync(process.execPath, [entry, '--untrusted-test'], {
      input: initialize,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(child.stderr, '', `${entry} must not error`);
    const [line] = child.stdout.split('\n');
    assert.ok(line, `${entry} produced no initialize response`);
    assert.equal(JSON.parse(line).result.serverInfo.name, 'ctrl-libreoffice');
  }
});

// Importing must NOT start the server, or a test that imports this module would
// consume the parent's stdin.
test('importing the module does not start the stdio server', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ctrl-lo-import-'));
  const probe = join(scratch, 'probe.mjs');
  const target = pathToFileURLString(join(dirname(fileURLToPath(import.meta.url)), 'server.mjs'));
  writeFileSync(
    probe,
    `import ${JSON.stringify(target)};\nprocess.stdout.write('imported-without-serving\\n');\n`,
  );
  const output = execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(output.trim(), 'imported-without-serving');
});

function pathToFileURLString(path) {
  return new URL(`file://${path}`).href;
}
