//! Canonical Project Resource owner.
//!
//! An explicitly selected workspace is registered at the Tauri boundary. The
//! model receives only a stable opaque ResourceRef; the absolute path remains
//! in a kernel-local mapping and is never descriptor/query output.
//! (ADR-002 substrate §15 v83; ADR-005 irisy §11 v40)

use super::resource::{
    PresentationHints, ProduceOperationDescriptor, QueryContract, ResourceAccessContext,
    ResourceAuthority, ResourceDegradation, ResourceDescriptor, ResourceError, ResourceFreshness,
    ResourceOwner, ResourceRef, ResourceUnavailableReason,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Mutex, OnceLock},
};

static REGISTRATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectRecord {
    path: PathBuf,
    title: String,
}

#[derive(Default, Serialize, Deserialize)]
struct ProjectMap {
    projects: BTreeMap<String, ProjectRecord>,
}

pub struct ProjectResourceOwner {
    map_path: Option<PathBuf>,
}

impl ProjectResourceOwner {
    pub fn from_default_store() -> Self {
        Self {
            map_path: default_map_path(),
        }
    }

    #[cfg(test)]
    fn from_map_path(map_path: PathBuf) -> Self {
        Self {
            map_path: Some(map_path),
        }
    }

    fn record(&self, resource: &ResourceRef) -> Result<ProjectRecord, ResourceError> {
        if resource.authority() != ResourceAuthority::Local
            || resource.kind() != "project"
            || resource.id_segments().len() != 1
        {
            return Err(ResourceError::OwnerNotFound);
        }
        let id = &resource.id_segments()[0];
        let map_path = self.map_path.as_deref().ok_or(ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })?;
        let map = read_map(map_path).map_err(|_| ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: true,
        })?;
        let record = map
            .projects
            .get(id)
            .cloned()
            .ok_or(ResourceError::OwnerNotFound)?;
        if !record.path.is_dir() {
            return Err(ResourceError::OwnerNotFound);
        }
        Ok(record)
    }
}

#[async_trait]
impl ResourceOwner for ProjectResourceOwner {
    async fn describe(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
    ) -> Result<ResourceDescriptor, ResourceError> {
        authorize_context(context)?;
        let record = self.record(resource)?;
        Ok(ResourceDescriptor {
            protocol_version: "1.0.0".to_owned(),
            resource: resource.clone(),
            content_type: "application/vnd.ctrl.project+json".to_owned(),
            provenance: Vec::new(),
            freshness: ResourceFreshness {
                observed_at: None,
                revision: None,
                stale: false,
            },
            degradation: None::<ResourceDegradation>,
            presentation: PresentationHints {
                viewer: None,
                title: Some(record.title),
                preferred_columns: Vec::new(),
            },
            query: QueryContract {
                request_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "additionalProperties": false
                }),
                result_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "required": ["resource", "content_type", "title"],
                    "properties": {
                        "resource": { "type": "string" },
                        "content_type": { "const": "application/vnd.ctrl.project+json" },
                        "title": { "type": "string" }
                    },
                    "additionalProperties": false
                }),
                watchable: false,
            },
            produce: Vec::<ProduceOperationDescriptor>::new(),
        })
    }

    async fn query(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, ResourceError> {
        authorize_context(context)?;
        let record = self.record(resource)?;
        Ok(json!({
            "resource": resource,
            "content_type": "application/vnd.ctrl.project+json",
            "title": record.title
        }))
    }
}

pub fn register_authorized_project(path: &Path) -> Result<ResourceRef, String> {
    let map_path =
        default_map_path().ok_or_else(|| "Project resource store is unavailable".to_owned())?;
    register_at(path, &map_path)
}

fn register_at(path: &Path, map_path: &Path) -> Result<ResourceRef, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "Project workspace is unavailable".to_owned())?;
    if !canonical.is_dir() {
        return Err("Project workspace must be a directory".to_owned());
    }
    let identity = canonical.to_string_lossy();
    let digest = format!("{:x}", Sha256::digest(identity.as_bytes()));
    let id = digest[..32].to_owned();
    let title = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Project")
        .to_owned();

    let _guard = REGISTRATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Project resource store is unavailable".to_owned())?;
    let mut map = read_map(map_path)?;
    map.projects.insert(
        id.clone(),
        ProjectRecord {
            path: canonical,
            title,
        },
    );
    write_map(map_path, &map)?;
    ResourceRef::from_str(&format!("ctrl://local/project/{id}"))
        .map_err(|_| "Failed to create Project ResourceRef".to_owned())
}

fn default_map_path() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|base| {
        base.home_dir()
            .join(".ctrl")
            .join("state")
            .join("project-resources.json")
    })
}

fn read_map(path: &Path) -> Result<ProjectMap, String> {
    if !path.exists() {
        return Ok(ProjectMap::default());
    }
    let body = std::fs::read_to_string(path)
        .map_err(|_| "Project resource store is unavailable".to_owned())?;
    serde_json::from_str(&body).map_err(|_| "Project resource store is malformed".to_owned())
}

fn write_map(path: &Path, map: &ProjectMap) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Project resource store is unavailable".to_owned())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "Project resource store is unavailable".to_owned())?;
    let temporary = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(map)
        .map_err(|_| "Project resource store is unavailable".to_owned())?;
    std::fs::write(&temporary, body)
        .map_err(|_| "Project resource store is unavailable".to_owned())?;
    std::fs::rename(&temporary, path)
        .map_err(|_| "Project resource store is unavailable".to_owned())
}

fn authorize_context(context: &ResourceAccessContext) -> Result<(), ResourceError> {
    if context
        .capability_scope
        .iter()
        .any(|scope| matches!(scope.as_str(), "*" | "project"))
    {
        Ok(())
    } else {
        Err(ResourceError::Denied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["project".to_owned()],
        }
    }

    fn scoped(scopes: &[&str]) -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: scopes.iter().map(|scope| (*scope).to_owned()).collect(),
        }
    }

    /// `project` is consumed owner-side rather than by tool classification, so
    /// this owner IS its enforcement point. Without this evidence the domain is
    /// only declared. (ADR-002 substrate §17.6 v86)
    #[tokio::test]
    async fn the_project_domain_is_enforced_by_this_owner() {
        let temp = tempfile::TempDir::new().expect("tempdir");
        let project = temp.path().join("Scoped Project");
        std::fs::create_dir(&project).expect("project dir");
        let map_path = temp.path().join("project-resources.json");
        let resource = register_at(&project, &map_path).expect("register project");
        let owner = ProjectResourceOwner::from_map_path(map_path);

        // Granted: the exact domain, or the unscoped wildcard.
        owner
            .describe(&scoped(&["project"]), &resource)
            .await
            .expect("an explicit project grant is admitted");
        owner
            .query(&scoped(&["*"]), &resource, json!({}))
            .await
            .expect("an unscoped caller is admitted");

        // Denied: a caller with other domains, or none at all. A neighbouring
        // grant must not leak into Project access.
        for scopes in [vec!["notes", "vault"], vec!["system"], vec![]] {
            assert!(
                matches!(
                    owner.describe(&scoped(&scopes), &resource).await,
                    Err(ResourceError::Denied)
                ),
                "describe must deny scope {scopes:?}"
            );
            assert!(
                matches!(
                    owner.query(&scoped(&scopes), &resource, json!({})).await,
                    Err(ResourceError::Denied)
                ),
                "query must deny scope {scopes:?}"
            );
        }
    }

    #[tokio::test]
    async fn registration_returns_opaque_ref_and_owner_never_exposes_path() {
        let temp = tempfile::TempDir::new().expect("tempdir");
        let project = temp.path().join("Private Project");
        std::fs::create_dir(&project).expect("project dir");
        let map_path = temp.path().join("project-resources.json");
        let resource = register_at(&project, &map_path).expect("register project");
        let rendered = resource.to_string();
        assert!(rendered.starts_with("ctrl://local/project/"));
        assert!(!rendered.contains("Private"));
        assert!(!rendered.contains(&temp.path().to_string_lossy().to_string()));

        let owner = ProjectResourceOwner::from_map_path(map_path);
        let descriptor = owner
            .describe(&context(), &resource)
            .await
            .expect("describe");
        let result = owner
            .query(&context(), &resource, json!({}))
            .await
            .expect("query");
        assert_eq!(
            descriptor.presentation.title.as_deref(),
            Some("Private Project")
        );
        assert!(!serde_json::to_string(&descriptor)
            .unwrap()
            .contains(&temp.path().to_string_lossy().to_string()));
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains(&temp.path().to_string_lossy().to_string()));
    }

    #[tokio::test]
    async fn owner_rejects_non_local_project_refs() {
        let temp = tempfile::TempDir::new().expect("tempdir");
        let project = temp.path().join("Project");
        std::fs::create_dir(&project).expect("project dir");
        let map_path = temp.path().join("project-resources.json");
        let resource = register_at(&project, &map_path).expect("register project");
        let foreign = ResourceRef::from_str(
            &resource
                .to_string()
                .replace("ctrl://local/project/", "ctrl://app/project/"),
        )
        .expect("foreign ref");

        let owner = ProjectResourceOwner::from_map_path(map_path);
        assert!(matches!(
            owner.describe(&context(), &foreign).await,
            Err(ResourceError::OwnerNotFound)
        ));
    }

    #[test]
    fn registration_preserves_a_malformed_authority_map() {
        let temp = tempfile::TempDir::new().expect("tempdir");
        let project = temp.path().join("Project");
        std::fs::create_dir(&project).expect("project dir");
        let map_path = temp.path().join("project-resources.json");
        std::fs::write(&map_path, "{ malformed").expect("malformed map");

        assert_eq!(
            register_at(&project, &map_path),
            Err("Project resource store is malformed".to_owned())
        );
        assert_eq!(
            std::fs::read_to_string(map_path).expect("preserved map"),
            "{ malformed"
        );
    }
}
