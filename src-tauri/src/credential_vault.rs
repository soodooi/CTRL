// Credential vault for brain API keys (opencode, Hermes).
//
// Uses the keyring crate (cross-platform: macOS Keychain, Windows Credential Manager,
// Linux Secret Service) to store and retrieve API keys.
//
// H-2026-06-09-001 — dual-brain architecture credential integration.

use keyring::Entry;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CredentialError {
    #[error("Keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Credential not found")]
    NotFound,
    #[error("Invalid credential format")]
    InvalidFormat,
}

const SERVICE_NAME: &str = "ctrl.brain";

/// Set opencode API key in keychain
pub fn set_opencode_credential(api_key: &str) -> Result<(), CredentialError> {
    let entry = Entry::new(SERVICE_NAME, "opencode")?;
    entry.set_password(api_key)?;
    Ok(())
}

/// Get opencode API key from keychain
pub fn get_opencode_credential() -> Result<String, CredentialError> {
    let entry = Entry::new(SERVICE_NAME, "opencode")?;
    match entry.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => Err(CredentialError::NotFound),
        Err(e) => Err(CredentialError::Keyring(e)),
    }
}

/// Set Hermes API key in keychain
pub fn set_hermes_credential(api_key: &str) -> Result<(), CredentialError> {
    let entry = Entry::new(SERVICE_NAME, "hermes")?;
    entry.set_password(api_key)?;
    Ok(())
}

/// Get Hermes API key from keychain
pub fn get_hermes_credential() -> Result<String, CredentialError> {
    let entry = Entry::new(SERVICE_NAME, "hermes")?;
    match entry.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => Err(CredentialError::NotFound),
        Err(e) => Err(CredentialError::Keyring(e)),
    }
}

/// Delete opencode credential
pub fn delete_opencode_credential() -> Result<(), CredentialError> {
    let entry = Entry::new(SERVICE_NAME, "opencode")?;
    entry.delete_credential()?;
    Ok(())
}

/// Delete Hermes credential
pub fn delete_hermes_credential() -> Result<(), CredentialError> {
    let entry = Entry::new(SERVICE_NAME, "hermes")?;
    entry.delete_credential()?;
    Ok(())
}