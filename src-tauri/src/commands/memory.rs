// AI memory commands — event log read / append / query.
//
// Sub-PR d: smoke-wired to kernel handle. Real EventStore queries land in
// sub-PR e once the persistence schema is extended with the indexes that
// P3.9 hardening calls for.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::shell::KernelHandle;

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
pub async fn read_log(
    _args: ReadLogArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<Vec<LogEntry>, String> {
    // sub-PR e: kernel.event_store.query(since_ms, limit).
    Ok(Vec::new())
}

#[derive(Debug, Deserialize)]
pub struct AppendEventArgs {
    pub kind: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub async fn append_event(
    args: AppendEventArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<String, String> {
    // sub-PR e: kernel.event_store.append(kind, payload) -> event id.
    Ok(format!("evt-{}-{}", now_ms(), args.kind))
}

#[derive(Debug, Deserialize)]
pub struct QueryArgs {
    pub text: String,
    pub k: Option<u32>,
}

#[tauri::command]
pub async fn query(
    _args: QueryArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<Vec<LogEntry>, String> {
    // sub-PR e + P3.9 indexing: vector search over event store.
    Ok(Vec::new())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
