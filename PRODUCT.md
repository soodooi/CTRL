# CTRL Product Intent

**Updated:** 2026-08-05

> Product intent only, not architecture authority. The accepted module ADRs indexed at [`vault/ctrl/adrs/INDEX.md`](vault/ctrl/adrs/INDEX.md) govern identity, resources, shell, discovery, communication, security, and implementation boundaries; if this summary conflicts, the owning ADR wins.

CTRL is an AI-native ambient workbench and creator substrate. It helps a person work across local content, applications, and reusable capabilities without turning chat, a coding agent, or a workflow canvas into the product shell.

## Product model

CTRL has **one fixed user-visible AI identity: Irisy**. Irisy completes tasks by combining six explicit context facts:

`session_id + explicit Resources + optional pinned Skill + capability scope + policy + task`

There is no separate Coding agent product role, Assistant/Coding identity switch, or user-facing engine/persona registry. Project coding is a **Project Resource + Skill/capability scope** used by the same Irisy identity.

The product exposes one user-facing reusable-capability unit:

- **FCT** — CTRL's sole product noun for a reusable unit that can be created, found, installed, removed, selected, and used. FCT is intentionally not expanded in UI copy. Create/Manage and Use are separate interactions: Library authors and manages availability; the Irisy composer selects an available FCT for one canonical session. A selected FCT resolves live into preserved Work Resources plus appended dependencies, an optional internal Skill, enforced least-privilege gate scope, policy facts, and an existing package/install reference.

Resource, Skill, capability, manifest, package, and MCP remain precise architecture or transparency terms, not competing product shelf names. A Resource still owns typed content; a Skill remains a plain-text `SKILL.md` method; capabilities and package descriptors retain their existing owners. FCT is only their normalized product projection and never owns a session, transcript, Resource, Skill, capability, operation, or ReviewGate decision.

Resources are operated through the canonical surface `describe(ref)`, `query(ref, request)`, and `produce(ref, operation)`. Reads, writes, and long-running operations remain typed, governed, inspectable, and routed through the `:17873` gate where they cross a trust boundary.

## One Ambient shell

CTRL has one Ambient production shell. Its L1 navigation is exactly:

1. **Work** — current tasks and explicitly opened Resources.
2. **Library** — the sole FCT lifecycle surface. Find/Installed manages discovery, install, removal, and availability; Create FCT is a separate authoring mode that returns to Installed and never auto-activates its result.
3. **Settings** — providers, policy, integrations, and product configuration.

Using an FCT is intentionally separate from creating one: the Irisy composer selects Auto or one available FCT for the current session. An explicit Library `Use FCT` action may set that session selection and return focus to the composer; no creation UI appears in the composer.

Irisy is resident in the shell; Irisy is not an L1 destination. Content is rendered by descriptor and content type through the viewer registry, not by source brand, business scene, or per-pack UI branch. A newly installed type becomes useful by registering its descriptor/viewer contract, not by adding another shell route.

Legacy routes may exist only as thin, version-windowed redirects into Work, Library, or Settings. They are not parallel product surfaces.

## Two brain paths, one gate

Irisy uses CTRL's managed engine path. A user may also choose a **BYO CLI**, but that CLI is an external `:17873` gate client: CTRL projects scoped Resources, Skills, and capabilities into the CLI's native configuration and does not duplicate, own, or supervise the CLI's agent loop. BYO CLI is not a second CTRL identity or a Coding product role.

Both paths see only their authorized capability scope. FCT selection uses the same canonical registry and resolver in either path; it projects exact Resources, optional internal Skill, capability scope, and policy rather than transferring a session or inventing another catalogue. Mutations use ReviewGate and remain attributable. Credentials stay in the OS keychain or their owning application boundary and never enter prompts or portable manifests.

## Local-first product contract

- Local readable files are truth; cloud services are optional mirrors or search augmentation.
- User content stays recoverable as Markdown, YAML, TOML, JSON, or another declared portable format.
- Library is the only product surface that creates, finds, installs, or removes FCTs. Active per-session selection belongs to the composer; Library `Use FCT` is only a handoff to that control. Public install still remains local and anonymous; cloud unavailability does not disable the local registry or installed FCTs.
- CTRL renders content by type, not source platform.
- One MCP operation is atomic; CTRL is not a workflow editor.
- Transparency is available by drill-down from result to descriptor, operation state, provenance, and raw local source.

## Product boundaries

CTRL is not an IDE, a separate coding-agent product, a workflow/canvas editor, a model reseller, a hardcoded collection of business scenes, a long-tail connector catalogue, a multi-tenant SaaS data plane, or a replacement for the user's existing specialist applications. CTRL sells the governed local substrate, tools, and capability ecosystem—not an additional agent identity.
