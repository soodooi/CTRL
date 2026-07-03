//! Docs as a §14 write target (ADR-002 §14.13 slice 4) — the BLOCK profile of
//! the unified produce verb. A doc is any vault markdown note; the write
//! vocabulary is the block half of `ProduceOp` (AppendSection /
//! ReplaceSection / DeleteSection), addressed by markdown ATX heading — the
//! AI-native way to say "rewrite the Overview section".
//!
//! Single-file model, same shape as `SmartTable`: the gate reads the note,
//! parses a `DocBody`, dispatches one op to its `RecordSink`, serializes back,
//! writes through the vault layer (frontmatter preserved verbatim). Record ops
//! (set_cell / add_field / …) return `Unsupported` — `supported_ops` works in
//! both directions (record sources reject block ops, the doc sink rejects
//! record ops).

use crate::kernel::query::{ProduceError, ProduceOp, RecordSink};

/// One markdown note body, split into lines for section surgery. The
/// frontmatter never enters here — the gate passes only the content and writes
/// the original frontmatter back verbatim (plain-text truth, zero fm churn).
pub struct DocBody {
    lines: Vec<String>,
    /// Whether the original content ended with a newline (round-trip fidelity).
    trailing_newline: bool,
}

impl DocBody {
    pub fn parse(content: &str) -> DocBody {
        DocBody {
            lines: content.lines().map(str::to_string).collect(),
            trailing_newline: content.ends_with('\n') || content.is_empty(),
        }
    }

    pub fn serialize(&self) -> String {
        let mut out = self.lines.join("\n");
        if self.trailing_newline && !out.is_empty() {
            out.push('\n');
        }
        out
    }

    /// Locate a section by ATX heading text: returns (heading line index,
    /// exclusive end index). The section runs from the heading line until the
    /// next heading of the SAME or HIGHER level (fewer or equal `#`s), or EOF.
    /// Matching is on the heading TEXT (after `#`s, trimmed, case-insensitive)
    /// so the AI can say "overview" for `## Overview`.
    fn find_section(&self, heading: &str) -> Option<(usize, usize)> {
        let needle = heading.trim().to_lowercase();
        let start = self
            .lines
            .iter()
            .position(|l| heading_text(l).is_some_and(|t| t.to_lowercase() == needle))?;
        let level = heading_level(&self.lines[start]).unwrap_or(6);
        let end = self.lines[start + 1..]
            .iter()
            .position(|l| heading_level(l).is_some_and(|lv| lv <= level))
            .map(|off| start + 1 + off)
            .unwrap_or(self.lines.len());
        Some((start, end))
    }

    /// Append content at the end of the named section (before the next
    /// heading), or at the end of the document when `heading` is None.
    fn append_section(&mut self, heading: Option<&str>, content: &str) -> Result<(), ProduceError> {
        let at = match heading {
            None => self.lines.len(),
            Some(h) => {
                let (_, end) = self.find_section(h).ok_or_else(|| section_not_found(h))?;
                end
            }
        };
        let mut insert: Vec<String> = Vec::new();
        // Blank-line separator when gluing onto existing non-blank content.
        if at > 0 && !self.lines[at - 1].trim().is_empty() {
            insert.push(String::new());
        }
        insert.extend(content.lines().map(str::to_string));
        self.lines.splice(at..at, insert);
        Ok(())
    }

    /// Replace the BODY under a heading, keeping the heading line itself.
    fn replace_section(&mut self, heading: &str, content: &str) -> Result<(), ProduceError> {
        let (start, end) = self.find_section(heading).ok_or_else(|| section_not_found(heading))?;
        let mut insert: Vec<String> = vec![String::new()];
        insert.extend(content.lines().map(str::to_string));
        self.lines.splice(start + 1..end, insert);
        Ok(())
    }

    /// Remove a heading AND its body.
    fn delete_section(&mut self, heading: &str) -> Result<(), ProduceError> {
        let (start, end) = self.find_section(heading).ok_or_else(|| section_not_found(heading))?;
        self.lines.drain(start..end);
        // Collapse a doubled blank line left at the seam.
        if start > 0
            && start < self.lines.len()
            && self.lines[start - 1].trim().is_empty()
            && self.lines[start].trim().is_empty()
        {
            self.lines.remove(start);
        }
        Ok(())
    }
}

impl RecordSink for DocBody {
    fn supported_ops(&self) -> Vec<&'static str> {
        vec!["append_section", "replace_section", "delete_section"]
    }

    fn produce(&mut self, op: ProduceOp) -> Result<(), ProduceError> {
        match op {
            ProduceOp::AppendSection { heading, content } => {
                self.append_section(heading.as_deref(), &content)
            }
            ProduceOp::ReplaceSection { heading, content } => {
                self.replace_section(&heading, &content)
            }
            ProduceOp::DeleteSection { heading } => self.delete_section(&heading),
            other => Err(ProduceError::Unsupported {
                op: other.kind().to_string(),
                supported: self.supported_ops().iter().map(|s| s.to_string()).collect(),
            }),
        }
    }
}

fn section_not_found(heading: &str) -> ProduceError {
    ProduceError::Conflict { message: format!("heading '{heading}' not found") }
}

/// The text of an ATX heading line (`## Title` → `Title`), or None if the line
/// is not a heading. Trailing closing `#`s are stripped (`## Title ##`).
fn heading_text(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|&c| c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &trimmed[hashes..];
    if !rest.is_empty() && !rest.starts_with(' ') {
        return None; // `#hashtag`, not a heading
    }
    Some(rest.trim().trim_end_matches('#').trim())
}

/// The level of an ATX heading line (1-6), or None.
fn heading_level(line: &str) -> Option<usize> {
    heading_text(line)?;
    Some(line.trim_start().chars().take_while(|&c| c == '#').count())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "# Spec\n\nintro text\n\n## Overview\n\nold overview body\nmore old\n\n## Details\n\ndetail body\n\n### Sub\n\nsub body\n";

    #[test]
    fn find_section_scopes_to_same_or_higher_heading() {
        let d = DocBody::parse(DOC);
        // `## Details` runs to EOF because `### Sub` is LOWER level (nested).
        let (start, end) = d.find_section("Details").unwrap();
        assert!(d.lines[start].contains("## Details"));
        assert_eq!(end, d.lines.len());
        // `## Overview` stops at `## Details` (same level).
        let (start, end) = d.find_section("overview").unwrap(); // case-insensitive
        assert!(d.lines[start].contains("## Overview"));
        assert!(d.lines[end].contains("## Details"));
        // `# Spec` runs to EOF (nothing at level 1 after it).
        let (_, end) = d.find_section("Spec").unwrap();
        assert_eq!(end, d.lines.len());
        assert!(d.find_section("Nope").is_none());
    }

    #[test]
    fn heading_text_rejects_hashtags_and_over_deep() {
        assert_eq!(heading_text("## Title"), Some("Title"));
        assert_eq!(heading_text("## Title ##"), Some("Title"));
        assert_eq!(heading_text("#hashtag"), None);
        assert_eq!(heading_text("####### seven"), None);
        assert_eq!(heading_text("plain"), None);
        assert_eq!(heading_text("#"), Some(""));
    }

    #[test]
    fn append_at_end_of_document() {
        let mut d = DocBody::parse(DOC);
        d.produce(ProduceOp::AppendSection { heading: None, content: "## New\n\nnew body".into() })
            .unwrap();
        let out = d.serialize();
        assert!(out.ends_with("## New\n\nnew body\n"));
        assert!(out.starts_with("# Spec\n")); // rest untouched
    }

    #[test]
    fn append_under_named_section_lands_before_next_heading() {
        let mut d = DocBody::parse(DOC);
        d.produce(ProduceOp::AppendSection {
            heading: Some("Overview".into()),
            content: "appended line".into(),
        })
        .unwrap();
        let out = d.serialize();
        let ov = out.find("appended line").unwrap();
        let det = out.find("## Details").unwrap();
        assert!(ov < det, "appended inside Overview, before Details");
        assert!(out.contains("more old\n\nappended line"), "blank-line separated");
    }

    #[test]
    fn replace_section_keeps_heading_replaces_body() {
        let mut d = DocBody::parse(DOC);
        d.produce(ProduceOp::ReplaceSection {
            heading: "Overview".into(),
            content: "fresh body".into(),
        })
        .unwrap();
        let out = d.serialize();
        assert!(out.contains("## Overview\n\nfresh body\n## Details"));
        assert!(!out.contains("old overview body"));
        assert!(out.contains("detail body")); // sibling untouched
    }

    #[test]
    fn delete_section_removes_heading_and_nested_body() {
        let mut d = DocBody::parse(DOC);
        d.produce(ProduceOp::DeleteSection { heading: "Details".into() }).unwrap();
        let out = d.serialize();
        assert!(!out.contains("## Details"));
        assert!(!out.contains("detail body"));
        assert!(!out.contains("### Sub"), "nested subsection goes with its parent");
        assert!(out.contains("## Overview")); // sibling untouched
        assert!(out.contains("old overview body"));
    }

    #[test]
    fn missing_heading_is_a_conflict() {
        let mut d = DocBody::parse(DOC);
        assert!(matches!(
            d.produce(ProduceOp::ReplaceSection { heading: "Nope".into(), content: "x".into() }),
            Err(ProduceError::Conflict { .. })
        ));
        assert!(matches!(
            d.produce(ProduceOp::DeleteSection { heading: "Nope".into() }),
            Err(ProduceError::Conflict { .. })
        ));
        assert!(matches!(
            d.produce(ProduceOp::AppendSection { heading: Some("Nope".into()), content: "x".into() }),
            Err(ProduceError::Conflict { .. })
        ));
    }

    #[test]
    fn record_ops_are_unsupported_on_a_doc() {
        let mut d = DocBody::parse(DOC);
        let err = d
            .produce(ProduceOp::SetCell { row: 0, field: "x".into(), value: "y".into() })
            .unwrap_err();
        match err {
            ProduceError::Unsupported { op, supported } => {
                assert_eq!(op, "set_cell");
                assert!(supported.contains(&"replace_section".to_string()));
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    #[test]
    fn serialize_round_trips_verbatim() {
        assert_eq!(DocBody::parse(DOC).serialize(), DOC);
        assert_eq!(DocBody::parse("no trailing newline").serialize(), "no trailing newline");
        assert_eq!(DocBody::parse("").serialize(), "");
    }

    #[test]
    fn append_to_empty_doc() {
        let mut d = DocBody::parse("");
        d.produce(ProduceOp::AppendSection { heading: None, content: "# First".into() }).unwrap();
        assert_eq!(d.serialize(), "# First\n");
    }
}
