# LibreOffice Companion — Irisy integration review

> Review record, not architectural authority. The governing contract is
> [ADR-005 Irisy §10 v35](../../adrs/005-irisy.md). This record may propose a
> contract delta but cannot create one.

## Job and form

**Job:** Help a person understand, transform, and safely revise the document or
spreadsheet they are actively editing in LibreOffice without leaving their local
workflow.

**Primary form:** **Companion**. The existing Irisy surface is shown with its
workspace collapsed while LibreOffice remains the editing application. CTRL does
not create another native window, assistant process, or chat popup.

**Reason:** LibreOffice already owns document editing, format fidelity, user
focus, and native revision behavior. Irisy supplies contextual assistance and
reviewable actions rather than replacing the office surface.

## Context and truth

### Minimum context boundary

A future adapter may read only explicitly declared context:

- active document metadata and type;
- user-selected Writer text, Calc range, or explicitly selected object;
- a user-confirmed document section or named cell range; and
- document state needed to explain an approved edit, such as active Track
  Changes status.

It must not silently scrape the entire application UI, clipboard, recent-file
history, or unrelated open documents.

### Truth and provenance

The LibreOffice document remains the user-data truth. CTRL may persist an
explicit user-created Markdown note, report, or artifact as a derived local
output, but it must retain a drill-down link to the source document and selected
context. CTRL must not create a second writable office-document database.

## Capability and gate mapping

| Need | Intended contract mapping | Status |
|---|---|---|
| Inspect active document or selected content | `describe` and `query` through a future local Office adapter | Proposed; no adapter exists in CTRL |
| Explain, summarize, or draft a change | Irisy engine plus local selected context | Proposed |
| Apply text or cell changes | `produce` through `:17873`, staged for review | Proposed |
| Export a user-approved derivative | Effect through the gate | Proposed |
| Document-native action | A narrowly scoped adapter command, only when it cannot be represented by §14 | Not designed |

A direct connection from Irisy to a LibreOffice extension or community MCP
server is out of contract. The adapter must be a governed downstream capability
behind CTRL's `:17873` gate.

## Write, identity, and review boundary

- **Writer:** A proposed edit must use a user-reviewable representation. Track
  Changes is preferred when the target document supports it; otherwise CTRL
  shows an explicit staged diff before applying the mutation.
- **Calc:** A proposed update must identify the range, current values, new
  values, and affected formulas before approval.
- **Impress, Draw, Base, and macro execution:** Out of scope for the first
  review. They cannot inherit Writer or Calc permissions implicitly.
- **Approval:** Mutating calls are governed by ReviewGate. A UNO extension,
  downstream MCP server, or Irisy cannot approve its own action.
- **Identity and secrets:** LibreOffice runs under the local user. Any
  connector credential is held by the OS keychain or the external application's
  declared credential boundary; it never enters a model prompt.

## Degradation and transparency

| Condition | Required behavior |
|---|---|
| LibreOffice is not running | State that no live document context is available; offer file attachment or a local artifact workflow only when the user chooses it. |
| No eligible selection exists | Ask the user to select text or a range; do not infer hidden context. |
| Adapter unavailable or incompatible | Report the missing local capability and do not claim document access. |
| User rejects review | Leave the LibreOffice document unchanged and retain no unapproved mutation. |
| Native write fails | Report the failure, preserve the staged change, and never report success without post-write verification. |

## Preflight evidence

- CTRL currently has one hidden-before-first-order macOS NSPanel and a
  right-side Irisy surface; companion must reuse it rather than create a second
  window. [ADR-003 frontend §1.1 v37](../../adrs/003-frontend.md)
- CTRL's cross-domain control point is the authenticated `:17873` gate;
  §14 exposes `describe`, `query`, and `produce`. [ADR-002 substrate §14
  v77](../../adrs/002-substrate.md)
- Existing CTRL code contains no LibreOffice, Collabora, UNO, WOPI, or office
  adapter implementation.
- Community references exist but are not adopted: [mcp-libre](https://github.com/jwingnut/mcp-libre)
  embeds a LibreOffice UNO extension and exposes a localhost HTTP bridge;
  [patrup/mcp-libre](https://github.com/patrup/mcp-libre) exposes a broader
  community MCP surface. Both require security, lifecycle, and contract review
  before any reuse.
- Collabora Online is not treated as an MCP endpoint; its project documents
  browser integration and a postMessage API, while a host remains responsible
  for WOPI permissions and document lifecycle. [Collabora Online](https://github.com/CollaboraOnline/online.mirror)

## Post-validation evidence

Not started. This record intentionally precedes any UNO bridge, MCP adoption,
or Office adapter implementation.

A future validation must prove:

1. the existing companion form remains one Irisy panel with the workspace
   collapsed;
2. explicit selection reaches the gate without leaking unrelated document
   content;
3. a read path reports truthful document context;
4. a Writer or Calc mutation remains staged until ReviewGate approval;
5. the native document proves the approved mutation occurred; and
6. each unavailable or rejected path degrades as declared above.

## Review outcome

**Preflight outcome: Clarification.** The Companion form itself conforms: it
reuses the existing Irisy panel, keeps LibreOffice documents authoritative, and
requires explicit context plus reviewed mutations. Live UNO integration does
not yet conform because its source, child-process, and bridge contracts are not
accepted. Implementation is blocked until their owning ADRs are amended and bao
approves the resulting design.

**Implementation boundary:** A later local UNO adapter needs a separate design
review under this contract. Its narrow operation model, authentication, process
lifecycle, context serialization, revision preconditions, and Track Changes or
Calc-preview behavior must be specified before code is written.

## Adapter design review — pending bao approval

### Reusable CTRL boundary

The adapter must remain downstream of `:17873`:

```text
Irisy Companion
  -> :17873 gate and ReviewGate
  -> a generic §14 local-source adapter
  -> managed local stdio MCP child (McpHost)
  -> authenticated local LibreOffice extension bridge
  -> UNO
```

The bridge is not a second Irisy surface or a public localhost service. It is
an adapter-private local binding between a managed MCP child and an explicitly
enabled LibreOffice extension. Its wire, authentication, binding lifecycle,
and failure behavior remain undecided under ADR-010; Irisy must never receive
its address, credential, or raw UNO surface.

`ReviewGate` receives the staged Writer edit or Calc range preview before the
adapter may call UNO. A rejected, timed-out, or unavailable review leaves the
document unchanged. Each query must return a document identity, document
revision, target coordinates, and content or range hash. `produce` must carry
those exact preconditions; the bridge rechecks them immediately after approval
and rejects a stale document, selection, or range without writing. A rejected
stale write requires a fresh query, preview, and review. After a native write,
the adapter reads state again and returns verified state rather than claiming
success from a request acknowledgement.

### Required generic source work

The existing `source_describe`, `source_query`, and `source_produce` path is a
manifest-driven HTTP RecordSource. The existing `mcp_proxy_*` path exposes raw
downstream MCP tools. Neither is a valid live-document §14 mapping: the first
cannot reach local UNO, and the second would expose a parallel raw tool surface.

The proposed direction is a reusable **local MCP-backed §14 source adapter**,
not a LibreOffice-specific collection of gate tools. It would map a declared
local source to `describe`, `query`, `produce`, and Effect handles while keeping
its downstream MCP protocol private. LibreOffice would be its first adapter;
any future desktop document application would use the same source boundary.

This is a new ADR-002 §14 substrate decision. It requires an accepted ADR-002
amendment before implementation; this review record cannot approve or define
that kernel contract.

### Candidate runtime and lifecycle boundary

The managed child must use a TypeScript or JavaScript stdio MCP runtime, which
is compatible with the v1 MCP runtime lock. LibreOffice extension code is
application-owned integration code, outside CTRL's MCP runtime; it must be
user-installed and explicitly enabled. It must not expose an unauthenticated
listener. A Python-based UNO MCP bridge is not a permitted substitute without
an accepted spine amendment because the v1 runtime lock defers Python and Rust
MCP runtime implementations.

The child must have an ADR-004-owned Actor contract before code: named
ownership, explicit spawn only after user enablement, sandbox capability scope,
health and exit reporting, shutdown on disable or CTRL exit, reconnect policy,
and fail-closed behavior when the extension or bridge disappears. `McpHost`
remains the managed downstream MCP client; it does not by itself define this
Actor, sandbox, or failure contract.

### Proposed first operation set

- `describe`: report Writer or Calc type, selected-context availability, Track
  Changes capability and state, and supported operations; no document body.
- `query`: return only the explicitly selected Writer text or Calc range with
  its coordinates, values, formulas, provenance handle, and revision
  preconditions.
- `produce`: accept a staged Writer replacement/insertion or Calc range update
  only when its preview identifies the exact target and before/after values,
  and only when all query preconditions still match.
- `Effect`: export a user-approved derivative; report progress through the
  existing `query { watch: true }` contract.

Impress, Draw, Base, macro execution, whole-document extraction, hidden UI or
clipboard capture, automatic LibreOffice launch, and background document
watching remain out of scope.

### Decisions required from bao

Before any implementation, bao must approve all of the following:

1. a user-installed, explicitly enabled LibreOffice extension as the only UNO
   boundary for the first live Companion integration;
2. a managed TypeScript or JavaScript stdio MCP child plus an adapter-private
   authenticated local bridge, including the ADR-010 transport and trust
   binding, rather than a Python community MCP or direct Irisy connection;
3. a generic local MCP-backed §14 source adapter as the kernel extension point,
   with LibreOffice as its first consumer rather than bespoke `libreoffice_*`
   gate tools, followed by an ADR-002 amendment;
4. an ADR-004 Actor, sandbox, lifecycle, health, and failure contract for the
   managed child; and
5. revision and target-hash preconditions that force a fresh query and review
   whenever the document or selection changes after approval.

Without those approvals and amendments, implementation remains blocked. This is
not an ADR-005 contract delta; it is a design clarification requiring accepted
amendments to ADR-002, ADR-004, and ADR-010 before code relies on it.

## Proposed contract delta

None. Current evidence does not justify changing ADR-005 §10.
