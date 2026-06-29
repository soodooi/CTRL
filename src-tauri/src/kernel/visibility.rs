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
// domains; the gate enforces them. When no intent header is present the gate
// resolves through `default_for_caller`: first-party in-app callers (pwa /
// irisy / hermes) get the broad first-party domain set, every other caller
// gets `minimal` (always-on system tools only) — least privilege, never the
// full toolset (ADR-010 communication § trust-domains v3, SC3). The Bearer
// token on loopback remains the primary gate; intent-scoping is
// defense-in-depth layered on top.
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
    // Controlled market-data tools (market_quote / market_screen) — they GET
    // only fixed Yahoo endpoints and cannot reach an arbitrary URL or POST, so
    // unlike `net` they are safe in the first-party default (ADR-010
    // communication § trust-domains v3, SC3; bao 2026-06-26).
    "market",
    // Controlled web search (web_search) — calls only fixed search backends
    // (Tavily BYOK / keyless Wikipedia), never a raw fetch, so it is safe in the
    // first-party default while `net` stays closed (ADR-010 § trust-domains v9).
    "websearch",
    // Controlled discovery tools (discover_packs / discover_skills) — they GET
    // only fixed catalog backends (the MCP Registry / GitHub code search), never
    // a raw fetch or user-data POST, so like `websearch` they are safe in the
    // first-party default while `net` stays closed. These are the feature-pack
    // creation take-stock channels Irisy searches before authoring a pack
    // (ADR-002 substrate § composition §7.4; ADR-010 § trust-domains, SC3).
    "discover",
    // Local skill tools (skill_list / skill_read) — read-only over the user's
    // own ~/.claude/skills + plugin cache, no network, path-confined to SKILL.md
    // files. First-party so Irisy can reuse a skill the user already has when
    // building a pack.
    "skill",
];

/// Callers treated as first-party (in-process app surfaces). The PWA bridge
/// stamps `pwa`; the embedded assistant may stamp `irisy`/`hermes`. Also used
/// by the review gate (ADR-002 §264) to scope human-approval to EXTERNAL
/// callers (the BYO-CLI brain) — first-party app surfaces are CTRL's own.
pub fn is_first_party(caller: &str) -> bool {
    matches!(caller, "pwa" | "irisy" | "hermes")
}

/// The embedded brain (hermes) surfaces at most ~25 tools to the model and
/// arbitrarily truncates the rest by list order. The first-party domain set
/// projects ~60 tools (the `vault` domain alone is ~35), so that truncation
/// silently dropped the ENTIRE feature-pack creation + research suite
/// (`mcp_pack_*`, `discover_*`, `skill_*`, `web_search`) — they sort late in
/// declaration order. Verified on real hardware 2026-06-28: Gemini-via-hermes
/// received 25 vault/table tools, none of the creation tools, and hallucinated a
/// "edit knowledge-base files by hand" workaround instead of building a pack.
///
/// So for the capped brain we project a CURATED, ORDERED allowlist that fits
/// under the cap and lists the creation + research suite FIRST — the brain keeps
/// the head of the list when it truncates, so the killer capability can never be
/// cut. Domain-level scoping is too coarse to fix this (it can't trim within the
/// 35-tool `vault` domain); tool-level curation for the one caller that has a
/// hard cap is the natural extension of this module's anti-flood purpose. This
/// is governance config (which kernel tools the brain sees), not hardcoded pack
/// content. The PWA (`pwa`) is NOT capped — it renders tools in its own UI with
/// no model limit — so it keeps the full first-party set.
pub const BRAIN_TOOLSET: &[&str] = &[
    // Always-on system introspection.
    "kernel_status",
    // Feature-pack creation + take-stock research — Irisy's killer capability.
    // FIRST so the brain's tool cap can never truncate it away.
    "discover_packs",
    "discover_skills",
    "web_search",
    "skill_list",
    "skill_read",
    "mcp_pack_list",
    "mcp_pack_install",
    "mcp_pack_run",
    "mcp_pack_uninstall",
    "mcp_pack_write_file",
    "mcp_list_servers",
    // Core vault — Irisy as the notes / knowledge companion.
    "vault_read",
    "vault_write",
    "vault_search",
    "vault_list",
    "vault_create_folder",
    // Persistent memory — SOUL.md (ADR-005 irisy §8.8 fix 2026-06-29). The
    // capability brief promises Irisy long-term memory via these tools; without
    // them in the curated set the brain never saw them (dropped by the tool cap),
    // so the promise was a lie. In the core group so the cap can't truncate them.
    "irisy_soul_get",
    "irisy_soul_set",
    // Structured data.
    "smart_table_describe",
    "smart_table_query",
    // Watchlist / market data.
    "market_quote",
    "market_screen",
    // Setup + reasoning.
    "providers_query",
    "registry_query",
    "llm_chat",
];

/// Whether the curated `BRAIN_TOOLSET` should be applied for this caller. Only
/// the embedded brain (hermes) has the model-side tool cap that makes an
/// uncurated ~60-tool listing truncate destructively.
pub fn is_capped_brain(caller: &str) -> bool {
    caller == "hermes"
}

/// Position of a tool in `BRAIN_TOOLSET` (its priority rank), or None if the
/// tool is not in the curated brain set. Used to both FILTER (drop None) and
/// ORDER (sort by rank) the brain's `tools/list`, so the prioritized creation
/// suite always survives the brain's truncation.
pub fn brain_tool_rank(tool: &str) -> Option<usize> {
    BRAIN_TOOLSET.iter().position(|t| *t == tool)
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
        // Controlled web search — exact-match (not a `web_` prefix) so a future
        // raw `web_fetch` would NOT inherit the first-party `websearch` domain
        // (ADR-010 communication § trust-domains v9, SC3).
        "web_search" => return "websearch",
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
        ("market_", "market"),
        ("discover_", "discover"),
        ("skill_", "skill"),
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

/// Source-aware classifier: a tool whose name matches an installed downstream
/// server's `<id>_` namespace is the `mcp` domain, checked FIRST — mirroring the
/// dispatch router (`dispatch_tool`), which routes `<server>_<tool>` to the
/// downstream host before the static kernel router. Without this, a downstream
/// tool whose namespaced name collides with a first-party prefix (a user-chosen
/// server id `vault` / `market` / `notes` ...) or literally produces a
/// first-party exact name (server `web` + tool `search` => `web_search`) would
/// be misclassified into a first-party domain and become visible/callable under
/// a narrow intent or the BYO-CLI default that excludes `mcp` — a least-privilege
/// leak (ADR-010 communication § trust-domains, SC3). Classifying by source (not
/// just by name string) keeps visibility consistent with routing: whatever
/// dispatch sends downstream is gated as `mcp`.
pub fn tool_domain_with_downstream(tool: &str, downstream_ids: &[String]) -> &'static str {
    for id in downstream_ids {
        // Match the dispatch router's precedence exactly: `<id>_<tool>`.
        if let Some(rest) = tool.strip_prefix(id.as_str()) {
            if rest.starts_with('_') {
                return "mcp";
            }
        }
    }
    tool_domain(tool)
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

    /// Like `allows_tool`, but source-aware: any tool matching an installed
    /// downstream server's `<id>_` namespace is gated as the `mcp` domain even
    /// if its name collides with a first-party prefix/exact name (see
    /// `tool_domain_with_downstream`). Use this on the gate path where the set
    /// of installed downstream server ids is known.
    pub fn allows_tool_with_downstream(&self, tool: &str, downstream_ids: &[String]) -> bool {
        self.allows_domain(tool_domain_with_downstream(tool, downstream_ids))
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
        assert_eq!(tool_domain("market_quote"), "market");
        assert_eq!(tool_domain("market_screen"), "market");
        assert_eq!(tool_domain("web_search"), "websearch");
        assert_eq!(tool_domain("discover_packs"), "discover");
        assert_eq!(tool_domain("discover_skills"), "discover");
        assert_eq!(tool_domain("skill_list"), "skill");
        assert_eq!(tool_domain("skill_read"), "skill");
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
    fn parse_none_is_unscoped_in_process_only() {
        // `Intent::parse(None)` yields the unscoped/full-toolset value. This
        // semantics is reachable ONLY on IN-PROCESS calls with no request
        // context (no external caller to least-privilege). The HTTP gate path
        // NEVER reaches it: an absent header there resolves through
        // `default_for_caller` (first-party => broad set, unknown => minimal),
        // so an external caller can never see the full toolset by omitting the
        // header (ADR-010 communication § trust-domains v3, SC3). See
        // `unknown_caller_without_intent_is_minimal_not_full` for the gate path.
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
        // ...but the CONTROLLED market tools ARE first-party visible: they GET
        // only fixed Yahoo endpoints, so they carry no exfil risk (SC3; bao
        // 2026-06-26). This is what lets Irisy quote a watchlist without net.
        assert!(intent.allows_tool("market_quote"));
        assert!(intent.allows_tool("market_screen"));
        assert!(intent.allows_tool("web_search"));
        // Irisy/hermes are first-party too.
        assert!(Intent::default_for_caller("irisy").allows_tool("vault_read"));
        assert!(Intent::default_for_caller("hermes").allows_tool("market_quote"));
        assert!(Intent::default_for_caller("hermes").allows_tool("web_search"));
        // Even first-party never gets raw net by default.
        assert!(!Intent::default_for_caller("hermes").allows_tool("http_get"));
    }

    #[test]
    fn minimal_allows_only_system() {
        let intent = Intent::minimal();
        assert!(intent.is_scoped());
        assert!(intent.allows_tool("kernel_status"));
        assert!(!intent.allows_tool("vault_read"));
    }

    #[test]
    fn downstream_tool_is_mcp_even_when_name_collides_with_first_party() {
        // A user-installed downstream server whose namespaced tool name collides
        // with a first-party domain must NOT leak into that first-party domain
        // (ADR-010 § trust-domains, SC3). Without source awareness `web_search`
        // (server `web` + tool `search`) classifies as `websearch`, and a server
        // id colliding with a reserved prefix (`vault`/`market`/`notes`) would
        // classify as that first-party domain — visible under a narrow intent or
        // the BYO-CLI default that excludes `mcp`.
        let ids = vec![
            "web".to_string(),
            "vault".to_string(),
            "market".to_string(),
            "notes".to_string(),
        ];
        assert_eq!(tool_domain_with_downstream("web_search", &ids), "mcp");
        assert_eq!(tool_domain_with_downstream("vault_read", &ids), "mcp");
        assert_eq!(tool_domain_with_downstream("market_quote", &ids), "mcp");
        assert_eq!(tool_domain_with_downstream("notes_query", &ids), "mcp");
        // A genuine first-party tool (no colliding server installed) is untouched.
        let no_collision = vec!["obsidian".to_string()];
        assert_eq!(
            tool_domain_with_downstream("web_search", &no_collision),
            "websearch"
        );
        assert_eq!(
            tool_domain_with_downstream("vault_read", &no_collision),
            "vault"
        );
        // The normal downstream namespaced tool still groups under mcp.
        assert_eq!(
            tool_domain_with_downstream("obsidian_search_notes", &no_collision),
            "mcp"
        );

        // The leak is closed at the Intent boundary: under a narrow `websearch`
        // intent the colliding downstream tool is hidden, while the real
        // first-party web_search stays visible.
        let intent = Intent::parse(Some("websearch"));
        assert!(!intent.allows_tool_with_downstream("web_search", &ids));
        assert!(intent.allows_tool_with_downstream("web_search", &no_collision));
        // And under an `mcp` intent the downstream tool is correctly reachable.
        let mcp_intent = Intent::parse(Some("mcp"));
        assert!(mcp_intent.allows_tool_with_downstream("web_search", &ids));
    }

    #[test]
    fn brain_toolset_includes_creation_suite_and_fits_under_cap() {
        // The whole point: the feature-pack creation + research suite must be in
        // the curated brain set, or the brain's ~25 cap hides Irisy's killer
        // capability (regression guard for the 2026-06-28 real-hardware failure).
        for must in [
            "discover_packs",
            "discover_skills",
            "web_search",
            "skill_list",
            "skill_read",
            "mcp_pack_list",
            "mcp_pack_install",
            "mcp_pack_run",
            "mcp_pack_uninstall",
            "mcp_pack_write_file",
        ] {
            assert!(
                brain_tool_rank(must).is_some(),
                "{must} missing from BRAIN_TOOLSET — brain can't create packs"
            );
        }
        // Fits under the brain's tool cap. Ceiling is 27 since the SOUL memory
        // pair joined the core set (ADR-005 §8.8 fix) — still far under the ~60
        // where listing truncates destructively, and the niche tools sit at the
        // tail so any runtime cap trims those, never the creation/memory core.
        assert!(
            BRAIN_TOOLSET.len() <= 27,
            "BRAIN_TOOLSET is {} tools, over the brain cap",
            BRAIN_TOOLSET.len()
        );
        // Ordered creation-first: the creation suite outranks the niche tools, so
        // truncation keeps it. discover_packs must come before llm_chat.
        assert!(brain_tool_rank("discover_packs") < brain_tool_rank("llm_chat"));
        // Only hermes is curated; the PWA keeps the full first-party set.
        assert!(is_capped_brain("hermes"));
        assert!(!is_capped_brain("pwa"));
        assert!(!is_capped_brain("irisy"));
    }

    #[test]
    fn parsing_is_case_and_whitespace_insensitive() {
        let intent = Intent::parse(Some("  VAULT ,Net "));
        assert!(intent.allows_tool("vault_read"));
        assert!(intent.allows_tool("http_get"));
        assert!(!intent.allows_tool("smart_table_query"));
    }
}
