// Human-approval commands for the review gate (ADR-002 substrate §264 +
// ADR-006 §4 autonomy ladder).
//
// These live on the Tauri command surface (PWA → kernel, intra-process) on
// purpose: a high-blast call awaiting review is resolved HERE by the human,
// NOT through an MCP argument the calling brain could set itself. The
// external brain reaches only the `:17873` MCP tools, so it physically
// cannot approve its own pending review — that is the trust boundary the
// red-team's C3 demanded (no caller self-approval).

use crate::kernel::review_gate::ReviewRequest;
use crate::shell::kernel_supervisor::KernelHandle;
use tauri::State;

/// List the calls currently waiting for human approval. The PWA renders an
/// approve/deny modal from these — each carries the gate-derived tool +
/// arg summary (never caller prose).
#[tauri::command]
pub async fn review_pending(
    kernel: State<'_, KernelHandle>,
) -> Result<Vec<ReviewRequest>, String> {
    Ok(kernel.runtime.review_gate.list_pending())
}

/// Resolve a pending review with the human's decision. `approved=true` lets
/// the awaiting gate call proceed; `false` denies it. Returns whether the
/// id matched a live pending request.
#[tauri::command]
pub async fn review_resolve(
    kernel: State<'_, KernelHandle>,
    id: String,
    approved: bool,
) -> Result<bool, String> {
    Ok(kernel.runtime.review_gate.resolve(&id, approved))
}
