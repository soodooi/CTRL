// Dump the kernel MCP endpoint spec to vault/ctrl/mcp-schema.json.
//
// The authoritative endpoint spec for CTRL's :17873 gate is the MCP
// `tools/list` JSON Schema, NOT a hand-maintained or source-scraped copy
// (ADR-010 § endpoint-spec v6). This bin materializes it as a versioned
// artifact so the endpoint catalog generates FROM the schema.
//
// Usage:
//   cargo run --manifest-path src-tauri/Cargo.toml --bin dump_mcp_schema

use std::path::PathBuf;

fn main() {
    let spec = ctrl_lib::export_mcp_endpoint_spec();
    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent (repo root)")
        .join("vault/ctrl/mcp-schema.json");
    let json = serde_json::to_string_pretty(&spec).expect("serialize spec");
    std::fs::write(&out, json + "\n").expect("write mcp-schema.json");
    println!(
        "wrote {} ({} tools)",
        out.display(),
        spec["toolCount"]
    );
}
