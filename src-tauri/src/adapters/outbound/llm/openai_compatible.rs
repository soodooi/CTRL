// OpenAI-compatible chat-completions adapter.
// Works with: MiniMax, DeepSeek, Aliyun (通义), MoonShot Kimi, 智谱 GLM, OpenAI, Ollama.

use serde::{Deserialize, Serialize};

use crate::application::ports::{ChatRequest, ChatResponse, LlmPort};
use crate::error::{Result, SpikeError};

pub struct OpenAiCompatibleAdapter {
    base_url: String,
    api_key: String,
    default_model: String,
}

impl OpenAiCompatibleAdapter {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        default_model: impl Into<String>,
    ) -> Self {
        Self {
            base_url: base_url.into(),
            api_key: api_key.into(),
            default_model: default_model.into(),
        }
    }
}

#[derive(Serialize)]
struct ChatBody<'a> {
    model: &'a str,
    messages: Vec<Message<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatCompletion {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Deserialize)]
struct ChoiceMessage {
    content: String,
}

impl LlmPort for OpenAiCompatibleAdapter {
    fn chat(&self, request: &ChatRequest) -> Result<ChatResponse> {
        let url = format!(
            "{}/chat/completions",
            self.base_url.trim_end_matches('/')
        );
        let model = if request.model.is_empty() {
            self.default_model.as_str()
        } else {
            request.model.as_str()
        };

        let mut messages: Vec<Message> = Vec::with_capacity(2);
        if let Some(sys) = request.system.as_deref() {
            messages.push(Message {
                role: "system",
                content: sys,
            });
        }
        messages.push(Message {
            role: "user",
            content: &request.user,
        });

        let body = ChatBody {
            model,
            messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
        };

        let response = ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", self.api_key))
            .set("Content-Type", "application/json")
            .send_json(&body)
            .map_err(|e| {
                SpikeError::CaptureFailed(format!("LLM request to {} failed: {}", url, e))
            })?;

        let parsed: ChatCompletion = response
            .into_json()
            .map_err(|e| SpikeError::CaptureFailed(format!("LLM response parse: {}", e)))?;

        let text = parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| SpikeError::CaptureFailed("LLM returned no choices".into()))?;
        Ok(ChatResponse { text })
    }
}
