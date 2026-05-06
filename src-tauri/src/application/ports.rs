// Outbound port traits — capabilities the use cases need from the outside world.
// Adapters under `crate::adapters::outbound::*` implement these.

use crate::domain::events::HotkeyEvent;
use crate::domain::tool::Tool;
use crate::error::Result;

#[derive(Debug, Clone, Copy)]
pub enum RawKeyEvent {
    CtrlDown,
    CtrlUp,
    OtherKeyDown,
}

pub type KeyboardCallback = Box<dyn Fn(RawKeyEvent) + Send + Sync + 'static>;

pub trait KeyboardListenerPort: Send + Sync {
    fn start(&self, on_event: KeyboardCallback) -> Result<()>;
}

pub trait SelectionCapturePort: Send + Sync {
    fn get_selected_text(&self) -> Result<String>;
}

pub trait AccessibilityPort: Send + Sync {
    fn is_trusted(&self) -> bool;
    fn request_with_prompt(&self) -> bool;
    fn open_settings(&self);
}

pub trait ClockPort: Send + Sync {
    fn now_ms(&self) -> u64;
}

pub trait EventBusPort: Send + Sync {
    fn emit_hotkey(&self, event: &HotkeyEvent) -> Result<()>;
    fn show_main_window(&self);
}

pub trait ToolRegistryPort: Send + Sync {
    fn list_all(&self) -> Result<Vec<Tool>>;
}

pub trait ClipboardPort: Send + Sync {
    fn read(&self) -> Result<String>;
    fn write(&self, value: &str) -> Result<()>;
}

pub trait BrowserPort: Send + Sync {
    fn open(&self, url: &str) -> Result<()>;
}

pub trait NotifierPort: Send + Sync {
    fn notify(&self, message: &str) -> Result<()>;
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub model: String,
    pub system: Option<String>,
    pub user: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct ChatResponse {
    pub text: String,
}

pub trait LlmPort: Send + Sync {
    fn chat(&self, request: &ChatRequest) -> Result<ChatResponse>;
    /// Profile-aware variant. Default impl ignores profile and forwards to `chat`.
    /// LlmGateway overrides this to dispatch by profile name.
    fn chat_with_profile(
        &self,
        _profile: Option<&str>,
        request: &ChatRequest,
    ) -> Result<ChatResponse> {
        self.chat(request)
    }
}

// -------- Settings / Provider config (non-secret) --------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LlmProfile {
    pub name: String,
    pub kind: String, // "openai-compatible" | "anthropic"
    pub base_url: String,
    pub default_model: String,
    /// Optional inline API key (v0.1 spike convenience).
    /// When present, used directly. When absent, falls back to SecretStorePort
    /// (macOS Keychain). Day 3 settings UI will write to Keychain only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct LlmSettings {
    #[serde(default)]
    pub profiles: Vec<LlmProfile>,
    #[serde(default)]
    pub default_profile: Option<String>,
}

pub trait ConfigStorePort: Send + Sync {
    /// Load LLM settings from disk (returns empty defaults if file missing).
    fn load_llm_settings(&self) -> Result<LlmSettings>;
    /// Persist LLM settings to disk (atomic write recommended).
    fn save_llm_settings(&self, settings: &LlmSettings) -> Result<()>;
}

pub trait SecretStorePort: Send + Sync {
    /// Read a secret keyed by namespace + entry (e.g. "minimax" → api key).
    /// Returns Ok(None) if no entry exists; Err only on real failure.
    fn read(&self, key: &str) -> Result<Option<String>>;
    /// Write/overwrite a secret.
    fn write(&self, key: &str, value: &str) -> Result<()>;
    /// Delete a secret. Idempotent (no error if not present).
    fn delete(&self, key: &str) -> Result<()>;
}
