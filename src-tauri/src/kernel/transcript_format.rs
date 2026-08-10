//! Plain-text transcript format.
//!
//! A conversation is user content, and until now it lived only in the frontend's
//! browser storage — so the one thing a user most needs to keep was the one thing
//! ordinary tools could not read. That fails CTRL's plain-text invariant outright.
//!
//! The on-disk form is therefore ordinary Markdown with YAML frontmatter: a
//! `## user` / `## assistant` heading per turn and the body beneath it. It greps,
//! it diffs, it opens in any editor, and a partially hand-edited file still
//! parses. (ADR-005 irisy §11.2 v44)

use serde::{Deserialize, Serialize};

/// One turn. `role` is kept as the wire string rather than an enum so a
/// transcript written by a newer build does not become unreadable here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transcript {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub last_active_at: String,
    /// Canonical ResourceRefs this session owns.
    #[serde(default)]
    pub resources: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_fct: Option<String>,
    #[serde(default)]
    pub messages: Vec<TranscriptMessage>,
}

const ROLES: [&str; 3] = ["user", "assistant", "custom"];

fn yaml_escape(value: &str) -> String {
    // Quote whenever the value could be misread as YAML structure. A transcript
    // label is user text, so this is the common case, not the exotic one.
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn yaml_unescape(value: &str) -> String {
    let trimmed = value.trim();
    let inner = trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(trimmed);
    inner.replace("\\\"", "\"").replace("\\\\", "\\")
}

impl Transcript {
    /// Render to the on-disk form.
    pub fn render(&self) -> String {
        let mut out = String::from("---\n");
        out.push_str(&format!("id: {}\n", yaml_escape(&self.id)));
        out.push_str(&format!("label: {}\n", yaml_escape(&self.label)));
        out.push_str(&format!("created_at: {}\n", yaml_escape(&self.created_at)));
        out.push_str(&format!(
            "last_active_at: {}\n",
            yaml_escape(&self.last_active_at)
        ));
        if let Some(fct) = &self.selected_fct {
            out.push_str(&format!("selected_fct: {}\n", yaml_escape(fct)));
        }
        if self.resources.is_empty() {
            out.push_str("resources: []\n");
        } else {
            out.push_str("resources:\n");
            for resource in &self.resources {
                out.push_str(&format!("  - {}\n", yaml_escape(resource)));
            }
        }
        out.push_str("---\n");
        for message in &self.messages {
            // A blank line before each heading so the file reads as prose and
            // round-trips through any Markdown tool.
            out.push_str(&format!("\n## {}\n\n", message.role));
            out.push_str(message.content.trim_end());
            out.push('\n');
        }
        out
    }

    /// Parse the on-disk form. Missing frontmatter, unknown keys, and a truncated
    /// tail are all tolerated: a hand-edited transcript must still open, because
    /// refusing to read it would lose the user's history over a typo.
    /// (ADR-005 irisy §11.2 v44)
    pub fn parse(text: &str) -> Self {
        let mut transcript = Self::default();
        let body = match text.strip_prefix("---\n") {
            Some(rest) => match rest.split_once("\n---\n") {
                Some((frontmatter, body)) => {
                    transcript.absorb_frontmatter(frontmatter);
                    body
                }
                // Frontmatter opened and never closed: keep what we can read and
                // treat nothing as body rather than silently showing YAML as chat.
                None => {
                    transcript.absorb_frontmatter(rest);
                    ""
                }
            },
            None => text,
        };
        transcript.messages = parse_messages(body);
        transcript
    }

    fn absorb_frontmatter(&mut self, frontmatter: &str) {
        let mut in_resources = false;
        for line in frontmatter.lines() {
            if in_resources {
                if let Some(item) = line.trim().strip_prefix("- ") {
                    self.resources.push(yaml_unescape(item));
                    continue;
                }
                if line.starts_with(' ') || line.trim().is_empty() {
                    continue;
                }
                in_resources = false;
            }
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let value = value.trim();
            match key.trim() {
                "id" => self.id = yaml_unescape(value),
                "label" => self.label = yaml_unescape(value),
                "created_at" => self.created_at = yaml_unescape(value),
                "last_active_at" => self.last_active_at = yaml_unescape(value),
                "selected_fct" => {
                    let parsed = yaml_unescape(value);
                    // An empty value means Auto, which is absence, not a selection.
                    self.selected_fct = (!parsed.is_empty()).then_some(parsed);
                }
                "resources" => {
                    if value.is_empty() {
                        in_resources = true;
                    }
                }
                _ => {}
            }
        }
    }
}

fn parse_messages(body: &str) -> Vec<TranscriptMessage> {
    let mut messages: Vec<TranscriptMessage> = Vec::new();
    let mut role: Option<String> = None;
    let mut buffer: Vec<&str> = Vec::new();
    let flush = |role: &mut Option<String>, buffer: &mut Vec<&str>, out: &mut Vec<TranscriptMessage>| {
        if let Some(current) = role.take() {
            out.push(TranscriptMessage {
                role: current,
                content: buffer.join("\n").trim().to_owned(),
            });
        }
        buffer.clear();
    };
    for line in body.lines() {
        if let Some(heading) = line.strip_prefix("## ") {
            let candidate = heading.trim();
            // Only a known role starts a turn; an ordinary `## Heading` inside a
            // reply stays part of that reply instead of splitting it.
            if ROLES.contains(&candidate) {
                flush(&mut role, &mut buffer, &mut messages);
                role = Some(candidate.to_owned());
                continue;
            }
        }
        if role.is_some() {
            buffer.push(line);
        }
    }
    flush(&mut role, &mut buffer, &mut messages);
    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(role: &str, content: &str) -> TranscriptMessage {
        TranscriptMessage {
            role: role.to_owned(),
            content: content.to_owned(),
        }
    }

    fn sample() -> Transcript {
        Transcript {
            id: "session-a".to_owned(),
            label: "Budget work".to_owned(),
            created_at: "2026-08-05T10:00:00Z".to_owned(),
            last_active_at: "2026-08-05T10:05:00Z".to_owned(),
            resources: vec!["ctrl://local/note/Budget.md".to_owned()],
            selected_fct: Some("pack:office".to_owned()),
            messages: vec![
                message("user", "Summarize the budget"),
                message("assistant", "Revenue is up nine percent."),
            ],
        }
    }

    /// The whole point of the format: a person can read it.
    /// (ADR-005 irisy §11.2 v44)
    #[test]
    fn the_rendered_file_reads_as_ordinary_markdown() {
        let text = sample().render();
        assert!(text.starts_with("---\n"));
        assert!(text.contains("label: \"Budget work\""));
        assert!(text.contains("\n## user\n\nSummarize the budget\n"));
        assert!(text.contains("\n## assistant\n\nRevenue is up nine percent.\n"));
    }

    #[test]
    fn a_transcript_round_trips_without_loss() {
        let original = sample();
        assert_eq!(Transcript::parse(&original.render()), original);
    }

    #[test]
    fn an_empty_transcript_round_trips() {
        let empty = Transcript {
            id: "s".to_owned(),
            label: "New".to_owned(),
            ..Transcript::default()
        };
        let parsed = Transcript::parse(&empty.render());
        assert_eq!(parsed.messages.len(), 0);
        assert_eq!(parsed.resources.len(), 0);
        assert_eq!(parsed.selected_fct, None);
    }

    /// Auto is the absence of a selection, not an empty selection.
    #[test]
    fn an_absent_fct_stays_absent_rather_than_becoming_an_empty_selection() {
        let text = "---\nid: \"s\"\nlabel: \"L\"\nselected_fct: \"\"\nresources: []\n---\n";
        assert_eq!(Transcript::parse(text).selected_fct, None);
    }

    /// A reply containing its own Markdown headings must not be split into turns.
    #[test]
    fn a_heading_inside_a_reply_does_not_start_a_new_turn() {
        let original = Transcript {
            id: "s".to_owned(),
            label: "L".to_owned(),
            messages: vec![message(
                "assistant",
                "## Overview\n\nRevenue rose.\n\n## Detail\n\nBy nine percent.",
            )],
            ..Transcript::default()
        };
        let parsed = Transcript::parse(&original.render());
        assert_eq!(parsed.messages.len(), 1, "one turn, not three");
        assert!(parsed.messages[0].content.contains("## Overview"));
        assert!(parsed.messages[0].content.contains("## Detail"));
    }

    #[test]
    fn a_label_with_quotes_and_backslashes_survives() {
        let original = Transcript {
            id: "s".to_owned(),
            label: r#"He said "hi" \ then left"#.to_owned(),
            ..Transcript::default()
        };
        assert_eq!(Transcript::parse(&original.render()).label, original.label);
    }

    /// A hand-edited file must still open. Losing history to a typo would be the
    /// worst possible failure for this format. (ADR-005 irisy §11.2 v44)
    #[test]
    fn a_hand_edited_file_without_frontmatter_still_yields_its_turns() {
        let text = "## user\n\nwhat did I decide?\n\n## assistant\n\nyou decided to wait.\n";
        let parsed = Transcript::parse(text);
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[1].content, "you decided to wait.");
        // Metadata is absent rather than invented.
        assert_eq!(parsed.id, "");
    }

    #[test]
    fn unclosed_frontmatter_keeps_the_metadata_and_shows_no_yaml_as_chat() {
        let text = "---\nid: \"s\"\nlabel: \"L\"\n";
        let parsed = Transcript::parse(text);
        assert_eq!(parsed.id, "s");
        assert_eq!(parsed.label, "L");
        assert!(parsed.messages.is_empty());
    }

    #[test]
    fn an_unknown_frontmatter_key_is_ignored_not_fatal() {
        let text = "---\nid: \"s\"\nlabel: \"L\"\nfuture_key: \"x\"\nresources: []\n---\n\n## user\n\nhi\n";
        let parsed = Transcript::parse(text);
        assert_eq!(parsed.id, "s");
        assert_eq!(parsed.messages.len(), 1);
    }

    #[test]
    fn a_role_from_a_newer_build_is_preserved_rather_than_dropped() {
        // `custom` is a known display role; an unknown one is not a turn heading,
        // so it stays inside the preceding turn instead of vanishing silently.
        let original = Transcript {
            id: "s".to_owned(),
            label: "L".to_owned(),
            messages: vec![message("custom", "{\"kind\":\"table\"}")],
            ..Transcript::default()
        };
        let parsed = Transcript::parse(&original.render());
        assert_eq!(parsed.messages, original.messages);
    }

    #[test]
    fn several_resources_round_trip_in_order() {
        let original = Transcript {
            id: "s".to_owned(),
            label: "L".to_owned(),
            resources: vec![
                "ctrl://local/note/A.md".to_owned(),
                "ctrl://local/project/demo".to_owned(),
            ],
            ..Transcript::default()
        };
        assert_eq!(
            Transcript::parse(&original.render()).resources,
            original.resources
        );
    }

    #[test]
    fn trailing_whitespace_in_a_turn_is_normalized_not_accumulated() {
        let original = Transcript {
            id: "s".to_owned(),
            label: "L".to_owned(),
            messages: vec![message("user", "hi   \n\n\n")],
            ..Transcript::default()
        };
        let once = original.render();
        let twice = Transcript::parse(&once).render();
        // Rendering is idempotent, so repeated saves do not grow the file.
        assert_eq!(once, twice);
    }
}
