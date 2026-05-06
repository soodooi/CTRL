// Step engine — interprets a Tool's manifest steps. Pure orchestration; talks only to ports.

use std::collections::HashMap;

use crate::application::ports::{
    BrowserPort, ChatRequest, ClipboardPort, LlmPort, NotifierPort, SelectionCapturePort,
};
use crate::domain::tool::Step;
use crate::error::{Result, SpikeError};

pub struct StepPorts<'a> {
    pub clipboard: &'a dyn ClipboardPort,
    pub browser: &'a dyn BrowserPort,
    pub notifier: &'a dyn NotifierPort,
    pub selection: &'a dyn SelectionCapturePort,
    pub llm: Option<&'a dyn LlmPort>,
}

#[derive(Default)]
pub struct StepContext {
    vars: HashMap<String, String>,
    last: Option<String>,
}

impl StepContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn bind(&mut self, name: Option<&str>, value: String) {
        self.last = Some(value.clone());
        if let Some(n) = name {
            self.vars.insert(n.to_string(), value);
        }
    }

    pub fn render(&self, template: &str) -> String {
        let mut out = template.to_string();
        if let Some(prev) = &self.last {
            out = out.replace("{{$prev}}", prev);
        }
        for (k, v) in &self.vars {
            let placeholder = format!("{{{{{}}}}}", k);
            out = out.replace(&placeholder, v);
        }
        out
    }
}

pub fn run_steps(steps: &[Step], ports: &StepPorts) -> Result<String> {
    let mut ctx = StepContext::new();

    for step in steps {
        match step {
            Step::CaptureSelection { var } => {
                let text = ports.selection.get_selected_text()?;
                ctx.bind(var.as_deref(), text);
            }
            Step::CaptureClipboard { var } => {
                let text = ports.clipboard.read()?;
                ctx.bind(var.as_deref(), text);
            }
            Step::Template { template, var } => {
                let rendered = ctx.render(template);
                ctx.bind(var.as_deref(), rendered);
            }
            Step::Transform { op, input, var } => {
                let resolved = ctx.render(input);
                let result = apply_transform(op, &resolved)?;
                ctx.bind(var.as_deref(), result);
            }
            Step::WriteClipboard { value } => {
                let resolved = ctx.render(value);
                ports.clipboard.write(&resolved)?;
            }
            Step::OpenUrl { url } => {
                let resolved = ctx.render(url);
                ports.browser.open(&resolved)?;
            }
            Step::Notify { message } => {
                let resolved = ctx.render(message);
                ports.notifier.notify(&resolved)?;
            }
            Step::Llm {
                profile,
                model,
                prompt,
                system,
                var,
                max_tokens,
                temperature,
            } => {
                let llm = ports.llm.ok_or_else(|| {
                    SpikeError::ManifestError(
                        "LLM 未配置。打开设置添加 provider 后再试。".into(),
                    )
                })?;
                let user_text = ctx.render(prompt);
                let system_text = system.as_ref().map(|s| ctx.render(s));
                let req = ChatRequest {
                    model: model.clone().unwrap_or_default(),
                    system: system_text,
                    user: user_text,
                    max_tokens: *max_tokens,
                    temperature: *temperature,
                };
                let resp = llm.chat_with_profile(profile.as_deref(), &req)?;
                ctx.bind(var.as_deref(), resp.text);
            }
        }
    }

    Ok(ctx.last.unwrap_or_default())
}

fn apply_transform(op: &str, input: &str) -> Result<String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    Ok(match op {
        "uppercase" => input.to_uppercase(),
        "lowercase" => input.to_lowercase(),
        "trim" => input.trim().to_string(),
        "reverse" => input.chars().rev().collect(),
        "urlencode" => url_encode(input),
        "urldecode" => url_decode(input)?,
        "base64encode" => B64.encode(input.as_bytes()),
        "base64decode" => {
            let bytes = B64
                .decode(input.trim().as_bytes())
                .map_err(|e| SpikeError::ManifestError(format!("base64 decode: {}", e)))?;
            String::from_utf8(bytes)
                .map_err(|e| SpikeError::ManifestError(format!("base64 utf8: {}", e)))?
        }
        "jsonpretty" => {
            let parsed: serde_json::Value = serde_json::from_str(input.trim())
                .map_err(|e| SpikeError::ManifestError(format!("json parse: {}", e)))?;
            serde_json::to_string_pretty(&parsed)
                .map_err(|e| SpikeError::ManifestError(format!("json format: {}", e)))?
        }
        "jsonminify" => {
            let parsed: serde_json::Value = serde_json::from_str(input.trim())
                .map_err(|e| SpikeError::ManifestError(format!("json parse: {}", e)))?;
            serde_json::to_string(&parsed)
                .map_err(|e| SpikeError::ManifestError(format!("json minify: {}", e)))?
        }
        "wordcount" => format!(
            "字符 {} · 单词 {} · 行 {}",
            input.chars().count(),
            input.split_whitespace().count(),
            input.lines().count().max(1)
        ),
        "length" => input.chars().count().to_string(),
        unknown => {
            return Err(SpikeError::ManifestError(format!(
                "unknown transform op: {}",
                unknown
            )))
        }
    })
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn url_decode(s: &str) -> Result<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                .map_err(|e| SpikeError::ManifestError(format!("urldecode utf8: {}", e)))?;
            let byte = u8::from_str_radix(hex, 16)
                .map_err(|e| SpikeError::ManifestError(format!("urldecode hex: {}", e)))?;
            out.push(byte);
            i += 3;
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| SpikeError::ManifestError(format!("urldecode: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_renders_named_var() {
        let mut ctx = StepContext::new();
        ctx.bind(Some("name"), "world".into());
        assert_eq!(ctx.render("hello {{name}}"), "hello world");
    }

    #[test]
    fn template_renders_prev_alias() {
        let mut ctx = StepContext::new();
        ctx.bind(None, "previous".into());
        assert_eq!(ctx.render("got: {{$prev}}"), "got: previous");
    }

    #[test]
    fn url_encode_handles_spaces_and_symbols() {
        assert_eq!(url_encode("hello world"), "hello%20world");
        assert_eq!(url_encode("a&b=c"), "a%26b%3Dc");
    }

    #[test]
    fn url_decode_roundtrip() {
        let original = "hello world!@#";
        let encoded = url_encode(original);
        let decoded = url_decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn transform_wordcount_includes_chars_words_lines() {
        let result = apply_transform("wordcount", "hello\nworld foo").unwrap();
        assert!(result.contains("字符"));
        assert!(result.contains("单词"));
        assert!(result.contains("行"));
    }

    #[test]
    fn transform_unknown_op_errors() {
        let err = apply_transform("nope", "x").unwrap_err();
        assert!(err.to_string().contains("unknown transform op"));
    }

    #[test]
    fn transform_base64_roundtrip() {
        let original = "hello, 世界";
        let encoded = apply_transform("base64encode", original).unwrap();
        let decoded = apply_transform("base64decode", &encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn transform_jsonpretty_indents_compact_input() {
        let result = apply_transform("jsonpretty", r#"{"a":1,"b":[2,3]}"#).unwrap();
        assert!(result.contains('\n'));
        assert!(result.contains("  ")); // indent present
    }

    #[test]
    fn transform_jsonminify_strips_whitespace() {
        let result = apply_transform("jsonminify", "{\n  \"a\": 1\n}").unwrap();
        assert_eq!(result, r#"{"a":1}"#);
    }
}
