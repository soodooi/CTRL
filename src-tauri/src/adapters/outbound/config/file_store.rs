// FileConfigStore — persists LlmSettings to a JSON file under the user's app config dir.

use std::fs;
use std::path::PathBuf;

use directories::ProjectDirs;

use crate::application::ports::{ConfigStorePort, LlmSettings};
use crate::error::{Result, SpikeError};

const QUALIFIER: &str = "app";
const ORG: &str = "CTRL App Lab";
const APP: &str = "CTRL";

pub struct FileConfigStore {
    path: PathBuf,
}

impl FileConfigStore {
    pub fn new() -> Result<Self> {
        let dirs = ProjectDirs::from(QUALIFIER, ORG, APP).ok_or_else(|| {
            SpikeError::ManifestError("could not resolve user config dir (HOME unset?)".into())
        })?;
        let dir = dirs.config_dir().to_path_buf();
        fs::create_dir_all(&dir).map_err(|e| {
            SpikeError::ManifestError(format!("create config dir {:?}: {}", dir, e))
        })?;
        Ok(Self {
            path: dir.join("settings.json"),
        })
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct SettingsFile {
    #[serde(default)]
    llm: LlmSettings,
}

impl ConfigStorePort for FileConfigStore {
    fn load_llm_settings(&self) -> Result<LlmSettings> {
        if !self.path.exists() {
            return Ok(LlmSettings::default());
        }
        let text = fs::read_to_string(&self.path).map_err(|e| {
            SpikeError::ManifestError(format!("read settings.json: {}", e))
        })?;
        let parsed: SettingsFile = serde_json::from_str(&text).map_err(|e| {
            SpikeError::ManifestError(format!("parse settings.json: {}", e))
        })?;
        Ok(parsed.llm)
    }

    fn save_llm_settings(&self, settings: &LlmSettings) -> Result<()> {
        let file = SettingsFile {
            llm: settings.clone(),
        };
        let json = serde_json::to_string_pretty(&file).map_err(|e| {
            SpikeError::ManifestError(format!("serialize settings: {}", e))
        })?;
        // Atomic write: write to .tmp then rename.
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| {
            SpikeError::ManifestError(format!("write tmp settings: {}", e))
        })?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            SpikeError::ManifestError(format!("rename tmp settings: {}", e))
        })?;
        tracing::info!(path = %self.path.display(), "settings.json saved");
        Ok(())
    }
}
