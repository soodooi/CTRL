// KeychainSecretStore — wraps the keyring crate, which uses macOS Keychain on Mac.
// Each secret is keyed by ("app.ctrl.spike", <key>). On dev re-signs the entry survives
// because the bundle id is stable under `tauri dev`.

use keyring::Entry;

use crate::application::ports::SecretStorePort;
use crate::error::{Result, SpikeError};

const SERVICE: &str = "app.ctrl.spike";

pub struct KeychainSecretStore;

impl KeychainSecretStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for KeychainSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStorePort for KeychainSecretStore {
    fn read(&self, key: &str) -> Result<Option<String>> {
        let entry = Entry::new(SERVICE, key)
            .map_err(|e| SpikeError::ManifestError(format!("keychain entry: {}", e)))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SpikeError::ManifestError(format!(
                "keychain read {}: {}",
                key, e
            ))),
        }
    }

    fn write(&self, key: &str, value: &str) -> Result<()> {
        let entry = Entry::new(SERVICE, key)
            .map_err(|e| SpikeError::ManifestError(format!("keychain entry: {}", e)))?;
        entry
            .set_password(value)
            .map_err(|e| SpikeError::ManifestError(format!("keychain write {}: {}", key, e)))?;
        tracing::info!(key, "keychain secret stored");
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<()> {
        let entry = Entry::new(SERVICE, key)
            .map_err(|e| SpikeError::ManifestError(format!("keychain entry: {}", e)))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SpikeError::ManifestError(format!(
                "keychain delete {}: {}",
                key, e
            ))),
        }
    }
}
