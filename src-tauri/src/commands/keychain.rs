// Keychain commands — BYOK API key store / get / delete.
//
// Wraps `crate::shell::KeychainStore`. The PWA never sees the raw secret on
// disk; even when returning from `get_key`, the value crosses the IPC bridge
// only in-memory and the PWA should hand it directly to its LLM client.

use crate::shell::KeychainStore;

#[tauri::command]
pub async fn store_key(account: String, value: String) -> Result<(), String> {
    KeychainStore::store(&account, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_key(account: String) -> Result<Option<String>, String> {
    KeychainStore::get(&account).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_key(account: String) -> Result<(), String> {
    KeychainStore::delete(&account).map_err(|e| e.to_string())
}
