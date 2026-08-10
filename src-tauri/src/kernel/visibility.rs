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
    "tasks",
    // Calendar (trait-only §14 source, ADR-002 §14.13 slice 3 + §1.9 v46) —
    // previously its tools fell through to `mcp` (also first-party); now that
    // `calendar_` classifies properly it must stay in the default.
    "calendar",
    // Generic §14 connector source tools (source_describe / source_query /
    // source_produce) — data-driven access to ANY installed connector that
    // declares a `record_source` (ADR-002 §14.12). First-party so Irisy/PWA can
    // operate connectors; per-source authorization (does the caller's intent
    // include THIS source's domain) is a follow-up — v1 gates at tool level.
    "source",
    // Explicit Project Resources are selected by the Work surface and remain
    // opaque; first-party callers may describe/query only that registered ref.
    // (ADR-002 substrate §15 v83; ADR-005 irisy §11 v40)
    "project",
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
    // Read-only metadata diagnostics. Capture and export controls remain on the
    // typed Tauri first-party surface. (ADR-010 communication § diagnostics v11)
    "diagnostics",
];

/// Callers treated as first-party app-owned surfaces. Assistant and Coding
/// remain separate autonomous brains: both use the governed gate, while Coding
/// carries an explicit narrower intent and is never a user-surface approval
/// bypass. (ADR-001 spine §4 v21; ADR-010 communication § trust-domains v13)
pub fn is_first_party(caller: &str) -> bool {
    matches!(caller, "pwa" | "irisy" | "hermes" | "coding")
}

/// User-driven surfaces — the human acting directly through the app. Their gate
/// calls are the user's OWN intent, so they are NOT subject to the write-review
/// gate. Everything else that reaches the gate is an autonomous BRAIN (hermes +
/// BYO CLIs) whose high-blast writes ARE reviewed (ADR-002 §264 / ADR-006 §4,
/// amended 2026-07-04 — bao chose B: the moat covers hermes too, since it is an
/// LLM that can be prompt-injected via notes/web/connector data). Distinct from
/// `is_first_party` (which includes `coding` for intent projection and the net
/// allowlist); only the review gate uses THIS narrower user-surface predicate.
pub fn is_user_surface(caller: &str) -> bool {
    matches!(caller, "pwa" | "irisy")
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
/// (ADR-002 substrate §15 v83)
pub const BRAIN_TOOLSET: &[&str] = &["describe", "query", "produce"];

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
        // The names are always discoverable; ResourceRef-domain authorization
        // is enforced dynamically by the gate and then by the selected owner.
        // (ADR-002 substrate §15 v83)
        "describe" | "query" | "produce" | "kernel_status" | "vault_root_path" => return ALWAYS_ON,
        // Controlled web search — exact-match (not a `web_` prefix) so a future
        // raw `web_fetch` would NOT inherit the first-party `websearch` domain
        // (ADR-010 communication § trust-domains v9, SC3).
        "web_search" => return "websearch",
        _ => {}
    }
    // Prefix table. Order matters only where one prefix is a prefix of another
    // (`notes_` before `note_` — both map to `notes`, so even that pair is
    // order-insensitive in effect); otherwise the order is for readability.
    const PREFIXES: &[(&str, &str)] = &[
        ("smart_table_", "smart_table"),
        ("task_", "tasks"),
        ("source_", "source"),
        ("irisy_soul_", "memory"),
        ("vault_", "vault"),
        // Native note endpoints (ADR-002 §1.9 v46 E-series): `note_` subsumes
        // the older `notes_` — both land in the notes intent domain, so a
        // notes-scoped caller sees note_map/note_get/note_periodic/… (they
        // previously fell through to `mcp` and vanished from the notes scope).
        ("notes_", "notes"),
        ("note_", "notes"),
        // Doc block/fm produce + calendar: notes-suite domains (§14.13).
        ("doc_", "notes"),
        ("calendar_", "calendar"),
        ("providers_", "providers"),
        ("registry_", "registry"),
        ("kv_", "kv"),
        ("llm_", "llm"),
        ("market_", "market"),
        ("discover_", "discover"),
        ("skill_", "skill"),
        // Gate diagnostics remain in their dedicated least-privilege domain.
        // (ADR-010 communication § diagnostics v11)
        ("diagnostics_", "diagnostics"),
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

/// The capability domains and exact tools a caller's current intent is scoped
/// to. `None` domains means unscoped; exact `tool:<name>` entries let an FCT
/// authorize one namespaced downstream tool without granting the whole `mcp`
/// domain. (ADR-002 substrate §15.4 v84)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Intent {
    domains: Option<HashSet<String>>,
    exact_tools: HashSet<String>,
    /// Explicit connector identities from `source:<id>` tokens. A bare `source`
    /// domain grant authorizes NO connector: it would otherwise hand every
    /// installed connector to any caller that wanted one of them.
    /// (ADR-002 substrate §17.5 v85)
    sources: HashSet<String>,
}

impl Intent {
    /// Parse the `X-Ctrl-Intent` header value. Domain tokens are normalized to
    /// lowercase; `tool:<name>` tokens retain an exact, bounded tool identity.
    /// Absent or all-blank remains the legacy unscoped value and is resolved by
    /// the HTTP gate through `default_for_caller`.
    /// (ADR-002 substrate §15.4 v84)
    pub fn parse(raw: Option<&str>) -> Self {
        let Some(raw) = raw else {
            return Self::unscoped();
        };
        let mut domains = HashSet::new();
        let mut exact_tools = HashSet::new();
        let mut sources = HashSet::new();
        for token in raw
            .split(',')
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            if let Some(tool) = token
                .strip_prefix("tool:")
                .map(str::trim)
                .filter(|tool| !tool.is_empty())
            {
                exact_tools.insert(tool.to_owned());
            } else if let Some(source) = token
                .strip_prefix("source:")
                .map(str::trim)
                .filter(|source| !source.is_empty())
            {
                // Narrowing, not a domain: `source` alone stays unauthorizing.
                // (ADR-002 substrate §17.5 v85)
                sources.insert(source.to_owned());
            } else {
                domains.insert(token.to_ascii_lowercase());
            }
        }
        if domains.is_empty() && exact_tools.is_empty() && sources.is_empty() {
            Self::unscoped()
        } else {
            Self {
                domains: Some(domains),
                exact_tools,
                sources,
            }
        }
    }

    /// An explicitly unscoped intent (full toolset). Used for IN-PROCESS calls
    /// with no request context (no external caller to least-privilege). NOT used
    /// on the HTTP gate path — there, an absent header resolves through
    /// `default_for_caller`, never to unscoped-full.
    /// (ADR-002 substrate §15.4 v84)
    pub fn unscoped() -> Self {
        Self {
            domains: None,
            exact_tools: HashSet::new(),
            sources: HashSet::new(),
        }
    }

    /// Scope to exactly these capability domains (plus always-on system).
    /// (ADR-002 substrate §15.4 v84)
    pub fn scoped_to<I: IntoIterator<Item = String>>(domains: I) -> Self {
        Self {
            domains: Some(domains.into_iter().collect()),
            exact_tools: HashSet::new(),
            sources: HashSet::new(),
        }
    }

    /// The minimal scope: only always-on system tools. An external caller that
    /// declares no intent gets this — it must opt in to anything more.
    /// (ADR-002 substrate §15.4 v84)
    pub fn minimal() -> Self {
        Self {
            domains: Some(HashSet::new()),
            exact_tools: HashSet::new(),
            sources: HashSet::new(),
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
    /// (ADR-002 substrate §15.4 v84)
    pub fn allows_tool(&self, tool: &str) -> bool {
        self.exact_tools.contains(tool) || self.allows_domain(tool_domain(tool))
    }

    /// Whether this scope explicitly names one exact tool rather than its domain.
    /// (ADR-002 substrate §15.4 v84)
    pub fn allows_exact_tool(&self, tool: &str) -> bool {
        self.exact_tools.contains(tool)
    }

    /// Whether this intent may operate the named connector.
    ///
    /// A scoped caller must name the connector as `source:<id>`. Holding the
    /// `source` domain is deliberately NOT enough: that grant covers the generic
    /// connector verbs, and treating it as authorization would mean one grant for
    /// "read my spreadsheet selection" also authorized every other installed
    /// connector, including credentialed ones. Naming one source never implies a
    /// sibling, never implies `mcp`, and never widens to raw downstream tools.
    /// (ADR-002 substrate §17.5 v85)
    pub fn allows_source(&self, source_id: &str) -> bool {
        match &self.domains {
            // Unscoped is an in-process call with no external caller to narrow.
            None => true,
            Some(_) => self.sources.contains(source_id),
        }
    }

    /// Like `allows_tool`, but source-aware: any tool matching an installed
    /// downstream server's `<id>_` namespace is gated as the `mcp` domain even
    /// if its name collides with a first-party prefix/exact name. An exact FCT
    /// tool grant is checked first and does not imply any sibling tool.
    /// (ADR-002 substrate §15.4 v84)
    pub fn allows_tool_with_downstream(&self, tool: &str, downstream_ids: &[String]) -> bool {
        self.exact_tools.contains(tool)
            || self.allows_domain(tool_domain_with_downstream(tool, downstream_ids))
    }

    /// Capability facts passed to a ResourceOwner after gate authorization.
    /// Exact tool grants remain visible to the selected owner as `tool:<name>`.
    /// (ADR-002 substrate §15.4 v84)
    pub fn resource_scope(&self) -> Vec<String> {
        match &self.domains {
            None => vec!["*".to_owned()],
            Some(domains) => {
                let mut values: Vec<String> = domains.iter().cloned().collect();
                values.extend(self.exact_tools.iter().map(|tool| format!("tool:{tool}")));
                // Owners see the narrowing too, so an owner that wants to check
                // it does not need a second channel. (ADR-002 substrate §17.5 v85)
                values.extend(self.sources.iter().map(|source| format!("source:{source}")));
                values.sort();
                values
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    /// §17.5: a whole-domain `source` grant authorizes every installed connector
    /// at once, which is what these tests exist to prevent.
    /// (ADR-002 substrate §17.5 v85)
    #[test]
    fn a_bare_source_domain_authorizes_no_connector() {
        let intent = Intent::parse(Some("source"));
        assert!(
            intent.allows_tool("source_query"),
            "the generic verb stays visible under the domain"
        );
        assert!(!intent.allows_source("ctrl-libreoffice"));
        assert!(!intent.allows_source("ctrl-ghostfolio"));
    }

    #[test]
    fn a_named_source_authorizes_only_itself() {
        let intent = Intent::parse(Some("source,source:ctrl-libreoffice"));
        assert!(intent.allows_source("ctrl-libreoffice"));
        // Never a sibling.
        assert!(!intent.allows_source("ctrl-ghostfolio"));
        // Never a prefix or suffix relative.
        assert!(!intent.allows_source("ctrl-libreoffice-extra"));
        assert!(!intent.allows_source("libreoffice"));
    }

    #[test]
    fn naming_a_source_does_not_imply_mcp_or_raw_downstream_tools() {
        let intent = Intent::parse(Some("source:ctrl-libreoffice"));
        assert!(intent.allows_source("ctrl-libreoffice"));
        // The narrowing is not a domain grant: it must not open `mcp`.
        assert!(!intent.allows_domain("mcp"));
        assert!(!intent.allows_tool("mcp_pack_install"));
    }

    #[test]
    fn an_unscoped_in_process_intent_still_reaches_connectors() {
        // No external caller to narrow; this is the in-process path.
        assert!(Intent::unscoped().allows_source("ctrl-libreoffice"));
        // Minimal is scoped and therefore names nothing.
        assert!(!Intent::minimal().allows_source("ctrl-libreoffice"));
    }

    #[test]
    fn a_source_token_is_narrowing_not_a_domain() {
        let intent = Intent::parse(Some("source:ctrl-libreoffice"));
        // It must not be swallowed as a lowercase domain string.
        assert!(!intent.allows_domain("source:ctrl-libreoffice"));
        // Owners can still see the narrowing through the resource scope.
        assert!(intent
            .resource_scope()
            .iter()
            .any(|entry| entry == "source:ctrl-libreoffice"));
    }

    #[test]
    fn a_blank_source_token_grants_nothing() {
        let intent = Intent::parse(Some("source:  , source"));
        assert!(!intent.allows_source(""));
        assert!(!intent.allows_source("ctrl-libreoffice"));
    }

    #[test]
    fn a_first_party_default_names_no_connector() {
        // The PWA's default scope holds the `source` domain, which is exactly the
        // coarse grant §17.5 refuses to treat as authorization.
        let intent = Intent::default_for_caller("pwa");
        assert!(intent.allows_tool("source_query"));
        assert!(!intent.allows_source("ctrl-libreoffice"));
    }

    #[test]
    fn user_surface_excludes_brains() {
        // User-driven surfaces — their gate calls are the user's own intent.
        assert!(is_user_surface("pwa"));
        assert!(is_user_surface("irisy"));
        // Autonomous brains (prompt-injectable) are NOT user surfaces → their
        // high-blast writes go through the review gate (ADR-002 §264, B).
        for b in ["hermes", "byo-cli", "external", "codex", "claude-code"] {
            assert!(!is_user_surface(b), "{b} is a brain, must be reviewed");
        }
    }

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
        assert_eq!(tool_domain("diagnostics_status"), "diagnostics"); // (ADR-010 communication § diagnostics v11)
        assert_eq!(tool_domain("diagnostics_smoke"), "diagnostics");
        assert_eq!(tool_domain("diagnostics_trace"), "diagnostics");
        assert_eq!(tool_domain("mcp_proxy_call_tool"), "mcp");
        assert_eq!(tool_domain("irisy_soul_get"), "memory");
        // Downstream namespaced tool falls under the mcp group.
        assert_eq!(tool_domain("obsidian_search_notes"), "mcp");
        // Native note endpoints land in the notes intent, NOT mcp (ADR-002
        // §1.9 v46 — a notes-scoped caller must see them).
        assert_eq!(tool_domain("note_map"), "notes");
        assert_eq!(tool_domain("note_get"), "notes");
        assert_eq!(tool_domain("note_periodic"), "notes");
        assert_eq!(tool_domain("note_recent_changes"), "notes");
        assert_eq!(tool_domain("note_active_get"), "notes");
        assert_eq!(tool_domain("note_open"), "notes");
        assert_eq!(tool_domain("doc_produce"), "notes");
        assert_eq!(tool_domain("calendar_query"), "calendar");
        assert_eq!(tool_domain("calendar_produce"), "calendar");
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
        assert!(intent.resource_scope().contains(&"project".to_owned()));
        // net (raw http) is excluded from the first-party default.
        assert!(!intent.allows_tool("http_post"));
        // ...but the CONTROLLED market tools ARE first-party visible: they GET
        // only fixed Yahoo endpoints, so they carry no exfil risk (SC3; bao
        // 2026-06-26). This is what lets Irisy quote a watchlist without net.
        assert!(intent.allows_tool("market_quote"));
        assert!(intent.allows_tool("market_screen"));
        assert!(intent.allows_tool("web_search"));
        assert!(intent.allows_tool("diagnostics_status")); // (ADR-010 communication § diagnostics v11)
                                                           // Assistant and Coding are first-party autonomous brains with separate
                                                           // runtime scopes; neither is a direct user-surface approval bypass.
        assert!(Intent::default_for_caller("irisy").allows_tool("vault_read"));
        assert!(Intent::default_for_caller("hermes").allows_tool("market_quote"));
        assert!(Intent::default_for_caller("hermes").allows_tool("web_search"));
        assert!(Intent::default_for_caller("coding").allows_tool("skill_read"));
        assert!(!is_user_surface("coding"));
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

    // Hermes sees exactly the canonical Resource verbs.
    // (ADR-002 substrate §15 v83)
    #[test]
    fn brain_toolset_is_exactly_the_canonical_resource_surface() {
        assert_eq!(BRAIN_TOOLSET, ["describe", "query", "produce"]);
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

    #[test]
    fn exact_tool_scope_does_not_grant_sibling_downstream_tools() {
        // One selected FCT cannot widen authorization to its package siblings.
        // (ADR-002 substrate §15.4 v84)
        let ids = vec!["portfolio".to_owned()];
        let intent = Intent::parse(Some("tool:portfolio_quote"));
        assert!(intent.allows_tool_with_downstream("portfolio_quote", &ids));
        assert!(!intent.allows_tool_with_downstream("portfolio_trade", &ids));
        assert!(!intent.allows_domain("mcp"));
        assert_eq!(intent.resource_scope(), vec!["tool:portfolio_quote"]);
    }
}
