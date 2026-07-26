import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@ctrl/mcp-sdk';

interface ConformanceCase {
  name: string;
  file?: string;
  input?: unknown;
  valid: boolean;
  warningPaths?: string[];
}

interface ConformanceCorpus {
  cases: ConformanceCase[];
}

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const corpus = JSON.parse(
  readFileSync(
    new URL('../../../ctrl-mcp-sdk/schema/manifest-conformance.json', import.meta.url),
    'utf8',
  ),
) as ConformanceCorpus;

function caseInput(testCase: ConformanceCase): unknown {
  if (testCase.file) {
    return JSON.parse(readFileSync(`${repositoryRoot}${testCase.file}`, 'utf8')) as unknown;
  }
  return testCase.input;
}

describe('manifest JSON Schema conformance', () => {
  for (const testCase of corpus.cases) {
    it(testCase.name, () => {
      const result = parseManifest(caseInput(testCase));
      expect(result.ok, JSON.stringify(result.errors)).toBe(testCase.valid);
      if (!testCase.valid) return;

      expect(result.warnings.map((warning) => warning.path)).toEqual(
        testCase.warningPaths ?? [],
      );
      if (testCase.name === 'minimal legacy actions-only manifest') {
        expect(result.manifest?.manifest_version).toBe(1);
        expect(result.manifest?.variant).toBe('builtin');
      }
      if (testCase.name === 'legacy local server with implicit type') {
        expect(result.manifest?.server?.type).toBe('local');
      }
    });
  }
});
