// provenance — derive the drill-down report for a rendered Resource.
//
// The shell already fetches a CanonicalResourceDescriptor to choose a viewer,
// then discards everything except `content_type` and `resource`. That threw away
// the only facts that let a user answer "where did this come from and is it
// still true": revision, observation time, staleness, kernel-reported
// degradation, and the upstream refs this Resource was derived from.
//
// This module is a pure projection of that already-fetched descriptor. It issues
// no second read, invents no fact, and never guesses a value the kernel did not
// send — an absent field is reported as absent rather than filled with a
// plausible default.
// (ADR-002 substrate §15 v83; ADR-005 irisy §12 v42)

import type { CanonicalResourceDescriptor, ResourceDegradation } from './kernel';

export interface ProvenanceEntry {
  label: string;
  value: string;
}

export interface ProvenanceReport {
  /** The canonical ref, shown verbatim so the user can address it elsewhere. */
  resource: string;
  /** Descriptor facts, in decision order. Only kernel-sent fields appear. */
  facts: ProvenanceEntry[];
  /** Upstream Resources this one was derived from, as canonical refs. */
  sources: string[];
  /** Kernel-reported degradation, verbatim. */
  degradation: ResourceDegradation | null;
  /** True when the kernel says the projection is behind its source. */
  stale: boolean;
}

/** Descriptor -> drill-down report. Pure; safe to call during render. */
export function provenanceReport(
  descriptor: CanonicalResourceDescriptor,
): ProvenanceReport {
  const facts: ProvenanceEntry[] = [
    { label: 'Content type', value: descriptor.content_type },
  ];

  const freshness = descriptor.freshness;
  if (freshness?.revision) {
    facts.push({ label: 'Revision', value: freshness.revision });
  }
  if (freshness?.observed_at) {
    facts.push({ label: 'Observed at', value: freshness.observed_at });
  }
  // Staleness is a decision-relevant fact even when false: "current as of" and
  // "unknown" are different answers, and silence reads as the former.
  facts.push({
    label: 'Freshness',
    value: freshness
      ? freshness.stale
        ? 'stale — behind its source'
        : 'current'
      : 'not reported',
  });
  if (descriptor.protocol_version) {
    facts.push({ label: 'Protocol', value: descriptor.protocol_version });
  }

  return {
    resource: descriptor.resource,
    facts,
    sources: descriptor.provenance ?? [],
    degradation: descriptor.degradation ?? null,
    stale: freshness?.stale ?? false,
  };
}
