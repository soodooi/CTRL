// Verifies the fail-closed optional child contract.
// (ADR-002 substrate §14 v78; ADR-004 cap §1 v13; ADR-010 communication § transports v13)
import assert from 'node:assert/strict';
import test from 'node:test';
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
