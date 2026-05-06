// Tool / Action / Step domain types — match the JSON schema in share/modules/SCHEMA.md.

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
