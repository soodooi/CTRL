//! Workshop canvas operations — composite commands over draft CRUD.
//!
//! Where `draft.rs` is raw load/save/delete, `workshop.rs` is the
//! canvas-shaped surface that handles read-modify-write in one call.
//! daedalus's PWA `/forge` route maps user actions (drop step, drag to
//! reorder, click delete) onto these commands directly — no client-side
//! manifest mutation that could race with simultaneous edits from
//! Irisy (the LLM tool-call path) or, later, external MCP agents.
//!
//! Per the 2026-05-23 cross-lane decision: canvas state IS the manifest
//! `actions[0].steps[]` array (no intermediate graph IR). v1 supports
//! linear flow only — branching deferred.
//!
//! Naming mirrors the eventual `workshop.*` MCP tool surface (D5 plan):
//! these Tauri commands and the future MCP tools share names + payload
//! shapes so a kernel-side rmcp adapter can later route MCP calls into
//! the same functions without re-engineering the contract.

use serde::{Deserialize, Serialize};

use crate::commands::draft;

#[derive(Debug, Deserialize)]
pub struct WorkshopAddStepArgs {
    pub draft_id: String,
    /// The step JSON to insert. Caller is responsible for the step's
    /// shape matching the McpManifest Step union (drafts can be
    /// incomplete, so we don't validate here — install_mcp will).
    pub step: serde_json::Value,
    /// 0-based index after which to insert. `None` = append. Negative
    /// or out-of-range = clamped to a valid position.
    pub after_index: Option<i64>,
    /// Optional action id when the manifest has more than one action.
    /// Defaults to the first action.
    pub action_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WorkshopMutationReply {
    pub draft_id: String,
    pub step_count: usize,
    pub final_index: usize,
}

#[tauri::command]
pub async fn workshop_add_step(
    args: WorkshopAddStepArgs,
) -> Result<WorkshopMutationReply, String> {
    mutate_draft(&args.draft_id, args.action_id.as_deref(), |steps| {
        let pos = clamp_insert_pos(args.after_index, steps.len());
        steps.insert(pos, args.step.clone());
        Ok(pos)
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct WorkshopUpdateStepArgs {
    pub draft_id: String,
    pub index: usize,
    /// JSON object whose fields are merged into the step at `index`.
    /// Replacement semantics on each top-level key — to clear a field,
    /// pass `null`.
    pub patch: serde_json::Value,
    pub action_id: Option<String>,
}

#[tauri::command]
pub async fn workshop_update_step(
    args: WorkshopUpdateStepArgs,
) -> Result<WorkshopMutationReply, String> {
    mutate_draft(&args.draft_id, args.action_id.as_deref(), |steps| {
        if args.index >= steps.len() {
            return Err(format!(
                "index {} out of range (steps.len()={})",
                args.index,
                steps.len()
            ));
        }
        let patch = args.patch.clone();
        let target = &mut steps[args.index];
        merge_step_patch(target, &patch);
        Ok(args.index)
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct WorkshopRemoveStepArgs {
    pub draft_id: String,
    pub index: usize,
    pub action_id: Option<String>,
}

#[tauri::command]
pub async fn workshop_remove_step(
    args: WorkshopRemoveStepArgs,
) -> Result<WorkshopMutationReply, String> {
    mutate_draft(&args.draft_id, args.action_id.as_deref(), |steps| {
        if args.index >= steps.len() {
            return Err(format!(
                "index {} out of range (steps.len()={})",
                args.index,
                steps.len()
            ));
        }
        steps.remove(args.index);
        Ok(args.index.min(steps.len().saturating_sub(1)))
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct WorkshopMoveStepArgs {
    pub draft_id: String,
    pub from_index: usize,
    pub to_index: usize,
    pub action_id: Option<String>,
}

#[tauri::command]
pub async fn workshop_move_step(
    args: WorkshopMoveStepArgs,
) -> Result<WorkshopMutationReply, String> {
    mutate_draft(&args.draft_id, args.action_id.as_deref(), |steps| {
        if args.from_index >= steps.len() {
            return Err(format!(
                "from_index {} out of range (steps.len()={})",
                args.from_index,
                steps.len()
            ));
        }
        let step = steps.remove(args.from_index);
        let to = args.to_index.min(steps.len());
        steps.insert(to, step);
        Ok(to)
    })
    .await
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Load draft → find target action's steps → apply mutator → save.
/// Centralizes the round-trip so all canvas operations behave the same
/// way w.r.t. atomicity + error handling.
async fn mutate_draft(
    draft_id: &str,
    action_id: Option<&str>,
    mutator: impl FnOnce(&mut Vec<serde_json::Value>) -> Result<usize, String>,
) -> Result<WorkshopMutationReply, String> {
    // Read current draft.
    let read = draft::draft_read(draft::DraftReadArgs {
        draft_id: draft_id.to_string(),
    })
    .await?;
    let mut manifest = read.manifest;

    // Find the target action.
    let actions = manifest
        .get_mut("actions")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "manifest.actions[] missing or not an array".to_string())?;
    if actions.is_empty() {
        return Err("manifest.actions[] is empty — add an action first".into());
    }
    let action_index = match action_id {
        Some(id) => actions
            .iter()
            .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(id))
            .ok_or_else(|| format!("action_id {id:?} not found"))?,
        None => 0,
    };

    // Mutate steps[] in place.
    let steps = actions[action_index]
        .get_mut("steps")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "action.steps[] missing or not an array".to_string())?;
    let final_index = mutator(steps)?;
    let step_count = steps.len();

    // Save back.
    draft::draft_save(draft::DraftSaveArgs {
        draft_id: draft_id.to_string(),
        manifest,
    })
    .await?;

    Ok(WorkshopMutationReply {
        draft_id: draft_id.to_string(),
        step_count,
        final_index,
    })
}

fn clamp_insert_pos(after: Option<i64>, len: usize) -> usize {
    match after {
        None => len,                        // append
        Some(n) if n < 0 => 0,              // negative = prepend
        Some(n) => ((n + 1) as usize).min(len),
    }
}

/// Shallow JSON merge: keys in `patch` overwrite keys in `target`.
/// Explicit `null` removes a key. Nested objects are NOT deep-merged
/// — workshop steps are flat shapes (per discriminated-union Step
/// schema), so shallow merge matches the underlying data model.
fn merge_step_patch(target: &mut serde_json::Value, patch: &serde_json::Value) {
    let (target_obj, patch_obj) = match (target.as_object_mut(), patch.as_object()) {
        (Some(t), Some(p)) => (t, p),
        _ => return,
    };
    for (k, v) in patch_obj {
        if v.is_null() {
            target_obj.remove(k);
        } else {
            target_obj.insert(k.clone(), v.clone());
        }
    }
}
