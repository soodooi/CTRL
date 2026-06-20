// intent-routing — the routing pill's brain (ADR-003 frontend §8.2B + §8.3).
//
// §8.2B locks "a routing pill shown BEFORE work starts" and §8.3 names hidden
// routing the #1 anti-pattern. Today the home composer streams every turn
// through one provider, so this classifier doesn't fork the backend — it makes
// Irisy's READ of your intent VISIBLE (Answering / Drafting / Translating…) so
// the surface is transparent, not a black box. §8.2B is explicit that this is a
// keyword pass, NOT a model call ("intent clear → do it directly").
//
// English-only patterns by design (ADR-006 §2 global-English first; Chinese
// and other locales arrive as an i18n layer after v1) — so the rules stay all
// ASCII and we never embed non-English string literals in code.

export type IntentKind =
  | 'answer'
  | 'draft'
  | 'translate'
  | 'polish'
  | 'summarize'
  | 'extract'
  | 'plan';

export interface RouteHint {
  kind: IntentKind;
  /** Shown verbatim in the pill, e.g. "Answering", "Drafting". */
  label: string;
}

// Ordered most-specific → most-general: a "summarize this draft" turn should
// read as Summarizing, not Drafting, so the narrow verbs win first. The broad
// 'draft' catch-all sits last before the 'answer' default.
const RULES: { kind: IntentKind; label: string; patterns: RegExp[] }[] = [
  {
    kind: 'translate',
    label: 'Translating',
    patterns: [/\btranslat(e|ion|ing)\b/i, /\binto (english|chinese|spanish|french|german|japanese)\b/i],
  },
  {
    kind: 'summarize',
    label: 'Summarizing',
    patterns: [/\bsummar(y|ize|ise|ising|izing)\b/i, /\btl;?dr\b/i, /\bkey points\b/i],
  },
  {
    kind: 'polish',
    label: 'Polishing',
    patterns: [/\b(polish|rewrite|proofread|rephrase|reword)\b/i, /\bimprove the (wording|tone|writing|grammar)\b/i],
  },
  {
    kind: 'extract',
    label: 'Extracting',
    patterns: [/\bextract\b/i, /\baction items?\b/i, /\bpull out\b/i, /\blist (the|all|every)\b/i],
  },
  {
    kind: 'plan',
    label: 'Planning',
    patterns: [/\b(plan|roadmap|outline)\b/i, /\bstep[\s-]?by[\s-]?step\b/i],
  },
  {
    kind: 'draft',
    label: 'Drafting',
    patterns: [
      /\b(write|draft|compose|create|build|generate|make)\b.{0,24}\b(a|an|the|some|me|my)\b/i,
      /\b(code|function|component|html|css|webpage|web page|script|essay|email|blog post|landing page)\b/i,
    ],
  },
];

// Classify a single composer turn into the intent the pill announces. Defaults
// to 'answer' ("Answering") so a plain question is still shown, never hidden.
export function classifyIntent(text: string): RouteHint {
  const t = text.trim();
  if (!t) return { kind: 'answer', label: 'Answering' };
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(t))) {
      return { kind: rule.kind, label: rule.label };
    }
  }
  return { kind: 'answer', label: 'Answering' };
}
