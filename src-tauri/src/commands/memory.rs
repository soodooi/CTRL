// AI memory commands — event log read / append / query.
//
// Backed by `crate::kernel::persistence::EventStore`. PWA uses these to
// render conversation history, time-travel debugging, and cross-keycap
// context.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct LogEntry {
    pub id: String,
    pub ts_ms: u64,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct ReadLogArgs {
    pub since_ms: Option<u64>,
    pub limit: Option<u32>,
}

#[tauri::command]
pub async fn read_log(_args: ReadLogArgs) -> Result<Vec<LogEntry>, String> {
    // sub-PR c: kernel::persistence::EventStore::query.
    Ok(Vec::new())
}

#[derive(Debug, Deserialize)]
pub struct AppendEventArgs {
    pub kind: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub async fn append_event(args: AppendEventArgs) -> Result<String, String> {
    // sub-PR c: kernel::persistence::EventStore::append.
    Err(format!("append_event not implemented (kind={})", args.kind))
}

#[derive(Debug, Deserialize)]
pub struct QueryArgs {
    pub text: String,
    pub k: Option<u32>,
}

#[tauri::command]
pub async fn query(args: QueryArgs) -> Result<Vec<LogEntry>, String> {
    // sub-PR c: vector search over event store (P3.9 hardening adds indexing).
    let _ = args;
    Ok(Vec::new())
}
