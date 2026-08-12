# Ambient shell control matrix

> Design audit for `ambient-shell-capabilities.html`, `ambient-shell-three-pane.html`, and `ambient-shell-work-states.html`.
>
> This file is not architecture or runtime authority. Accepted module ADRs define product behavior; code and tests provide implementation evidence. A visible control in a static mockup is not evidence that its handler or endpoint exists.

## Status vocabulary

| Status | Meaning | Mockup rule |
|---|---|---|
| `wired` | A current handler reaches the governing Resource operation, gate tool, or typed shell IPC. | May appear enabled when the required Resource or state is available. |
| `local` | The control changes presentation or browser state only and legitimately needs no backend endpoint. | May appear enabled; evidence is a UI test rather than endpoint evidence. |
| `partial` | Some of the interaction exists, but required facts, persistence, recovery, or final effect are missing. | Label as illustrative or disable it; do not imply the full outcome is available. |
| `declared` | The mockup names an intended action but no current handler/effect evidence was found. | Disable or remove it until an owning operation and evidence exist. |

All governed product operations converge on canonical Resource `describe`, `query`, and `produce` through `gateInvoke`; typed Tauri IPC remains valid only for shell, OS, and first-party UI responsibilities. `(ADR-001 spine §4 v22; ADR-003 frontend §8.5 v45)`

## Shared shell and session controls

| Control family | Mockup surface | Intent | Handler | Authority / endpoint | Status | Evidence or required correction |
|---|---|---|---|---|---|---|
| `Work / Library / Settings` navigation | all | U9, U14–U21 | Ambient shell sidebar state | Local route/surface state | `local` | The production shell owns the three L1 destinations; no backend endpoint is needed. |
| `⌘K` | capabilities, three-pane | — | No matching ambient command-palette handler confirmed | None confirmed | `declared` | Remove or disable until a command palette owner and keyboard behavior are implemented and assigned an intent. |
| `New session` / composer `＋` session action | capabilities, work-states, three-pane | U13 | `createSession`, `newChat` | Local session store plus canonical transcript persistence on committed turns | `wired` | `AmbientHome.tsx` creates the session and resets the engine; transcript writes use canonical Resource `produce`. |
| Session tabs | three-pane | U13 | Session-tab/store activation | Local projection of canonical transcript list | `local` | Switching tabs is local UI state; transcript enumeration/persistence is separately backed. |
| Task-list search | three-pane | U13 | No matching task/session search handler confirmed | None confirmed | `declared` | The visible search field is not wired by transcript enumeration alone. Remove it or bind it to one local projection with empty and unavailable states. |
| `History` | all | U13 | No standalone History control confirmed in Ambient shell | None confirmed | `declared` | Replace with the implemented transcript/session projection or disable; never create a second history store. |
| `Re-run` | all | U13 | `send(message.content)` | Existing Irisy turn pipeline | `wired` | Reuses the selected user turn and current resolved session context. |
| `Fork` / `Fork from here` / `Fork with edits` | all | U13 | No durable fork handler confirmed | No owner operation confirmed | `declared` | Current `forkFromHere` only rewinds the active browser projection and resets the engine; reload restores the canonical transcript. Do not present that non-durable rewind as a fork. |
| Composer `FCT · Auto` / named FCT | capabilities, work-states | U17 | `selectFct`, `resolveFctSelection` | `query(ctrl://local/catalog/fct, selection-projection)` | `wired` | Selection commits only after exact Resource, optional Skill, scope, and policy facts resolve. |
| Composer Send / Stop | all | U1–U9, U13 | form submit / `stopGeneration` | Irisy turn pipeline; abort controller for Stop | `wired` | Send is disabled without input; Stop appears only while a cancellable request is active. |
| Attachment `＋` | all | U1, U9 | Existing attachment/open-panel paths vary by Resource | Typed shell picker plus bounded Resource attachment handling | `partial` | The generic mockup does not state file/directory semantics or platform errors. Keep illustrative until the Ambient control is verified end to end. |

## Project and external coding controls

| Control family | Mockup surface | Intent | Handler | Authority / endpoint | Status | Evidence or required correction |
|---|---|---|---|---|---|---|
| `New Project` | work-states, three-pane | U9 | No project-directory creation handler found | No owner operation or shell IPC confirmed | `declared` | This is the primary gap. Define whether creation means selecting an existing directory, creating a directory, scaffolding files, or all three; then add one owner and recovery behavior before enabling. |
| Open existing Project Resource | work-states | U9 | `registerProjectResource` from selected workspace | Typed Tauri `register_project_resource` | `wired` | Registers an existing workspace as a Project Resource; it does not create a project. |
| `Open in OpenCode` | work-states | U9 | `launchCodingWorkspace` | Typed Tauri coding launcher, mode `open_code`; projected capability calls remain behind `:17873` | `wired` | Current implementation uses the external-launch flow. UI must show eligibility and launch failure honestly. |
| `Continue with Irisy` | work-states | U9 | No dedicated handler; Irisy is already resident | Local dismissal would be sufficient | `local` | Treat as dismissal/keep-focus, not a second engine transition. Rename to `Stay in CTRL` or remove if the notice is non-modal. |
| Project `Publish` | work-states | U18 or U23 | `publishPack` exists for installed FCT packages, not arbitrary Projects | Feature-pack publication path | `partial` | The mockup Project is not proven to be a publishable FCT package. Hide unless its descriptor advertises the exact governed publish operation. |
| Project file `Open` | work-states | U9, U11 | No generic mockup handler mapped | Resource viewer or typed reveal action must be descriptor-driven | `declared` | Replace hard-coded file rows with Resource links backed by descriptors before enabling. |

## FCT Library controls

| Control family | Mockup surface | Intent | Handler | Authority / endpoint | Status | Evidence or required correction |
|---|---|---|---|---|---|---|
| Find/Installed/Create tabs, live `Find FCTs` filtering, categories, Close, `···` menu | capabilities | U14, U16, U18 | `Discover` local state | Local presentation state over the mounted catalog result | `local` | The mockup and production surface filter as the query changes; no submit action or backend search endpoint is implied. Menu items require their own rows once defined. |
| `Refresh` | capabilities | U14 | `refreshListings` | Existing kernel-backed registry loader | `wired` | Production `Discover` reloads the same registry owner used on mount, disables the control while pending, and replaces the visible listing projection with the returned result. |
| `Create FCT` / `Build an FCT` | capabilities | U16 | `PackCreator` open and authoring flow | Existing FCT creation/install pipeline | `wired` | Creation belongs only in Library; successful creation returns to Installed and does not auto-activate. |
| `Add and resume` | capabilities | U14, U15, U17 | Install exists; automatic resume after install not confirmed as one transaction | `mcp_pack_install`, then selection/turn continuation would be separate | `partial` | Split into `Add FCT` and an explicit post-install `Use FCT`, or implement and test the composed consequence. |
| `Enable` / `Disable` | capabilities | U15, U18 | `setFctEnabled` | canonical `produce` on FCT catalog, `enable` / `disable` | `wired` | Owner rereads the plain-text state before success is reported. |
| `Remove` | capabilities | U18 | `removeFct` / `uninstallPack` | typed uninstall path | `wired` | Available only for removable package-owned FCTs. |
| `Use for this session` | capabilities | U17 | `onUseFct` → Ambient selection | FCT selection-projection query | `wired` | Must be disabled for unresolved/unselectable entries. |
| `Edit` | capabilities | U16, U18 | No generic FCT edit handler confirmed | No single generic operation confirmed | `declared` | Remove or expose only for user-owned FCTs whose descriptor advertises an edit operation. |
| `Open source` | capabilities, work-states | U11, U18 | `revealFct` can reveal owned files; no generic source viewer action confirmed | typed `reveal_capability` for eligible FCTs | `partial` | Rename to `Show files` for backed FCTs. Do not imply a repository/source URL exists. |
| `View disabled` | capabilities | U18 | Installed-list filter state | Local presentation state over catalog results | `local` | No endpoint beyond the catalog list query is needed. |
| `See details`, `See all in Library`, `Skip`, `Why?` | capabilities, work-states | U10–U18, U23 | Decision/detail navigation | Local decision-surface resolution/navigation | `local` | Each option must state its consequence; `Why?` may only reveal supplied provenance. |
| `Save as FCT` | capabilities | U23 | Capture/PackCreator path not confirmed as a complete outcome-to-FCT transaction | FCT authoring/install operations | `partial` | Keep illustrative until reusable job, policy, creation, install, and non-activation behavior are verified end to end. |

## Local application and content controls

| Control family | Mockup surface | Intent | Handler | Authority / endpoint | Status | Evidence or required correction |
|---|---|---|---|---|---|---|
| `Add connection` | capabilities | U19 | No generic add-connection handler confirmed | No owner operation or shell IPC confirmed | `declared` | Disable or remove until a generic connector-discovery and setup owner exists; known connector handlers do not wire this control. |
| Known app `Connect` | capabilities, work-states | U19 | `LocalApps` connector-specific handlers | Typed Tauri connector/provider IPC; credentials stay in Keychain | `wired` | Only render for known connectors with an implemented handler. Availability and platform errors must remain typed. |
| `Read selection` | capabilities | U22 | local-app selection query | Gate-backed source query with narrowed `source:<id>` scope | `wired` | Read-only v1 operation; app selection write remains later scope. |
| `Use in this session` / `Bring into conversation` | capabilities, work-states | U1, U22 | `useLocalAppSelection` / composer insertion | Local composer state after a backed selection query | `wired` | Insertion does not fabricate an Irisy reply or auto-send. |
| `Open as Work Resource` | work-states | U4, U9 | Resource selection/viewer host | Descriptor-driven Work Resource state | `partial` | The architecture and viewer host exist; these exact result buttons need handler/UI evidence. |
| `Rewrite` / `Summarise` / `Translate` | work-states | U2, U6 | No exact content-action handlers confirmed | Should resolve descriptor operation and use query/produce as appropriate | `declared` | Disable until each action has exact target, write/read semantics, ReviewGate behavior, and tests. |
| `Search my notes` | work-states | U3, U4 | Existing vault/knowledge queries exist; exact mockup control not mapped | canonical Resource query / gate search | `partial` | Bind to one canonical local-search request and preserve source references before enabling. |
| `Look it up online` | work-states | U7 | Web lookup capability exists; exact button handler not mapped | Governed web-search query | `partial` | Must remain an explicit action and show unavailable/recovery behavior. |
| Settings subsection navigation | work-states | U20 | Settings surface selection state | Local presentation state | `local` | Switching among settings sections needs no backend endpoint; each setting shown within a section still needs its own persistence evidence. |
| Settings provider `Manage` / `Connect` | work-states | U19, U20 | provider config handlers | Typed Tauri config/Keychain IPC | `wired` | The mockup is illustrative; current Settings implementation is the evidence owner. |
| Settings toggles/select | work-states | U20 | Settings state handlers vary | Typed settings IPC or local preference owner | `partial` | Do not enable a mock setting unless a persisted owner and reload semantics exist. |

## Review, provenance, artifacts, and diagnostics

| Control family | Mockup surface | Intent | Handler | Authority / endpoint | Status | Evidence or required correction |
|---|---|---|---|---|---|---|
| `Approve` / `Reject` / `Write it` / `Not now` | work-states, three-pane | U10 | ReviewGate decision resolution | typed Tauri `review_pending` / `review_resolve` around governed mutation | `partial` | Resolution is wired, but current owner facts do not yet prove the mockup's exact target, staged before/after, revision precondition, and recovery fields. Keep marked illustrative. |
| `View operation` | work-states | U11 | No generic operation-detail handler confirmed | Should query `OperationRef` and descriptor/provenance authority | `declared` | Disable until OperationRef drill-down is implemented and tested. |
| `See the change` | three-pane | U10, U11 | No direct handler confirmed | Pending Outcome/ReviewGate staged change | `partial` | May switch to the local Changes tab only when the pending decision carries the actual staged diff. |
| `Why?` / provenance disclosure | work-states, three-pane | U11 | Decision/provenance disclosure | Local expansion over owner-supplied facts | `partial` | UI behavior is local, but it cannot invent provenance absent from the owner Outcome. |
| `Copy` | work-states | U11 | `navigator.clipboard.writeText` | Browser clipboard | `local` | No backend endpoint required. |
| `Save to a note` | three-pane | U3, U6 | `captureToNotes` | Canonical vault write path reached by the current whole-file note capture | `wired` | The production handler persists the captured content, but the mockup must name the actual note target and must not imply finer-grained merge semantics than the whole-file write provides. |
| `Export` / artifact `Share` | three-pane | U11 | `downloadPart` exists for current artifacts | Browser Blob download | `partial` | Rename `Share` to `Export file`; there is no generic sharing endpoint. Top-level `Export` needs a defined target. |
| `Reveal in Finder` | three-pane | U11 | No generic artifact reveal handler confirmed | Typed shell reveal action required | `declared` | Enable only for a concrete local Resource with a safe resolved path. |
| Results tabs and Table/Board/Chart/Form | three-pane | U5, U11 | Viewer/tab state | Local presentation state | `local` | View switching needs no endpoint; data query/edit operations still do. |
| Smart-table cell edits | three-pane | U6 | `commitCell` / `setTableCell` | canonical bounded write with revision conflict handling | `wired` | UI DOM evidence remains partial because the grid is canvas-rendered. |
| Smart-table row/column/view mutation | three-pane | U5, U6 | `commit` and SmartTableView callbacks | Existing whole-file write path | `partial` | Current ADR records missing revision preconditions for bespoke row/column rewrites. |
| `Add a note` / `See all 12` | three-pane | U3, U4, U6 | No exact bound-knowledge handlers confirmed | Resource viewer/query/produce required | `declared` | Remove until the FCT knowledge projection exposes resolvable Resource operations. |
| `Run checks` | work-states | U21 | diagnostics smoke/status/trace handlers | typed Tauri diagnostics IPC | `wired` | Current diagnostics surface owns module selection and bounded checks. |
| `Resume` diagnostics processing | work-states | U12, U21 | No matching diagnostics-resume handler confirmed | Owner-specific recovery operation required | `declared` | Render only when a typed degradation supplies this recovery action. |
| `See log` | work-states | U11, U21 | diagnostics trace exists; exact button not mapped | typed Tauri `app_diagnostics_trace` | `partial` | Rename to `View trace` and bind to bounded typed trace output. |
| `Export report` | work-states | U21 | `diagnosticsExportPreview` only | typed Tauri `diagnostics_export_preview` | `partial` | Preview exists; final user-selected file save is missing. Do not claim export completion. |

## Implementation gate for a mockup control

A control may move from `declared` or `partial` to `wired` only when all applicable evidence exists:

1. **Intent:** the control serves a v1 intent in ADR-005 §12.
2. **Owner:** a Resource descriptor, operation owner, or legitimate shell/OS owner is named.
3. **Handler:** the production React surface has a concrete event handler.
4. **Boundary:** the handler uses canonical `describe/query/produce`, an existing governed gate tool, or justified typed shell IPC.
5. **Consequences:** target, staged change, precondition, provenance, retryability, and recovery are rendered when required.
6. **Evidence:** targeted tests and visual verification cover enabled, unavailable, conflict, and success states as applicable.

The matrix must be updated in the same change that enables or removes a corresponding mockup control. Runtime code and accepted ADRs always override this audit document.
