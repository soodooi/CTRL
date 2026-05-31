// Provider trait — the single contract every LLM backend implements.
//
// ADR-004 §9.1 lock #1:
//   - chat_stream(prompt, opts) -> Stream<Chunk>
//   - trial_verify() -> Result
//   - capabilities() -> Set<Capability>
//
// Stream is `mpsc::Receiver<Result<ChatChunk, ProviderError>>` to match
// what existing Tauri commands already consume (chat.rs, irisy_chat.rs,
// draft_run.rs). Wrapping it in a futures::Stream + Pin<Box<...>> would
// force every caller into a one-PR rewrite — we postpone that until
// there is a second-consumer reason.
//
// `trial_verify()` is a SHALLOW liveness probe — does NOT actually send
// chat. The full 1-token "hi" round trip lives in `verify::trial_chat`,
// which uses `chat_stream` under the hood. Keeping the two separated lets
// adapters implement a cheap "binary exists / keychain key present" check
// without having to spawn the network path.

use async_trait::async_trait;
use std::collections::BTreeSet;
use tokio::sync::mpsc;

use super::types::{ChatChunk, ChatOpts, ChatPrompt, ProviderError};

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

/// One concrete provider — claude_persistent / one_shot_cli / http_api.
/// Holds its own credentials + connection pool; constructed once per
/// boot from a `ProviderManifest` and held in `ProviderRegistry`.
#[async_trait]
pub trait Provider: Send + Sync {
    /// Manifest id, e.g. "claude-oauth" / "anthropic-api" / "volc".
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

    /// Shallow liveness — "are credentials present, binary executable
    /// reachable, endpoint URL syntactically OK". Does NOT issue any
    /// network or subprocess call; full 1-token chat is the registry's
    /// `verify::trial_chat`.
    fn trial_verify(&self) -> Result<(), ProviderError>;
}
