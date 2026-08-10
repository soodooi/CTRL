// FCT catalog — normalized, read-only projection over installed package and
// local Skill authorities. FCT is product vocabulary only: this owner creates
// no package schema, session, capability, or dispatch path.
// (ADR-002 substrate §15.4 v84)
// (ADR-002 substrate §16 v84)

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::commands::skills::{scan_local_skills_blocking, LocalSkill};
use crate::kernel::mcp_host::McpHost;
use crate::kernel::capability_state::{self, CapabilityState};
use crate::kernel::resource::{
    Feedback, FeedbackSeverity, OperationRecoveryPolicy, Outcome, PresentationHints,
    ProduceOperationDescriptor, QueryContract, ResourceAccessContext, ResourceDegradation,
    ResourceDescriptor, ResourceError, ResourceFreshness, ResourceOwner, ResourceRef,
    ResourceUnavailableReason,
};

const CATALOG_REF: &str = "ctrl://local/system/catalog";
const BASE_SCOPE: [&str; 3] = ["tool:describe", "tool:query", "tool:produce"];

#[derive(Debug, Clone, Serialize)]
pub struct FctItem {
    pub r#ref: String,
    pub name: String,
    pub summary: String,
    pub source_kind: String,
    pub install_state: String,
    pub selection_kind: String,
    /// User-owned enable state. `installed` used to be the only reachable state,
    /// so the only way to stop using something was to delete it.
    /// (ADR-002 substrate §15.4.1 v88)
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FctSelectionProjection {
    pub r#ref: String,
    pub resources: Vec<ResourceRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_id: Option<String>,
    pub capability_scope: Vec<String>,
    pub policy: String,
    pub install_state: String,
    pub install_ref: String,
}

#[derive(Debug, Deserialize)]
struct CatalogRequest {
    operation: String,
    #[serde(default)]
    r#ref: Option<String>,
}

/// The two bounded write operations this owner accepts. Install and uninstall
/// stay where they already live; adding them here would create a second surface
/// for the same act. (ADR-002 substrate §15.4.1 v88)
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CatalogOperation {
    Enable { r#ref: String },
    Disable { r#ref: String },
}

#[derive(Debug, Clone)]
struct PackageProjection {
    item: FctItem,
    id: String,
    resources: Vec<ResourceRef>,
    skill_id: Option<String>,
    tools: Vec<String>,
    has_server: bool,
    install_ref: String,
}

pub struct FctCatalogOwner {
    mcp_host: Arc<McpHost>,
    /// Where the user's enable/disable state lives (`~/.ctrl`). `None` when no
    /// home directory is known, in which case everything reads as enabled and
    /// a write reports that it cannot persist rather than pretending to.
    state_root: Option<PathBuf>,
    /// Where installed packs live (`~/.ctrl/mcps`). Injectable so the enable
    /// state can be verified against a known set instead of the developer's own
    /// machine.
    installed_root: Option<PathBuf>,
}

impl FctCatalogOwner {
    pub fn new(mcp_host: Arc<McpHost>) -> Self {
        Self {
            mcp_host,
            state_root: capability_state::default_root(),
            installed_root: installed_root(),
        }
    }

    #[cfg(test)]
    fn with_roots(mcp_host: Arc<McpHost>, state_root: PathBuf, installed_root: PathBuf) -> Self {
        Self {
            mcp_host,
            state_root: Some(state_root),
            installed_root: Some(installed_root),
        }
    }

    /// Read the user's enable state. An unreadable state file fails closed: it is
    /// reported rather than treated as "nothing disabled", because silently
    /// re-offering a capability the user turned off is the worse outcome.
    fn capability_state(&self) -> Result<CapabilityState, ResourceError> {
        let Some(root) = self.state_root.as_ref() else {
            return Ok(CapabilityState::default());
        };
        CapabilityState::load(root).map_err(|_| unavailable(false))
    }

    fn ensure_catalog(resource: &ResourceRef) -> Result<(), ResourceError> {
        if resource.to_string() == CATALOG_REF {
            Ok(())
        } else {
            Err(ResourceError::OwnerNotFound)
        }
    }

    async fn resolve_package_tools(
        &self,
        package: &PackageProjection,
    ) -> Result<Vec<String>, ResourceError> {
        if !package.has_server {
            return Ok(package.tools.clone());
        }
        // A descriptor is installation metadata, not live tool truth. Resolve
        // every server-backed selection against McpHost so removed tools revoke
        // exact grants and unavailable servers fail closed.
        // (ADR-002 substrate §15.4 v84; ADR-004 cap § execution v14)
        let mut tools = self
            .mcp_host
            .proxy_list_tools(&package.id)
            .await
            .map_err(|_| unavailable(true))?
            .into_iter()
            .map(|tool| format!("{}_{}", package.id, tool.name))
            .collect::<Vec<_>>();
        tools.sort();
        tools.dedup();
        Ok(tools)
    }

    async fn scan(
        &self,
    ) -> Result<
        (
            Vec<FctItem>,
            BTreeMap<String, PackageProjection>,
            BTreeMap<String, LocalSkill>,
        ),
        ResourceError,
    > {
        let skills = tokio::task::spawn_blocking(scan_local_skills_blocking)
            .await
            .map_err(|_| unavailable(true))?
            .map_err(|_| unavailable(true))?;
        let skill_map: BTreeMap<String, LocalSkill> = skills
            .into_iter()
            .map(|skill| (skill.name.clone(), skill))
            .collect();

        let descriptors = self.mcp_host.list_proxy_installed().await;
        let descriptor_tools: BTreeMap<String, Vec<String>> = descriptors
            .into_iter()
            .map(|descriptor| {
                let tools = descriptor
                    .tools
                    .into_iter()
                    .map(|tool| format!("{}_{}", descriptor.id, tool.name))
                    .collect();
                (descriptor.id, tools)
            })
            .collect();

        let mut packages = BTreeMap::new();
        if let Some(root) = self.installed_root.clone() {
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.flatten() {
                    if !entry.path().is_dir() {
                        continue;
                    }
                    let id = entry.file_name().to_string_lossy().to_string();
                    if id.is_empty() {
                        continue;
                    }
                    let projection = read_package_projection(
                        &entry.path(),
                        &id,
                        &skill_map,
                        descriptor_tools.get(&id).cloned().unwrap_or_default(),
                    );
                    packages.insert(format!("pack:{id}"), projection);
                }
            }
        }

        let mut items: Vec<FctItem> = packages
            .values()
            .map(|package| package.item.clone())
            .collect();
        items.extend(skill_map.values().map(|skill| FctItem {
            r#ref: format!("skill:{}", skill.name),
            name: skill.name.clone(),
            summary: skill.description.clone().unwrap_or_default(),
            source_kind: "skill".to_owned(),
            install_state: "available".to_owned(),
            selection_kind: "selectable".to_owned(),
            enabled: true,
        }));

        // A disabled capability stays listed, so the user can find and re-enable
        // it, but stops being selectable so nothing can project it into a turn.
        // (ADR-002 substrate §15.4.1 v88)
        let state = self.capability_state()?;
        for item in &mut items {
            if state.is_disabled(&item.r#ref) {
                item.enabled = false;
                item.selection_kind = "disabled".to_owned();
            }
        }
        for (r#ref, package) in &mut packages {
            if state.is_disabled(r#ref) {
                package.item.enabled = false;
                package.item.selection_kind = "disabled".to_owned();
            }
        }
        items.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then(left.r#ref.cmp(&right.r#ref))
        });
        Ok((items, packages, skill_map))
    }
}

#[async_trait]
impl ResourceOwner for FctCatalogOwner {
    async fn describe(
        &self,
        _context: &ResourceAccessContext,
        resource: &ResourceRef,
    ) -> Result<ResourceDescriptor, ResourceError> {
        Self::ensure_catalog(resource)?;
        Ok(ResourceDescriptor {
            protocol_version: "ctrl.resource.v1".to_owned(),
            resource: resource.clone(),
            content_type: "application/vnd.ctrl.fct-catalog+json".to_owned(),
            provenance: Vec::new(),
            freshness: ResourceFreshness {
                observed_at: None,
                revision: None,
                stale: false,
            },
            degradation: None::<ResourceDegradation>,
            presentation: PresentationHints {
                viewer: Some("fct-library".to_owned()),
                title: Some("FCT Library".to_owned()),
                preferred_columns: vec![
                    "name".to_owned(),
                    "summary".to_owned(),
                    "install_state".to_owned(),
                ],
            },
            query: QueryContract {
                request_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["operation"],
                    "properties": {
                        "operation": { "enum": ["list", "selection-projection"] },
                        "ref": { "type": "string", "minLength": 1, "maxLength": 512 }
                    },
                    "allOf": [{
                        "if": { "properties": { "operation": { "const": "selection-projection" } } },
                        "then": { "required": ["ref"] }
                    }]
                }),
                result_schema: json!({ "type": ["array", "object"] }),
                watchable: false,
            },
            // Enable/disable are the only writes this owner accepts. Install and
            // uninstall keep their existing surface rather than gaining a second
            // one here. (ADR-002 substrate §15.4.1 v88)
            produce: ["enable", "disable"]
                .into_iter()
                .map(|kind| ProduceOperationDescriptor {
                    kind: kind.to_owned(),
                    input_schema: json!({
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["kind", "ref"],
                        "properties": {
                            "kind": { "const": kind },
                            "ref": { "type": "string", "minLength": 1, "maxLength": 512 }
                        }
                    }),
                    result_schema: json!({
                        "type": "object",
                        "properties": {
                            "resource": { "type": "string" },
                            "target": { "type": "string" },
                            "staged": { "type": "object" },
                            "effect": { "type": "object" },
                            "feedback": { "type": "object" },
                            "result": { "type": "object" }
                        }
                    }),
                    // Availability of a capability is a privilege change, so an
                    // external caller's request is review-eligible.
                    review_required: true,
                    // The state file is rewritten atomically and survives a
                    // restart, so the committed effect is durable.
                    recovery: OperationRecoveryPolicy::Durable,
                    retention_seconds: 0,
                })
                .collect(),
        })
    }

    async fn query(
        &self,
        _context: &ResourceAccessContext,
        resource: &ResourceRef,
        request: Value,
    ) -> Result<Value, ResourceError> {
        Self::ensure_catalog(resource)?;
        let request: CatalogRequest =
            serde_json::from_value(request).map_err(|error| ResourceError::InvalidPayload {
                message: error.to_string(),
            })?;
        let (items, packages, skills) = self.scan().await?;
        match request.operation.as_str() {
            "list" => serde_json::to_value(items).map_err(invalid_payload),
            "selection-projection" => {
                let selected = request.r#ref.ok_or_else(|| ResourceError::InvalidPayload {
                    message: "selection-projection requires ref".to_owned(),
                })?;
                // A disabled capability is refused here too, not only hidden from
                // the list, so a stale caller-held ref cannot bypass the state.
                // (ADR-002 substrate §15.4.1 v88)
                if items
                    .iter()
                    .any(|item| item.r#ref == selected && !item.enabled)
                {
                    return Err(ResourceError::InvalidPayload {
                        message: "FCT is disabled; enable it in Library before using it".to_owned(),
                    });
                }
                if let Some(name) = selected.strip_prefix("skill:") {
                    if !skills.contains_key(name) {
                        return Err(unavailable(false));
                    }
                    return serde_json::to_value(FctSelectionProjection {
                        r#ref: selected.clone(),
                        resources: Vec::new(),
                        skill_id: Some(name.to_owned()),
                        capability_scope: BASE_SCOPE
                            .iter()
                            .map(|value| (*value).to_owned())
                            .collect(),
                        policy: "review-gated-writes".to_owned(),
                        install_state: "available".to_owned(),
                        install_ref: selected,
                    })
                    .map_err(invalid_payload);
                }
                let package = packages.get(&selected).ok_or_else(|| unavailable(false))?;
                if package.item.selection_kind != "selectable" {
                    return Err(ResourceError::InvalidPayload {
                        message: "FCT is installed but has no projectable Resource, Skill, or exact gate scope".to_owned(),
                    });
                }
                let tools = self.resolve_package_tools(package).await?;
                if package.resources.is_empty() && package.skill_id.is_none() && tools.is_empty() {
                    return Err(ResourceError::InvalidPayload {
                        message: "FCT resolved without a Resource, Skill, or exact gate scope"
                            .to_owned(),
                    });
                }
                let mut scope: BTreeSet<String> =
                    BASE_SCOPE.iter().map(|value| (*value).to_owned()).collect();
                scope.extend(tools.iter().map(|tool| format!("tool:{tool}")));
                serde_json::to_value(FctSelectionProjection {
                    r#ref: selected,
                    resources: package.resources.clone(),
                    skill_id: package.skill_id.clone(),
                    capability_scope: scope.into_iter().collect(),
                    policy: "review-gated-writes".to_owned(),
                    install_state: "installed".to_owned(),
                    install_ref: package.install_ref.clone(),
                })
                .map_err(invalid_payload)
            }
            _ => Err(ResourceError::UnsupportedOperation),
        }
    }

    /// Stage without committing, so an external caller's request carries the
    /// before/after the reviewer needs. (ADR-002 substrate §15.5.3 v86)
    async fn stage(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Outcome, ResourceError> {
        Self::ensure_catalog(resource)?;
        authorize_context(context)?;
        let requested = parse_operation(operation)?;
        let (target, disable) = requested.target();
        let item = self.find_item(target).await?;
        Ok(Self::state_change(resource, &item, disable))
    }

    async fn produce(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Value, ResourceError> {
        Self::ensure_catalog(resource)?;
        authorize_context(context)?;
        let requested = parse_operation(operation)?;
        let (target, disable) = requested.target();
        // Refuse a ref the catalogue does not know rather than persisting state
        // for a capability that does not exist.
        let item = self.find_item(target).await?;
        let mut outcome = Self::state_change(resource, &item, disable);
        let Some(root) = self.state_root.as_ref() else {
            outcome.feedback = Some(feedback(
                "state_unavailable",
                "no home directory is known, so the enable state cannot be saved",
                false,
            ));
            return serde_json::to_value(outcome).map_err(invalid_payload);
        };
        CapabilityState::set_disabled(root, &item.r#ref, disable)
            .map_err(|_| unavailable(false))?;
        // Verify by rereading from disk rather than trusting the value we just
        // wrote; §15.5.2 forbids claiming a mutation we did not confirm.
        let observed = CapabilityState::load(root).map_err(|_| unavailable(false))?;
        if observed.is_disabled(&item.r#ref) != disable {
            outcome.feedback = Some(feedback(
                "state_unverified",
                "the enable state did not match after writing",
                true,
            ));
            return serde_json::to_value(outcome).map_err(invalid_payload);
        }
        outcome.result = Some(json!({ "ref": item.r#ref, "enabled": !disable }));
        serde_json::to_value(outcome.committed(
            if disable {
                "disabled the capability"
            } else {
                "enabled the capability"
            },
            Some("reread the capability state file and it matched".to_owned()),
        ))
        .map_err(invalid_payload)
    }
}

impl FctCatalogOwner {
    /// The staged before/after for an availability change, in the user's terms
    /// rather than as a file diff.
    fn state_change(resource: &ResourceRef, item: &FctItem, disable: bool) -> Outcome {
        Outcome::staged(
            resource.clone(),
            item.name.clone(),
            if item.enabled { "enabled" } else { "disabled" },
            if disable { "disabled" } else { "enabled" },
        )
        .with_precondition("Ref", item.r#ref.clone())
        .with_precondition("Source", item.source_kind.clone())
    }

    async fn find_item(&self, capability_ref: &str) -> Result<FctItem, ResourceError> {
        let (items, _, _) = self.scan().await?;
        items
            .into_iter()
            .find(|item| item.r#ref == capability_ref)
            .ok_or_else(|| ResourceError::InvalidPayload {
                message: "no installed capability has that ref".to_owned(),
            })
    }
}

impl CatalogOperation {
    /// (ref, disable)
    fn target(&self) -> (&str, bool) {
        match self {
            Self::Enable { r#ref } => (r#ref.as_str(), false),
            Self::Disable { r#ref } => (r#ref.as_str(), true),
        }
    }
}

fn parse_operation(operation: Value) -> Result<CatalogOperation, ResourceError> {
    serde_json::from_value(operation).map_err(|error| ResourceError::InvalidPayload {
        message: error.to_string(),
    })
}

fn feedback(code: &str, message: &str, retryable: bool) -> Feedback {
    Feedback {
        code: code.to_owned(),
        message: message.to_owned(),
        severity: FeedbackSeverity::Error,
        field: None,
        retryable,
        details: serde_json::Map::new(),
    }
}

/// Availability of a capability is registry state, so a caller must hold the
/// `registry` domain (or full scope) to read or change it.
/// (ADR-002 substrate §17 v85; §15.4.1 v88)
fn authorize_context(context: &ResourceAccessContext) -> Result<(), ResourceError> {
    if context
        .capability_scope
        .iter()
        .any(|scope| matches!(scope.as_str(), "*" | "registry"))
    {
        Ok(())
    } else {
        Err(ResourceError::Denied)
    }
}

fn installed_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("mcps"))
}

fn read_package_projection(
    directory: &Path,
    id: &str,
    skills: &BTreeMap<String, LocalSkill>,
    mut tools: Vec<String>,
) -> PackageProjection {
    let manifest = std::fs::read(directory.join("manifest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let name = manifest
        .as_ref()
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or(id)
        .to_owned();
    let summary = manifest
        .as_ref()
        .and_then(|value| value.get("description"))
        .and_then(|description| {
            description
                .as_str()
                .or_else(|| description.get("short").and_then(Value::as_str))
        })
        .unwrap_or_default()
        .to_owned();
    let mut resources: Vec<ResourceRef> = manifest
        .as_ref()
        .and_then(|value| value.get("resources"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|value| value.parse().ok())
        .collect();
    resources.sort_by_key(ToString::to_string);
    resources.dedup();
    let skill_id = manifest
        .as_ref()
        .and_then(|value| value.get("skills"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .find(|name| skills.contains_key(*name))
        .map(str::to_owned);
    let has_server = manifest
        .as_ref()
        .and_then(|value| value.get("server"))
        .is_some_and(Value::is_object);
    tools.sort();
    tools.dedup();
    let selectable = !resources.is_empty() || skill_id.is_some() || !tools.is_empty() || has_server;
    PackageProjection {
        item: FctItem {
            r#ref: format!("pack:{id}"),
            name,
            summary,
            source_kind: "package".to_owned(),
            install_state: "installed".to_owned(),
            selection_kind: if selectable {
                "selectable"
            } else {
                "unavailable"
            }
            .to_owned(),
            // The user's state is applied in `scan`, which is the only place that
            // has read it. A projection built here is enabled until told otherwise.
            enabled: true,
        },
        id: id.to_owned(),
        resources,
        skill_id,
        tools,
        has_server,
        install_ref: format!("pack:{id}"),
    }
}

fn unavailable(retryable: bool) -> ResourceError {
    ResourceError::Unavailable {
        reason: ResourceUnavailableReason::OwnerUnavailable,
        retryable,
    }
}

fn invalid_payload(error: serde_json::Error) -> ResourceError {
    ResourceError::InvalidPayload {
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "pwa".to_owned(),
            capability_scope: vec!["registry".to_owned()],
        }
    }

    fn catalog_ref() -> ResourceRef {
        CATALOG_REF.parse().expect("catalog ref")
    }

    /// A catalogue with exactly one installed pack, so enable state can be
    /// verified against a known set instead of the developer's machine.
    fn owner_with_one_pack(
        state_root: &Path,
        installed: &Path,
    ) -> (FctCatalogOwner, String) {
        let pack = installed.join("demo-pack");
        std::fs::create_dir_all(&pack).expect("pack dir");
        std::fs::write(
            pack.join("manifest.json"),
            json!({
                "name": "Demo Pack",
                "description": "a demo",
                // A Resource makes it projectable without needing a live server,
                // so these tests exercise enable state rather than MCP startup.
                "resources": ["ctrl://local/note/Demo.md"]
            })
            .to_string(),
        )
        .expect("manifest");
        (
            FctCatalogOwner::with_roots(
                Arc::new(McpHost::new()),
                state_root.to_path_buf(),
                installed.to_path_buf(),
            ),
            "pack:demo-pack".to_owned(),
        )
    }

    #[tokio::test]
    async fn the_catalogue_advertises_exactly_enable_and_disable() {
        let owner = FctCatalogOwner::new(Arc::new(McpHost::new()));
        let descriptor = owner
            .describe(&registry_context(), &catalog_ref())
            .await
            .expect("describe");
        let kinds: Vec<&str> = descriptor
            .produce
            .iter()
            .map(|operation| operation.kind.as_str())
            .collect();
        assert_eq!(kinds, vec!["enable", "disable"]);
        // Availability is a privilege change, so an external caller is reviewable.
        assert!(descriptor
            .produce
            .iter()
            .all(|operation| operation.review_required));
    }

    #[tokio::test]
    async fn a_caller_without_the_registry_domain_cannot_change_availability() {
        let owner = FctCatalogOwner::new(Arc::new(McpHost::new()));
        let context = ResourceAccessContext {
            caller: "external".to_owned(),
            capability_scope: vec!["vault".to_owned()],
        };
        assert!(matches!(
            owner
                .produce(
                    &context,
                    &catalog_ref(),
                    json!({ "kind": "disable", "ref": "pack:demo-pack" })
                )
                .await,
            Err(ResourceError::Denied)
        ));
    }

    #[tokio::test]
    async fn disabling_an_unknown_ref_is_refused_instead_of_persisted() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let installed = tempfile::tempdir().expect("installed root");
        let owner = FctCatalogOwner::with_roots(
            Arc::new(McpHost::new()),
            temporary.path().to_path_buf(),
            installed.path().to_path_buf(),
        );
        assert!(matches!(
            owner
                .produce(
                    &registry_context(),
                    &catalog_ref(),
                    json!({ "kind": "disable", "ref": "pack:does-not-exist" })
                )
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
        assert!(!temporary.path().join("capabilities.toml").exists());
    }

    #[tokio::test]
    async fn an_unsupported_operation_is_refused_before_touching_state() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let installed = tempfile::tempdir().expect("installed root");
        let (owner, _) = owner_with_one_pack(temporary.path(), installed.path());
        assert!(matches!(
            owner
                .produce(
                    &registry_context(),
                    &catalog_ref(),
                    json!({ "kind": "uninstall", "ref": "pack:demo-pack" })
                )
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
        assert!(!temporary.path().join("capabilities.toml").exists());
    }

    #[tokio::test]
    async fn disabling_reports_a_verified_state_change_and_stops_selection() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let installed = tempfile::tempdir().expect("installed root");
        let (owner, pack_ref) = owner_with_one_pack(temporary.path(), installed.path());

        // Selectable to begin with.
        let listed: Vec<Value> = serde_json::from_value(
            owner
                .query(&registry_context(), &catalog_ref(), json!({ "operation": "list" }))
                .await
                .expect("list"),
        )
        .expect("items");
        let entry = listed
            .iter()
            .find(|item| item["ref"] == pack_ref.as_str())
            .expect("pack listed");
        assert_eq!(entry["enabled"], true);
        assert_eq!(entry["selection_kind"], "selectable");

        let outcome = owner
            .produce(
                &registry_context(),
                &catalog_ref(),
                json!({ "kind": "disable", "ref": pack_ref }),
            )
            .await
            .expect("disable");
        assert_eq!(outcome["staged"]["before"], "enabled");
        assert_eq!(outcome["staged"]["after"], "disabled");
        assert_eq!(outcome["target"], "Demo Pack");
        assert_eq!(
            outcome["effect"]["verified_by"],
            "reread the capability state file and it matched"
        );
        assert_eq!(outcome["result"]["enabled"], false);
        assert!(outcome.get("feedback").is_none());

        // Still listed, so the user can find and re-enable it, but not selectable.
        let listed: Vec<Value> = serde_json::from_value(
            owner
                .query(&registry_context(), &catalog_ref(), json!({ "operation": "list" }))
                .await
                .expect("list"),
        )
        .expect("items");
        let entry = listed
            .iter()
            .find(|item| item["ref"] == pack_ref.as_str())
            .expect("pack still listed");
        assert_eq!(entry["enabled"], false);
        assert_eq!(entry["selection_kind"], "disabled");

        // A stale caller-held ref cannot bypass the state.
        assert!(matches!(
            owner
                .query(
                    &registry_context(),
                    &catalog_ref(),
                    json!({ "operation": "selection-projection", "ref": pack_ref })
                )
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
    }

    #[tokio::test]
    async fn enabling_restores_selection_without_reinstalling() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let installed = tempfile::tempdir().expect("installed root");
        let (owner, pack_ref) = owner_with_one_pack(temporary.path(), installed.path());
        owner
            .produce(
                &registry_context(),
                &catalog_ref(),
                json!({ "kind": "disable", "ref": pack_ref }),
            )
            .await
            .expect("disable");

        let outcome = owner
            .produce(
                &registry_context(),
                &catalog_ref(),
                json!({ "kind": "enable", "ref": pack_ref }),
            )
            .await
            .expect("enable");
        assert_eq!(outcome["staged"]["before"], "disabled");
        assert_eq!(outcome["staged"]["after"], "enabled");
        assert_eq!(outcome["result"]["enabled"], true);

        // The pack files were never touched: it projects again immediately.
        owner
            .query(
                &registry_context(),
                &catalog_ref(),
                json!({ "operation": "selection-projection", "ref": pack_ref }),
            )
            .await
            .expect("selectable again");
    }

    #[tokio::test]
    async fn a_staged_change_carries_the_facts_a_reviewer_needs() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let installed = tempfile::tempdir().expect("installed root");
        let (owner, pack_ref) = owner_with_one_pack(temporary.path(), installed.path());
        let outcome = owner
            .stage(
                &registry_context(),
                &catalog_ref(),
                json!({ "kind": "disable", "ref": pack_ref }),
            )
            .await
            .expect("stage");
        let facts = outcome.review_facts().expect("review facts");
        assert_eq!(facts.target.as_deref(), Some("Demo Pack"));
        assert_eq!(facts.before, "enabled");
        assert_eq!(facts.after, "disabled");
        // Staging must not persist anything.
        assert!(!temporary.path().join("capabilities.toml").exists());
    }

    #[tokio::test]
    async fn an_unreadable_state_file_fails_closed_rather_than_re_enabling() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let installed = tempfile::tempdir().expect("installed root");
        let (owner, _) = owner_with_one_pack(temporary.path(), installed.path());
        std::fs::write(temporary.path().join("capabilities.toml"), "disabled = 7\n")
            .expect("write bad state");
        assert!(matches!(
            owner
                .query(&registry_context(), &catalog_ref(), json!({ "operation": "list" }))
                .await,
            Err(ResourceError::Unavailable { .. })
        ));
    }

    #[tokio::test]
    async fn server_backed_projection_replaces_descriptor_tools_with_live_tools() {
        use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource, McpToolDescriptor};

        let host = Arc::new(McpHost::new());
        let pack_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root")
            .join("packages/ctrl-mcps/optional/ctrl-libreoffice");
        host.register(McpServerDescriptor {
            id: "live-tools".to_owned(),
            name: "Live tools fixture".to_owned(),
            version: "0.1.0".to_owned(),
            description: String::new(),
            tools: vec![McpToolDescriptor {
                name: "stale".to_owned(),
                description: String::new(),
                input_schema: json!({ "type": "object" }),
            }],
            source: McpServerSource::Local {
                command: "node".to_owned(),
                args: vec![
                    pack_dir.join("server.mjs").to_string_lossy().to_string(),
                    "--untrusted-test".to_owned(),
                ],
                trusted_libreoffice_adapter: false,
                sandbox_pack_dir: None,
                allow_loopback_network: false,
            },
        })
        .await;
        let owner = FctCatalogOwner::new(host.clone());
        let package = PackageProjection {
            item: FctItem {
                r#ref: "pack:live-tools".to_owned(),
                name: "Live tools fixture".to_owned(),
                summary: String::new(),
                source_kind: "package".to_owned(),
                install_state: "installed".to_owned(),
                selection_kind: "selectable".to_owned(),
                enabled: true,
            },
            id: "live-tools".to_owned(),
            resources: Vec::new(),
            skill_id: None,
            tools: vec!["live-tools_stale".to_owned()],
            has_server: true,
            install_ref: "pack:live-tools".to_owned(),
        };

        let tools = owner
            .resolve_package_tools(&package)
            .await
            .expect("live server tools");
        assert_eq!(tools, ["live-tools_read_selected_context"]);
        assert!(!tools.iter().any(|tool| tool.ends_with("_stale")));
        host.shutdown_all().await.expect("shutdown fixture");
    }

    #[test]
    fn package_projection_uses_directory_identity_and_existing_authorities() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            temp.path().join("manifest.json"),
            serde_json::json!({
                "id": "drifted-manifest-id",
                "name": "Portfolio",
                "description": { "short": "Read portfolio data" },
                "server": { "command": "portfolio-server" },
                "skills": ["portfolio-method"],
                "resources": [
                    "ctrl://local/note/daily/today.md",
                    "ctrl://local/note/daily/today.md"
                ]
            })
            .to_string(),
        )
        .expect("manifest");
        let skills = BTreeMap::from([(
            "portfolio-method".to_owned(),
            LocalSkill {
                name: "portfolio-method".to_owned(),
                description: Some("Method".to_owned()),
                path: temp.path().join("SKILL.md").to_string_lossy().to_string(),
            },
        )]);

        let projection = read_package_projection(
            temp.path(),
            "directory-authority",
            &skills,
            vec!["directory-authority_quote".to_owned()],
        );

        assert_eq!(projection.item.r#ref, "pack:directory-authority");
        assert_eq!(projection.item.selection_kind, "selectable");
        assert_eq!(projection.skill_id.as_deref(), Some("portfolio-method"));
        assert_eq!(projection.resources.len(), 1);
        assert_eq!(projection.tools, ["directory-authority_quote"]);
        assert_eq!(projection.install_ref, "pack:directory-authority");
    }
}
