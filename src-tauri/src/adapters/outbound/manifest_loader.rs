// Loads tool manifests from a directory (one subdir per tool, each containing manifest.json).
// Implements ToolRegistryPort by holding the loaded set in memory.

use std::fs;
use std::path::{Path, PathBuf};

use crate::application::ports::ToolRegistryPort;
use crate::domain::tool::Tool;
use crate::error::{Result, SpikeError};

pub struct InMemoryToolRegistry {
    tools: Vec<Tool>,
}

impl InMemoryToolRegistry {
    pub fn from_builtin_dir(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        let mut tools = Vec::new();

        let entries = fs::read_dir(&root).map_err(|e| {
            SpikeError::ManifestError(format!("read modules dir {:?}: {}", root, e))
        })?;

        for entry in entries.flatten() {
            let manifest_path = entry.path().join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }
            match Self::load_one(&manifest_path) {
                Ok(tool) => {
                    tracing::info!(id = %tool.id, name = %tool.name, "tool loaded");
                    tools.push(tool);
                }
                Err(err) => {
                    tracing::warn!(?err, ?manifest_path, "failed to load manifest");
                }
            }
        }

        Ok(Self { tools })
    }

    pub fn empty() -> Self {
        Self { tools: Vec::new() }
    }

    fn load_one(path: &Path) -> Result<Tool> {
        let text = fs::read_to_string(path)
            .map_err(|e| SpikeError::ManifestError(format!("read {:?}: {}", path, e)))?;
        serde_json::from_str::<Tool>(&text)
            .map_err(|e| SpikeError::ManifestError(format!("parse {:?}: {}", path, e)))
    }
}

impl ToolRegistryPort for InMemoryToolRegistry {
    fn list_all(&self) -> Result<Vec<Tool>> {
        Ok(self.tools.clone())
    }
}
