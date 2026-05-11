// Tool / Action / Step domain types — match the JSON schema in share/modules/SCHEMA.md.
//
// `permissions: Vec<String>` is the v0 manifest field (coarse-grained labels:
// "clipboard" / "network"). Use `typed_capabilities()` to get the type-safe
// `Vec<CapToken>` for kernel enforcement. v1 manifest schema (post-P2.5) will
// move to `capabilities` field directly per .olym/specs/tool-manifest/spec.md.

use crate::kernel::capability::CapToken;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Author,
    pub description: Description,
    #[serde(default)]
    pub icon: Option<String>,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub actions: Vec<Action>,
    /// Two-character vim-style chord that triggers this tool's first action.
    /// Convention: lowercase letters, e.g. "as" → 总结(AI Summarize).
    /// Optional: chord-less tools are still reachable via 1-9 hotkey or click.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chord: Option<String>,
}

impl Tool {
    /// Translate v0 string-based permissions to type-safe kernel CapTokens.
    /// Used by kernel-side actor spawning to enforce capability gate.
    ///
    /// Coarse-grained legacy labels are expanded to the most permissive
    /// fine-grained set so old manifests keep working:
    ///   "clipboard"      → [ClipboardRead, ClipboardWrite]
    ///   "network"        → [HttpGet { "*" }, HttpPost { "*" }]
    ///   "llm"            → inferred per action.steps (LlmCall with model)
    ///   "filesystem-read"  → [FsRead { "*" }]
    ///   "filesystem-write" → [FsWrite { "*" }]
    ///   "shell"          → ignored for v0 (use scripts in steps explicitly)
    ///
    /// Unknown labels are silently dropped — manifest authors should migrate
    /// to v1 `capabilities` field for fine-grained control.
    pub fn typed_capabilities(&self) -> Vec<CapToken> {
        let mut out: Vec<CapToken> = Vec::new();
        for perm in &self.permissions {
            match perm.as_str() {
                "clipboard" => {
                    out.push(CapToken::ClipboardRead);
                    out.push(CapToken::ClipboardWrite);
                }
                "clipboard-read" => out.push(CapToken::ClipboardRead),
                "clipboard-write" => out.push(CapToken::ClipboardWrite),
                "network" => {
                    out.push(CapToken::HttpGet {
                        url_glob: "*".into(),
                    });
                    out.push(CapToken::HttpPost {
                        url_glob: "*".into(),
                    });
                }
                "filesystem-read" => out.push(CapToken::FsRead {
                    path_glob: "*".into(),
                }),
                "filesystem-write" => out.push(CapToken::FsWrite {
                    path_glob: "*".into(),
                }),
                other => {
                    tracing::warn!(
                        permission = other,
                        tool = %self.id,
                        "unknown permission string, migrate to typed capabilities"
                    );
                }
            }
        }

        // Walk steps to infer LlmCall capability automatically.
        for action in &self.actions {
            for step in &action.steps {
                if let Step::Llm { model, .. } = step {
                    let model_name = model.clone().unwrap_or_else(|| "*".into());
                    out.push(CapToken::LlmCall {
                        model: model_name,
                        max_tokens: None,
                    });
                }
            }
        }

        out
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Author {
    pub name: String,
    #[serde(default)]
    pub github: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Description {
    pub short: String,
    #[serde(default)]
    pub long: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub input: String,
    pub output: String,
    #[serde(default = "default_scenes")]
    pub scenes: Vec<String>,
    pub steps: Vec<Step>,
}

fn default_scenes() -> Vec<String> {
    vec!["any-app".into()]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Step {
    CaptureSelection {
        #[serde(default, rename = "as")]
        var: Option<String>,
    },
    CaptureClipboard {
        #[serde(default, rename = "as")]
        var: Option<String>,
    },
    Template {
        template: String,
        #[serde(default, rename = "as")]
        var: Option<String>,
    },
    Transform {
        op: String,
        input: String,
        #[serde(default, rename = "as")]
        var: Option<String>,
    },
    WriteClipboard {
        value: String,
    },
    OpenUrl {
        url: String,
    },
    Notify {
        message: String,
    },
    Llm {
        #[serde(default)]
        profile: Option<String>,
        #[serde(default)]
        model: Option<String>,
        prompt: String,
        #[serde(default)]
        system: Option<String>,
        #[serde(default, rename = "as")]
        var: Option<String>,
        #[serde(default)]
        max_tokens: Option<u32>,
        #[serde(default)]
        temperature: Option<f32>,
    },
}

impl Step {
    /// The kernel capability token required to execute this step. Used by
    /// step_runner / actor handler to verify the parent Capability bundle
    /// holds the required permission before execution.
    ///
    /// Pure-computation steps (Template / Transform) require no capability —
    /// returns None. Steps with multiple permission needs (e.g., LLM needs
    /// network + model auth) return the most-restrictive token; secondary
    /// checks happen at the adapter boundary.
    pub fn required_capability(&self) -> Option<CapToken> {
        match self {
            Step::CaptureSelection { .. } => Some(CapToken::ClipboardRead),
            Step::CaptureClipboard { .. } => Some(CapToken::ClipboardRead),
            Step::Template { .. } => None,
            Step::Transform { .. } => None,
            Step::WriteClipboard { .. } => Some(CapToken::ClipboardWrite),
            Step::OpenUrl { url } => Some(CapToken::HttpGet {
                url_glob: url.clone(),
            }),
            Step::Notify { .. } => None,
            Step::Llm { model, .. } => Some(CapToken::LlmCall {
                model: model.clone().unwrap_or_else(|| "*".into()),
                max_tokens: None,
            }),
        }
    }

    /// Human-readable kind tag for logging / tracing.
    pub fn kind_str(&self) -> &'static str {
        match self {
            Step::CaptureSelection { .. } => "capture-selection",
            Step::CaptureClipboard { .. } => "capture-clipboard",
            Step::Template { .. } => "template",
            Step::Transform { .. } => "transform",
            Step::WriteClipboard { .. } => "write-clipboard",
            Step::OpenUrl { .. } => "open-url",
            Step::Notify { .. } => "notify",
            Step::Llm { .. } => "llm",
        }
    }
}
