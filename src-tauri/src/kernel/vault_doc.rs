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

    /// Line indices that are real ATX headings — i.e. NOT inside a fenced code
    /// block (``` / ~~~). A `# comment` line inside a fence must never count as
    /// a section boundary (would corrupt replace/delete on any doc with code).
    fn heading_lines(&self) -> Vec<usize> {
        let mut out = Vec::new();
        let mut fence: Option<char> = None;
        for (i, l) in self.lines.iter().enumerate() {
            let t = l.trim_start();
            let opener = if t.starts_with("```") {
                Some('`')
            } else if t.starts_with("~~~") {
                Some('~')
            } else {
                None
            };
            match (fence, opener) {
                (None, Some(c)) => fence = Some(c),
                (Some(c), Some(o)) if c == o => fence = None,
                _ => {}
            }
            if fence.is_none() && opener.is_none() && heading_text(l).is_some() {
                out.push(i);
            }
        }
        out
    }

    /// Locate a section by ATX heading text: returns (heading line index,
    /// exclusive end index). The section runs from the heading line until the
    /// next heading of the SAME or HIGHER level (fewer or equal `#`s), or EOF.
    /// Matching is on the heading TEXT (after `#`s, trimmed, case-insensitive)
    /// so the AI can say "overview" for `## Overview`. The FIRST matching
    /// heading wins (duplicate headings: address the first). Heading lines
    /// inside fenced code blocks are ignored (see `heading_lines`).
    fn find_section(&self, heading: &str) -> Option<(usize, usize)> {
        let needle = heading.trim().to_lowercase();
        let headings = self.heading_lines();
        let start = *headings
            .iter()
            .find(|&&i| heading_text(&self.lines[i]).is_some_and(|t| t.to_lowercase() == needle))?;
        let level = heading_level(&self.lines[start]).unwrap_or(6);
        let end = headings
            .iter()
            .filter(|&&i| i > start)
            .find(|&&i| heading_level(&self.lines[i]).is_some_and(|lv| lv <= level))
            .copied()
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
        // House style: keep a blank line before an abutting next heading.
        if at < self.lines.len() && !self.lines[at].trim().is_empty() {
            insert.push(String::new());
        }
        self.lines.splice(at..at, insert);
        Ok(())
    }

    /// Replace the BODY under a heading, keeping the heading line itself.
    fn replace_section(&mut self, heading: &str, content: &str) -> Result<(), ProduceError> {
        let (start, end) = self.find_section(heading).ok_or_else(|| section_not_found(heading))?;
        let mut insert: Vec<String> = vec![String::new()];
        insert.extend(content.lines().map(str::to_string));
        // House style: keep a blank line before an abutting next heading.
        if end < self.lines.len() {
            insert.push(String::new());
        }
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

/// One heading in a document map (ADR-002 §1.9 v46 E9 — `note_map`).
#[derive(Debug, serde::Serialize)]
pub struct MapHeading {
    pub level: usize,
    pub text: String,
    /// 0-based body line index.
    pub line: usize,
}

/// One `^block-id` reference in a document map.
#[derive(Debug, serde::Serialize)]
pub struct MapBlockRef {
    pub id: String,
    pub line: usize,
}

impl DocBody {
    /// The document map's heading list (fence-aware — code-block `#` lines are
    /// never headings). Feeds `note_map` so the AI targets `doc_produce`
    /// headings it can SEE instead of guessing.
    pub fn map_headings(&self) -> Vec<MapHeading> {
        self.heading_lines()
            .into_iter()
            .map(|i| MapHeading {
                level: heading_level(&self.lines[i]).unwrap_or(6),
                text: heading_text(&self.lines[i]).unwrap_or("").to_string(),
                line: i,
            })
            .collect()
    }

    /// Obsidian-convention `^block-id` markers (line-trailing), for block-level
    /// addressing (E5 future) + the document map.
    pub fn map_block_refs(&self) -> Vec<MapBlockRef> {
        self.lines
            .iter()
            .enumerate()
            .filter_map(|(i, l)| {
                let id = l.rsplit_once(" ^").map(|(_, id)| id)?;
                let ok = !id.is_empty()
                    && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
                ok.then(|| MapBlockRef { id: id.to_string(), line: i })
            })
            .collect()
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
/// CommonMark caps ATX indentation at 3 spaces — 4+ is indented code, not a
/// heading (`    # comment` must never be a section boundary).
fn heading_text(line: &str) -> Option<&str> {
    let indent = line.len() - line.trim_start().len();
    if indent > 3 || line[..indent].contains('\t') {
        return None;
    }
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
        assert!(out.contains("## Overview\n\nfresh body\n\n## Details"), "blank line kept before the next heading");
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
    fn fenced_code_hash_lines_are_not_section_boundaries() {
        // A doc whose code block contains `# not a heading` — the section must
        // run PAST the fence, and the fake heading must not be addressable.
        let doc = "## Setup\n\n```bash\n# install deps\nnpm install\n```\n\nafter code\n\n## Next\n\nnext body\n";
        let d = DocBody::parse(doc);
        let (start, end) = d.find_section("Setup").unwrap();
        assert!(d.lines[start].contains("## Setup"));
        assert!(d.lines[end].contains("## Next"), "section spans the whole fence");
        assert!(d.find_section("install deps").is_none(), "fence content not addressable");

        // replace_section keeps everything outside the Setup body intact.
        let mut d = DocBody::parse(doc);
        d.produce(ProduceOp::ReplaceSection { heading: "Setup".into(), content: "new setup".into() })
            .unwrap();
        let out = d.serialize();
        assert!(!out.contains("npm install"), "old body incl. fence replaced");
        assert!(out.contains("## Next\n\nnext body"), "sibling untouched");

        // ~~~ fences behave the same.
        let d2 = DocBody::parse("## A\n\n~~~\n# fake\n~~~\n\n## B\n\nb\n");
        let (_, end2) = d2.find_section("A").unwrap();
        assert!(d2.lines[end2].contains("## B"));
    }

    #[test]
    fn indented_code_lines_are_not_headings() {
        // CommonMark: 4+ spaces = indented code, never a heading.
        assert_eq!(heading_text("    # not a heading"), None);
        assert_eq!(heading_text("   ### still a heading"), Some("still a heading"));
        assert_eq!(heading_text("\t# tab-indented code"), None);
        let d = DocBody::parse("## A\n\n    # indented code\n\n## B\n\nb\n");
        let (_, end) = d.find_section("A").unwrap();
        assert!(d.lines[end].contains("## B"), "indented code is not a boundary");
    }

    #[test]
    fn unclosed_fence_swallows_the_rest_of_the_doc() {
        // An unclosed ``` means everything after it is (conservatively) code:
        // no heading below it is addressable, so no splice can tear the fence.
        let d = DocBody::parse("## A\n\n```\n# fake\n## Also Fake\n\nnever closed\n");
        let (_, end) = d.find_section("A").unwrap();
        assert_eq!(end, d.lines.len());
        assert!(d.find_section("Also Fake").is_none());
    }

    #[test]
    fn map_headings_and_block_refs_are_fence_aware() {
        let doc = "# Top\n\ntext ^intro-1\n\n```\n# fake heading\nx ^fake-ref\n```\n\n## Sub\n\nend ^tail_2\n";
        let d = DocBody::parse(doc);
        let hs = d.map_headings();
        assert_eq!(hs.len(), 2, "fence heading excluded");
        assert_eq!((hs[0].level, hs[0].text.as_str(), hs[0].line), (1, "Top", 0));
        assert_eq!((hs[1].level, hs[1].text.as_str()), (2, "Sub"));
        let refs = d.map_block_refs();
        let ids: Vec<&str> = refs.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"intro-1"));
        assert!(ids.contains(&"tail_2"));
        // Fence content ref IS collected (block refs are textual markers; the
        // conservative choice is to list them — addressing validates later).
        // No false positives from arbitrary carets:
        let none = DocBody::parse("math a^2 + b^2\n");
        assert!(none.map_block_refs().is_empty());
    }

    #[test]
    fn append_to_empty_doc() {
        let mut d = DocBody::parse("");
        d.produce(ProduceOp::AppendSection { heading: None, content: "# First".into() }).unwrap();
        assert_eq!(d.serialize(), "# First\n");
    }
}
