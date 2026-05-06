// Anthropic Claude native messages API adapter.
// Different from OpenAI: x-api-key header (not Bearer), required anthropic-version header,
// content[] array in response (not choices[].message.content).

use serde::{Deserialize, Serialize};

use crate::application::ports::{ChatRequest, ChatResponse, LlmPort};
use crate::error::{Result, SpikeError};

pub struct AnthropicAdapter {
    base_url: String,
    api_key: String,
    default_model: String,
}

impl AnthropicAdapter {
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
struct MessagesBody<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<Message<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: String,
}

impl LlmPort for AnthropicAdapter {
    fn chat(&self, request: &ChatRequest) -> Result<ChatResponse> {
        let url = format!("{}/messages", self.base_url.trim_end_matches('/'));
        let model = if request.model.is_empty() {
            self.default_model.as_str()
        } else {
            request.model.as_str()
        };

        let messages = vec![Message {
            role: "user",
            content: &request.user,
        }];
        let body = MessagesBody {
            model,
            max_tokens: request.max_tokens.unwrap_or(1024),
            messages,
            system: request.system.as_deref(),
            temperature: request.temperature,
        };

        let response = ureq::post(&url)
            .set("x-api-key", &self.api_key)
            .set("anthropic-version", "2023-06-01")
            .set("Content-Type", "application/json")
            .send_json(&body)
            .map_err(|e| {
                SpikeError::CaptureFailed(format!("Anthropic request to {} failed: {}", url, e))
            })?;

        let parsed: AnthropicResponse = response
            .into_json()
            .map_err(|e| SpikeError::CaptureFailed(format!("Anthropic response parse: {}", e)))?;

        let text = parsed
            .content
            .into_iter()
            .next()
            .map(|c| c.text)
            .ok_or_else(|| SpikeError::CaptureFailed("Anthropic returned no content".into()))?;
        Ok(ChatResponse { text })
    }
}
