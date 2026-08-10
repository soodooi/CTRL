// Dump the kernel MCP endpoint spec to vault/ctrl/mcp-schema.json.
//
// The authoritative endpoint spec for CTRL's :17873 gate is the MCP
// `tools/list` JSON Schema, NOT a hand-maintained or source-scraped copy
// (ADR-010 § endpoint-spec v6). This bin materializes it as a versioned
// artifact so the endpoint catalog generates FROM the schema.
//
// Usage:
//   cargo run --manifest-path src-tauri/Cargo.toml --bin dump_mcp_schema
//   cargo run --manifest-path src-tauri/Cargo.toml --bin dump_mcp_schema -- --check
// (ADR-010 communication § endpoint-spec v14)

use std::path::PathBuf;

fn main() {
    let spec = ctrl_lib::export_mcp_endpoint_spec();
    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent (repo root)")
        .join("vault/ctrl/mcp-schema.json");
    let json = serde_json::to_string_pretty(&spec).expect("serialize spec") + "\n";
    if std::env::args().any(|arg| arg == "--check") {
        let tracked = std::fs::read_to_string(&out).expect("read tracked mcp-schema.json");
        if tracked != json {
            eprintln!(
                "mcp-schema.json is stale; regenerate with cargo run --manifest-path src-tauri/Cargo.toml --bin dump_mcp_schema"
            );
            std::process::exit(1);
        }
        println!("mcp-schema.json: PASS ({} tools)", spec["toolCount"]);
        return;
    }
    std::fs::write(&out, json).expect("write mcp-schema.json");
    println!("wrote {} ({} tools)", out.display(), spec["toolCount"]);
}
