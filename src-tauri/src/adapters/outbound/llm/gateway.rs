// LlmGateway — routes ChatRequests to the right provider adapter by profile name.
// Itself implements LlmPort; the step_runner just calls it like any other LlmPort.

use std::collections::HashMap;
use std::sync::Arc;

use crate::adapters::outbound::llm::{AnthropicAdapter, OpenAiCompatibleAdapter};
use crate::application::ports::{ChatRequest, ChatResponse, LlmPort};
use crate::error::{Result, SpikeError};

#[derive(Debug, Clone)]
pub enum ProviderKind {
    /// Any vendor that speaks OpenAI's `/chat/completions` shape.
    /// Covers: MiniMax (`https://api.minimax.chat/v1`),
    /// DeepSeek, 阿里通义, MoonShot Kimi, 智谱 GLM, OpenAI, Ollama (`http://localhost:11434/v1`).
    OpenAiCompatible,
    /// Claude's native `/v1/messages` endpoint (different request shape, x-api-key header).
    Anthropic,
}

#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub api_key: String,
    pub default_model: String,
}

pub struct LlmGateway {
    profiles: HashMap<String, Arc<dyn LlmPort>>,
    default_profile: String,
}

impl LlmGateway {
    pub fn from_configs(configs: Vec<ProviderConfig>, default_profile: String) -> Result<Self> {
        if configs.is_empty() {
            return Err(SpikeError::ManifestError(
                "LlmGateway requires at least one provider config".into(),
            ));
        }
        let mut profiles: HashMap<String, Arc<dyn LlmPort>> = HashMap::new();
        for cfg in configs {
            let adapter: Arc<dyn LlmPort> = match cfg.kind {
                ProviderKind::OpenAiCompatible => Arc::new(OpenAiCompatibleAdapter::new(
                    cfg.base_url,
                    cfg.api_key,
                    cfg.default_model,
                )),
                ProviderKind::Anthropic => Arc::new(AnthropicAdapter::new(
                    cfg.base_url,
                    cfg.api_key,
                    cfg.default_model,
                )),
            };
            profiles.insert(cfg.name, adapter);
        }
        if !profiles.contains_key(&default_profile) {
            return Err(SpikeError::ManifestError(format!(
                "default profile '{}' not in configured providers",
                default_profile
            )));
        }
        Ok(Self {
            profiles,
            default_profile,
        })
    }

    fn dispatch(&self, profile: Option<&str>, request: &ChatRequest) -> Result<ChatResponse> {
        let key = profile.unwrap_or(&self.default_profile);
        self.profiles
            .get(key)
            .ok_or_else(|| {
                SpikeError::ManifestError(format!("no LLM provider profile named '{}'", key))
            })?
            .chat(request)
    }

    pub fn registered_profiles(&self) -> Vec<&str> {
        self.profiles.keys().map(String::as_str).collect()
    }

    pub fn default_profile_name(&self) -> &str {
        &self.default_profile
    }
}

impl LlmPort for LlmGateway {
    fn chat(&self, request: &ChatRequest) -> Result<ChatResponse> {
        self.dispatch(None, request)
    }

    fn chat_with_profile(
        &self,
        profile: Option<&str>,
        request: &ChatRequest,
    ) -> Result<ChatResponse> {
        self.dispatch(profile, request)
    }
}
