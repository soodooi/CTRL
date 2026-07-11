// Remote ACL — deny-by-default enforcement at the RemoteHost invoke boundary
// (ADR-005 §2 remote co-view + ADR-004 §1 capability-scoping, slice S4).
//
// The allowlist a phone receives on `hello` drives its bottom-nav UI, but that
// alone is cosmetic: a phone could ignore the rendered UI and send a raw invoke
// for any gate tool. This module closes that hole — every invoke from a phone
// must declare the allowlist entry (pack/function key) it acts as + the verb,
// and a `produce` on a view-only pack is denied. `remote_surface` (the describe
// call that loads a pack's surface) is always allowed — it is read-only and the
// phone already received the allowlist it is allowed to describe.
//
// The phone is an E2E peer the user authorized; this ACL is not meant to defend
// against a malicious peer forging frames (that needs device attestation, out of
// scope). It makes the user's chosen permission matrix ACTUALLY BIND on the
// phone's actions — view-only stays view-only, hidden stays hidden.

import type { RemoteAllowEntry, Verb } from './remote-connection';

export type { Verb };

export interface AclDecision {
  allow: boolean;
  reason?: string;
}

/** Describe call — loads a pack's surface. Read-only, always allowed. */
export const DESCRIBE_TOOL = 'remote_surface';

/** Deny-by-default ACL for one remote invoke.
 *  `allow`  — the live allowlist (already filtered to visible entries).
 *  `tool`   — the gate tool the phone wants to call.
 *  `pack`   — the allowlist key the phone declares it acts as.
 *  `verb`   — query (read) or produce (write). */
export function checkRemoteAcl(
  allow: RemoteAllowEntry[],
  tool: string,
  pack: string | undefined,
  verb: Verb | undefined,
): AclDecision {
  // Describe loads a pack's surface — read-only, always allowed (the allowlist
  // itself was sent on hello, so the phone can already see which packs exist).
  if (tool === DESCRIBE_TOOL) return { allow: true };

  // Every other invoke MUST declare its (pack, verb). Deny-by-default on an
  // undeclared frame closes the raw-tool-name hole.
  if (pack == null || pack === '' || verb == null) {
    return { allow: false, reason: 'missing pack or verb' };
  }
  const entry = allow.find((e) => e.key === pack);
  if (entry == null) {
    return { allow: false, reason: `pack not allowed: ${pack}` };
  }
  // A view-only pack may query but never produce (write/act).
  if (verb === 'produce' && !entry.canAct) {
    return { allow: false, reason: `view-only pack cannot act: ${pack}` };
  }
  return { allow: true };
}
