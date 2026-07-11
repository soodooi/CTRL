// Tests for remote-acl — deny-by-default enforcement at the RemoteHost invoke
// boundary (ADR-005 §2 slice S4). Pins the permission matrix so view-only stays
// view-only and hidden stays hidden.

import { describe, it, expect } from 'vitest';
import { checkRemoteAcl, DESCRIBE_TOOL } from './remote-acl';
import type { RemoteAllowEntry } from './remote-connection';

const ALLOW: RemoteAllowEntry[] = [
  { key: 'pack.ghostfolio', label: 'Ghostfolio', icon: '$', canAct: false }, // view-only
  { key: 'pack.stock-cn', label: 'Stock CN', icon: '^', canAct: true }, // can act
  { key: 'today', label: 'Today', icon: 'O', canAct: true },
];

describe('checkRemoteAcl', () => {
  it('allows the describe call unconditionally (read-only surface load)', () => {
    const d = checkRemoteAcl(ALLOW, DESCRIBE_TOOL, undefined, undefined);
    expect(d.allow).toBe(true);
  });

  it('denies an undeclared frame — missing pack', () => {
    const d = checkRemoteAcl(ALLOW, 'vault_read', undefined, 'query');
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/missing/);
  });

  it('denies an undeclared frame — missing verb', () => {
    const d = checkRemoteAcl(ALLOW, 'vault_read', 'pack.stock-cn', undefined);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/missing/);
  });

  it('denies a frame for a pack not in the allowlist (hidden stays hidden)', () => {
    const d = checkRemoteAcl(ALLOW, 'vault_read', 'pack.secret', 'query');
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/not allowed/);
  });

  it('allows a query on a view-only pack (view = can read)', () => {
    const d = checkRemoteAcl(ALLOW, 'source_query', 'pack.ghostfolio', 'query');
    expect(d.allow).toBe(true);
  });

  it('denies a produce on a view-only pack (view-only cannot act)', () => {
    const d = checkRemoteAcl(ALLOW, 'source_produce', 'pack.ghostfolio', 'produce');
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/view-only/);
  });

  it('allows a produce on an act-enabled pack', () => {
    const d = checkRemoteAcl(ALLOW, 'source_produce', 'pack.stock-cn', 'produce');
    expect(d.allow).toBe(true);
  });

  it('allows a query on an act-enabled pack', () => {
    const d = checkRemoteAcl(ALLOW, 'vault_read', 'today', 'query');
    expect(d.allow).toBe(true);
  });

  it('denies everything against an empty allowlist (except describe)', () => {
    expect(checkRemoteAcl([], 'vault_read', 'today', 'query').allow).toBe(false);
    expect(checkRemoteAcl([], DESCRIBE_TOOL, undefined, undefined).allow).toBe(true);
  });
});
