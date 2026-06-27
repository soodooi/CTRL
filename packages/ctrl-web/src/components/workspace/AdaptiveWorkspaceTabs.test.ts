import { describe, it, expect } from 'vitest';
import type { WorkspaceTab } from '@ctrl/mcp-sdk';
// vitest.config.ts intentionally omits the `@` alias + JSX transform — specs
// import by relative path and target React-free modules. The dispatch helpers
// live in their own pure module so they're testable without the .tsx shell.
import { SMART_TABLE_CONTENT_TYPE } from '../../modules/smart-table';
import {
  contentTypeForViewer,
  tabToResource,
} from './AdaptiveWorkspaceTabs.dispatch';

describe('contentTypeForViewer', () => {
  it('maps short viewer keys to registry content-types', () => {
    expect(contentTypeForViewer('markdown')).toBe('text/markdown');
    expect(contentTypeForViewer('json')).toBe('application/json');
    expect(contentTypeForViewer('svg')).toBe('image/svg+xml');
    expect(contentTypeForViewer('smart-table')).toBe(SMART_TABLE_CONTENT_TYPE);
  });

  it('passes an explicit MIME through verbatim', () => {
    expect(contentTypeForViewer('application/pdf')).toBe('application/pdf');
  });

  it('falls back for an unknown key', () => {
    expect(contentTypeForViewer('not-a-viewer')).toBe('application/octet-stream');
  });
});

describe('tabToResource', () => {
  it('returns null without a uri (interactive or sourceless tab)', () => {
    expect(tabToResource({ id: 't', label: 'T', viewer: 'markdown' })).toBeNull();
    expect(tabToResource({ id: 'c', label: 'C', viewer: 'chat-stream' })).toBeNull();
  });

  it('builds a resource from props.uri, defaulting location=mcp + non-editable', () => {
    const tab: WorkspaceTab = {
      id: 'q',
      label: 'Quotes',
      viewer: 'markdown',
      props: { uri: 'vault://Stocks/watchlist.md' },
    };
    expect(tabToResource(tab)).toEqual({
      location: 'mcp',
      contentType: 'text/markdown',
      uri: 'vault://Stocks/watchlist.md',
      editable: false,
    });
  });

  it('derives contentType from the viewer key when props.contentType is absent', () => {
    const tab: WorkspaceTab = {
      id: 'h',
      label: 'Holdings',
      viewer: 'smart-table',
      props: { uri: 'vault://Stocks/holdings.md' },
    };
    expect(tabToResource(tab)?.contentType).toBe(SMART_TABLE_CONTENT_TYPE);
  });

  it('honors explicit contentType / location / editable overrides', () => {
    const tab: WorkspaceTab = {
      id: 'a',
      label: 'Analysis',
      viewer: 'markdown',
      props: {
        uri: 'vault://Stocks/analysis.md',
        contentType: 'text/html',
        location: 'vault',
        editable: true,
      },
    };
    expect(tabToResource(tab)).toEqual({
      location: 'vault',
      contentType: 'text/html',
      uri: 'vault://Stocks/analysis.md',
      editable: true,
    });
  });
});
