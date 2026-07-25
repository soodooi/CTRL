// Provider trait — the single contract every LLM backend implements.
//
// Runtime availability is an adapter-owned bounded probe and remains separate
// from configuration, the real production trial, and explicit role binding.
// Remote providers default to `Unknown`; local adapters may report a concrete
// system fact. (ADR-002 substrate § provider v70)

use async_trait::async_trait;
use std::collections::BTreeSet;
use tokio::sync::mpsc;

use super::types::{ChatChunk, ChatOpts, ChatPrompt, ProviderError};

/// Adapter-owned runtime fact. `Unknown` is honest for remote providers that
/// cannot prove availability without the production trial; local runtimes may
/// return `Available` or `Unavailable` from a bounded dependency probe.
/// (ADR-002 substrate § provider v70)
#[derive(Debug, Clone, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderRuntimeStatus {
    Unknown,
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ProviderRuntimeAvailability {
    pub status: ProviderRuntimeStatus,
    pub detail: Option<String>,
}

impl ProviderRuntimeAvailability {
    pub fn unknown() -> Self {
        Self {
            status: ProviderRuntimeStatus::Unknown,
            detail: None,
        }
    }
}

/// Stable capability tokens. Today we ship `text.chat` only; the others
/// reserve namespace for v1.1+ (image generation, transcription) so a
/// manifest can declare them today and the registry's `active_provider(
/// capability)` lookup keeps working when they land.
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    #[serde(rename = "text.chat")]
    TextChat,
    #[serde(rename = "text.embed")]
    TextEmbed,
    #[serde(rename = "image.generate")]
    ImageGenerate,
    #[serde(rename = "audio.tts")]
    AudioTts,
    #[serde(rename = "audio.transcribe")]
    AudioTranscribe,
}

impl Capability {
    /// Canonical string id — matches what TOML manifests carry. Lets us
    /// log per-capability events without round-tripping through serde.
    pub fn id(&self) -> &'static str {
        match self {
            Self::TextChat => "text.chat",
            Self::TextEmbed => "text.embed",
            Self::ImageGenerate => "image.generate",
            Self::AudioTts => "audio.tts",
            Self::AudioTranscribe => "audio.transcribe",
        }
    }

    /// Parse the canonical id back to an enum variant. Returns `None`
    /// for unknown ids — caller decides whether to log / skip / error.
    pub fn from_id(s: &str) -> Option<Self> {
        match s {
            "text.chat" => Some(Self::TextChat),
            "text.embed" => Some(Self::TextEmbed),
            "image.generate" => Some(Self::ImageGenerate),
            "audio.tts" => Some(Self::AudioTts),
            "audio.transcribe" => Some(Self::AudioTranscribe),
            _ => None,
        }
    }
}

/// One concrete provider — one_shot_cli / http_api / rest_* (ADR-002
/// substrate § provider v61, 2026-07-11: claude_persistent removed).
/// Holds its own credentials + connection pool; constructed once per
/// boot from a `ProviderManifest` and held in `ProviderRegistry`.
#[async_trait]
pub trait Provider: Send + Sync {
    /// Manifest id, e.g. "anthropic-api" / "volc" / "ollama".
    fn id(&self) -> &str;

    /// Capabilities this provider satisfies. The registry consults this
    /// when answering `active_provider(capability)` lookups.
    fn capabilities(&self) -> BTreeSet<Capability>;

    /// Stream a chat completion. `opts.model` empty → manifest default.
    /// `opts.deadline_ms == 0` → adapter default. Returns immediately
    /// with a receiver; the worker future runs on the caller's tokio
    /// runtime.
    async fn chat_stream(
        &self,
        prompt: &ChatPrompt,
        opts: &ChatOpts,
    ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError>;

    /// Bounded, adapter-specific runtime dependency probe. The default is
    /// `Unknown`: remote providers are verified only by the real production
    /// trial. Local-runtime adapters override this to report system facts such
    /// as daemon reachability and selected-model presence.
    /// (ADR-002 substrate § provider v70)
    async fn runtime_availability(&self) -> ProviderRuntimeAvailability {
        ProviderRuntimeAvailability::unknown()
    }

    /// Shallow liveness — "are credentials present, binary executable
    /// reachable, endpoint URL syntactically OK". Does NOT issue any
    /// network or subprocess call; full 1-token chat is the registry's
    /// `verify::trial_chat`.
    fn trial_verify(&self) -> Result<(), ProviderError>;
}

// ── ADR-002 substrate § provider v2 — role-aware routing ─────────────

/// Consumer role — who is asking for a provider. v2 collapsed from 3 to 2
/// roles after bao 2026-05-31 amendment (drop mcp.default): mcps
/// bind providers via their manifest `brain_capabilities`, not via a
/// substrate-wide default. `Custom(String)` reserves namespace for future
/// per-consumer overrides without re-bumping the enum.
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd, Hash, serde::Serialize, serde::Deserialize)]
pub enum Consumer {
    /// Explicit `irisy.primary` binding. Unset until the user activates a
    /// provider through the production trial.
    IrisyPrimary,
    /// Explicit `irisy.fallback` binding. Unset until separately activated;
    /// catalogue or local-runtime presence never seeds this role.
    /// (ADR-002 substrate § provider v70)
    IrisyFallback,
    /// Free-form consumer id — reserved for mcps / future modes that
    /// declare their own routing slot without an enum bump.
    ///
    /// ADR-002 substrate § brain v13 (2026-06-07, retracts v11 §3.11):
    /// `CodingPrimary` variant REMOVED. Pi already owns provider
    /// selection via `~/.pi/agent/models.json`; CTRL does not maintain
    /// a parallel SSOT slot for the Coding L1 chip. Same Pi binary,
    /// same config — chat panel and coding TUI share state.
    Custom(String),
}

impl Consumer {
    /// Canonical id used in the persisted JSON + the `/text-chat?consumer=`
    /// query parameter. Stable across releases.
    pub fn id(&self) -> String {
        match self {
            Self::IrisyPrimary => "irisy.primary".to_string(),
            Self::IrisyFallback => "irisy.fallback".to_string(),
            Self::Custom(s) => s.clone(),
        }
    }

    /// Parse a wire id back to the enum. Unknown ids fall through to
    /// `Custom(s)` so callers don't have to coordinate enum bumps with
    /// every new consumer rolled out.
    pub fn from_id(s: &str) -> Self {
        match s {
            "irisy.primary" => Self::IrisyPrimary,
            "irisy.fallback" => Self::IrisyFallback,
            // ADR-002 substrate § brain v13 (2026-06-07): retracted slot
            // falls through to Custom so existing SSOT files don't crash.
            other => Self::Custom(other.to_string()),
        }
    }
}

/// Explicit verified route chain. For `IrisyPrimary`, the router tries only
/// the user-bound primary and separately bound fallback whose current evidence
/// still matches. Empty means no routable intent; callers must not scan the
/// catalogue. (ADR-002 substrate § provider v71)
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct RouteChain {
    /// Explicit provider id for this role, or `None` when unbound.
    pub primary: Option<String>,
    /// Explicit fallback ids; at most the separately bound Irisy fallback today.
    pub fallbacks: Vec<String>,
}

#[cfg(test)]
mod tests {
    // P1 — Chat -> Provider route identity. These contracts decide which
    // brain an Irisy turn is routed to; getting them wrong means the reply
    // comes from the wrong provider (or the call panics on an unknown slot).
    // GOAL.md SC5 — route resolution. The route_text_chat failover/cooldown
    // behaviour needs a fake Provider + registry harness and is a follow-up.
    use super::*;

    #[test]
    fn consumer_id_roundtrips_for_known_roles() {
        assert_eq!(Consumer::IrisyPrimary.id(), "irisy.primary");
        assert_eq!(Consumer::IrisyFallback.id(), "irisy.fallback");
        assert_eq!(Consumer::from_id("irisy.primary"), Consumer::IrisyPrimary);
        assert_eq!(Consumer::from_id("irisy.fallback"), Consumer::IrisyFallback);
    }

    #[test]
    fn consumer_unknown_id_falls_through_to_custom_without_panic() {
        // ADR-002 § brain v13: a retracted slot (e.g. the removed
        // coding.primary) must parse to Custom, never crash an old SSOT file.
        assert_eq!(
            Consumer::from_id("coding.primary"),
            Consumer::Custom("coding.primary".to_string())
        );
        // A Custom id re-serialises to itself (round-trip stable).
        assert_eq!(Consumer::from_id("x.y").id(), "x.y");
    }

    #[test]
    fn capability_id_roundtrips_for_all_variants() {
        for cap in [
            Capability::TextChat,
            Capability::TextEmbed,
            Capability::ImageGenerate,
            Capability::AudioTts,
            Capability::AudioTranscribe,
        ] {
            assert_eq!(Capability::from_id(cap.id()), Some(cap.clone()));
        }
    }

    #[test]
    fn capability_text_chat_has_canonical_id() {
        assert_eq!(Capability::TextChat.id(), "text.chat");
    }

    #[test]
    fn capability_unknown_id_is_none() {
        assert_eq!(Capability::from_id("text.summarize"), None);
    }

    #[test]
    fn route_chain_default_is_unconfigured() {
        // Empty primary = surface a "configure provider" prompt, NOT a
        // silent fallback-quota spend (see RouteChain doc above).
        let chain = RouteChain::default();
        assert!(chain.primary.is_none());
        assert!(chain.fallbacks.is_empty());
    }
}
