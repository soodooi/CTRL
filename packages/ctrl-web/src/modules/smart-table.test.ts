import { describe, expect, it } from 'vitest';
import {
  SMART_TABLE_CONTENT_TYPE,
  isSmartTableFrontmatter,
  smartTableModule,
} from './smart-table';

describe('isSmartTableFrontmatter', () => {
  it('claims a file with a non-empty schema block', () => {
    expect(isSmartTableFrontmatter({ schema: [{ key: 'name', label: 'Name', type: 'text' }] })).toBe(true);
  });

  it('rejects an empty / missing / wrong-typed schema', () => {
    expect(isSmartTableFrontmatter({ schema: [] })).toBe(false);
    expect(isSmartTableFrontmatter({ title: 'x' })).toBe(false);
    expect(isSmartTableFrontmatter({ schema: 'nope' })).toBe(false);
    expect(isSmartTableFrontmatter(null)).toBe(false);
    expect(isSmartTableFrontmatter(undefined)).toBe(false);
    expect(isSmartTableFrontmatter('string')).toBe(false);
  });
});

describe('smartTableModule declaration', () => {
  it('exposes the content type the viewer registry maps', () => {
    expect(smartTableModule.contentType).toBe(SMART_TABLE_CONTENT_TYPE);
    expect(SMART_TABLE_CONTENT_TYPE).toBe('text/x-ctrl-smart-table');
  });

  it('owns the §14 gate verbs + names its QuerySource', () => {
    expect(smartTableModule.gateTools).toContain('smart_table.describe');
    expect(smartTableModule.gateTools).toContain('smart_table.query');
    expect(smartTableModule.gateTools).toContain('smart_table.update_cell');
    expect(smartTableModule.querySource).toBe('vault_smart_table::SmartTable');
  });
});
