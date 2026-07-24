// provider-badge — semantic 2-letter badge for the L1 sidebar chip.
//
// Replaces the legacy `modelLabel.replace(/[^a-zA-Z]/g, '').slice(0, 2)`
// which produced provider-initial ambiguities:
//   "Z.AI"            → "ZA"
//   "Z.AI Coding Plan" → "ZC"
//   "Anthropic Claude" → "CL"
//   "Volc Doubao"      → "VO"
//
// Decision 0007 §display (2026-06-19): the badge carries provider
// identity, not string-prefix chance. Unknown ids fall back to the
// label's first 2 letters (preserving the legacy path for custom /
// user-added providers we don't have a mapping for yet).

const PROVIDER_BADGES: Record<string, string> = {
  anthropic: 'CL',
  volc: 'VO',
  'volc-doubao': 'VO',
  zhipu: 'ZA',
  'zai-coding-plan': 'ZC',
  openai: 'OA',
  deepseek: 'DS',
  kimi: 'KI',
  moonshot: 'KI',
  qwen: 'QW',
  gemini: 'GE',
  google: 'GE',
  openrouter: 'OR',
  groq: 'GQ',
  together: 'TG',
  mistral: 'MI',
  xai: 'XK',
  grok: 'XK',
  perplexity: 'PX',
  fireworks: 'FW',
  azure: 'AZ',
  vertex: 'VX',
  bedrock: 'BK',
  cloudflare: 'CF',
  ollama: 'OL',
};

/**
 * Get the 2-letter badge for a provider id. Returns the semantic map
 * entry when known, else falls back to the first 2 letters of the
 * label (uppercased) — never returns an empty string (caller renders
 * '··' for fully-unknown state).
 */
export function providerBadge(providerId: string, label: string): string {
  const mapped = PROVIDER_BADGES[providerId.toLowerCase()];
  if (mapped) return mapped;
  const fallback = label.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
  return fallback || '··';
}
