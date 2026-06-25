// kernel::visibility — intent-scoped tool projection at the :17873 gate.
//
// ADR-010 communication § trust-domains (SC3). The gate used to expose the
// full toolset to every external caller. That is both a UX problem (an agent's
// context gets flooded with ~58 tools it does not need) and a security one
// (maximal attack surface — an agent working on notes can still reach
// `http_post` and exfiltrate). This module replaces "all tools visible to all
// callers" with a least-privilege projection: a caller declares the capability
// domains it needs for the current intent (header `X-Ctrl-Intent`), and the
// gate projects `tools/list` to that subset and rejects out-of-scope
// `tools/call`s.
//
// Design (Apollo MCP Server gateway model — persisted-operation allowlist,
// flexible reads / controlled writes): intent is a *set of capability domains*,
// not a fixed business taxonomy CTRL has to invent. The caller names the
// domains; the gate enforces them. When no intent header is present the gate is
// unscoped (full toolset) — this preserves today's behavior for in-app Irisy
// and BYO-CLI drivers during migration (the Bearer token on loopback remains
// the primary gate; intent-scoping is defense-in-depth layered on top).
//
// `tool_domain` is a pure name classifier so it is exhaustively unit-testable
// without a running kernel — the same discipline as the smart-table parity
// tests.

use std::collections::HashSet;

/// Header a caller sets to declare the capability domains its current intent
/// needs, comma-separated (e.g. `vault,smart_table`). Absent => unscoped.
pub const INTENT_HEADER: &str = "x-ctrl-intent";

/// Domains that are always visible regardless of intent: harmless
/// introspection a caller needs to orient itself (kernel health, vault root).
const ALWAYS_ON: &str = "system";

/// First-party domains an in-app caller (the PWA / embedded Irisy) is granted
/// when it does not declare an explicit intent. Broad on purpose — the app is
/// first-party, in-process, behind the loopback Bearer — but it deliberately
/// EXCLUDES `net` (raw http_get/http_post), the prime exfiltration surface the
/// module header calls out. External callers get no such default (see
/// `default_for_caller`): least privilege, declare-or-minimal.
const FIRST_PARTY_DOMAINS: &[&str] = &[
    "vault",
    "smart_table",
    "notes",
    "providers",
    "registry",
    "kv",
    "llm",
    "memory",
    "mcp",
];

/// Callers treated as first-party (in-process app surfaces). The PWA bridge
/// stamps `pwa`; the embedded assistant may stamp `irisy`/`hermes`.
fn is_first_party(caller: &str) -> bool {
    matches!(caller, "pwa" | "irisy" | "hermes")
}

/// Classify a tool name into its capability domain. Tool names are the kernel
/// method names (`vault_read`, `smart_table_query`, ...) plus downstream
/// namespaced `<server>_<tool>` entries. The classifier is prefix-based with a
/// few always-on system tools special-cased first.
///
/// Returns a borrowed token so the result can key a `HashSet<&str>` membership
/// check with zero allocation on the hot path.
pub fn tool_domain(tool: &str) -> &'static str {
    // Always-on introspection — must be checked before the `vault_` prefix so
    // `vault_root_path` lands in `system`, not `vault`.
    match tool {
        "kernel_status" | "vault_root_path" => return ALWAYS_ON,
        _ => {}
    }
    // Prefix table. Order matters only where one prefix is a prefix of another;
    // none of these are, so the order is for readability.
    const PREFIXES: &[(&str, &str)] = &[
        ("smart_table_", "smart_table"),
        ("irisy_soul_", "memory"),
        ("vault_", "vault"),
        ("notes_", "notes"),
        ("providers_", "providers"),
        ("registry_", "registry"),
        ("kv_", "kv"),
        ("llm_", "llm"),
        ("http_", "net"),
        ("mcp_", "mcp"),
    ];
    for (prefix, domain) in PREFIXES {
        if tool.starts_with(prefix) {
            return domain;
        }
    }
    // Downstream MCP servers surface as `<server>_<tool>`; classify them under
    // a single `mcp` domain so an intent can opt into "external mcp tools" as a
    // group without enumerating every server id.
    "mcp"
}

/// The capability domains a caller's current intent is scoped to. `None` means
/// unscoped — the gate exposes the full toolset (migration / no-header default).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Intent {
    domains: Option<HashSet<String>>,
}

impl Intent {
    /// Parse the `X-Ctrl-Intent` header value. Absent, empty, or all-blank =>
    /// unscoped. Otherwise the comma-separated domain tokens (trimmed,
    /// lowercased, blanks dropped). An explicit but fully-blank value is
    /// treated as unscoped rather than "deny everything" to avoid a caller
    /// accidentally locking itself out with a stray comma.
    pub fn parse(raw: Option<&str>) -> Self {
        let Some(raw) = raw else {
            return Self { domains: None };
        };
        let domains: HashSet<String> = raw
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        if domains.is_empty() {
            Self { domains: None }
        } else {
            Self {
                domains: Some(domains),
            }
        }
    }

    /// An explicitly unscoped intent (full toolset). Used for IN-PROCESS calls
    /// with no request context (no external caller to least-privilege). NOT used
    /// on the HTTP gate path — there, an absent header resolves through
    /// `default_for_caller`, never to unscoped-full.
    pub fn unscoped() -> Self {
        Self { domains: None }
    }

    /// Scope to exactly these capability domains (plus always-on system).
    pub fn scoped_to<I: IntoIterator<Item = String>>(domains: I) -> Self {
        Self {
            domains: Some(domains.into_iter().collect()),
        }
    }

    /// The minimal scope: only always-on system tools. An external caller that
    /// declares no intent gets this — it must opt in to anything more.
    pub fn minimal() -> Self {
        Self {
            domains: Some(HashSet::new()),
        }
    }

    /// The effective scope when a caller sends NO (or blank) intent header.
    /// First-party in-app callers get the broad first-party set; everyone else
    /// gets `minimal` — closing the former "no header => full toolset" hole
    /// (ADR-010 communication § trust-domains v3, SC3: project by (caller, intent)).
    pub fn default_for_caller(caller: &str) -> Self {
        if is_first_party(caller) {
            Self::scoped_to(FIRST_PARTY_DOMAINS.iter().map(|s| s.to_string()))
        } else {
            Self::minimal()
        }
    }

    /// Whether this intent is scoped to a subset (vs. unscoped/full).
    pub fn is_scoped(&self) -> bool {
        self.domains.is_some()
    }

    /// Whether a capability domain is permitted under this intent. Always-on
    /// system tools are permitted regardless of scope.
    pub fn allows_domain(&self, domain: &str) -> bool {
        if domain == ALWAYS_ON {
            return true;
        }
        match &self.domains {
            None => true,
            Some(set) => set.contains(domain),
        }
    }

    /// Whether a specific tool is visible/callable under this intent.
    pub fn allows_tool(&self, tool: &str) -> bool {
        self.allows_domain(tool_domain(tool))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_classification_covers_every_tool_family() {
        assert_eq!(tool_domain("vault_read"), "vault");
        assert_eq!(tool_domain("vault_write"), "vault");
        assert_eq!(tool_domain("vault_semantic_search"), "vault");
        assert_eq!(tool_domain("smart_table_query"), "smart_table");
        assert_eq!(tool_domain("notes_query"), "notes");
        assert_eq!(tool_domain("providers_describe"), "providers");
        assert_eq!(tool_domain("registry_query"), "registry");
        assert_eq!(tool_domain("kv_get"), "kv");
        assert_eq!(tool_domain("llm_chat"), "llm");
        assert_eq!(tool_domain("http_get"), "net");
        assert_eq!(tool_domain("http_post"), "net");
        assert_eq!(tool_domain("mcp_proxy_call_tool"), "mcp");
        assert_eq!(tool_domain("irisy_soul_get"), "memory");
        // Downstream namespaced tool falls under the mcp group.
        assert_eq!(tool_domain("obsidian_search_notes"), "mcp");
    }

    #[test]
    fn system_tools_are_always_on_not_vault() {
        assert_eq!(tool_domain("kernel_status"), "system");
        // Special-cased before the `vault_` prefix.
        assert_eq!(tool_domain("vault_root_path"), "system");
    }

    #[test]
    fn no_header_is_unscoped_full_toolset() {
        let intent = Intent::parse(None);
        assert!(!intent.is_scoped());
        assert!(intent.allows_tool("vault_write"));
        assert!(intent.allows_tool("http_post"));
    }

    #[test]
    fn blank_or_comma_only_header_is_unscoped() {
        assert!(!Intent::parse(Some("")).is_scoped());
        assert!(!Intent::parse(Some("   ")).is_scoped());
        assert!(!Intent::parse(Some(",, ,")).is_scoped());
    }

    #[test]
    fn scoped_intent_projects_to_declared_domains_only() {
        let intent = Intent::parse(Some("vault, smart_table"));
        assert!(intent.is_scoped());
        // In-scope domains visible.
        assert!(intent.allows_tool("vault_read"));
        assert!(intent.allows_tool("smart_table_query"));
        // Out-of-scope domains hidden — least privilege (no exfiltration path).
        assert!(!intent.allows_tool("http_post"));
        assert!(!intent.allows_tool("llm_chat"));
        assert!(!intent.allows_tool("kv_get"));
        // Always-on system tools remain visible even when scoped.
        assert!(intent.allows_tool("kernel_status"));
        assert!(intent.allows_tool("vault_root_path"));
    }

    #[test]
    fn unknown_caller_without_intent_is_minimal_not_full() {
        // The SC3 hole: an external caller that declares no intent used to see
        // every tool. Now it sees only always-on system tools.
        let intent = Intent::default_for_caller("some-random-agent");
        assert!(intent.is_scoped());
        assert!(intent.allows_tool("kernel_status"));
        assert!(intent.allows_tool("vault_root_path"));
        assert!(!intent.allows_tool("vault_read"));
        assert!(!intent.allows_tool("http_post"));
        assert!(!intent.allows_tool("llm_chat"));
    }

    #[test]
    fn first_party_caller_without_intent_gets_broad_but_not_net() {
        // The in-app PWA (caller `pwa`) needs its toolset without declaring an
        // intent, but raw network stays off even for first-party.
        let intent = Intent::default_for_caller("pwa");
        assert!(intent.allows_tool("vault_read"));
        assert!(intent.allows_tool("vault_write"));
        assert!(intent.allows_tool("smart_table_query"));
        assert!(intent.allows_tool("llm_chat"));
        assert!(intent.allows_tool("kernel_status"));
        // net (raw http) is excluded from the first-party default.
        assert!(!intent.allows_tool("http_post"));
        // Irisy/hermes are first-party too.
        assert!(Intent::default_for_caller("irisy").allows_tool("vault_read"));
    }

    #[test]
    fn minimal_allows_only_system() {
        let intent = Intent::minimal();
        assert!(intent.is_scoped());
        assert!(intent.allows_tool("kernel_status"));
        assert!(!intent.allows_tool("vault_read"));
    }

    #[test]
    fn parsing_is_case_and_whitespace_insensitive() {
        let intent = Intent::parse(Some("  VAULT ,Net "));
        assert!(intent.allows_tool("vault_read"));
        assert!(intent.allows_tool("http_get"));
        assert!(!intent.allows_tool("smart_table_query"));
    }
}
