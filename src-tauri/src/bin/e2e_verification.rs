// e2e_verification.rs — H-2026-06-09-001 end-to-end verification
//
// This script verifies the dual-peer opencode + Hermes architecture.
// Run with: cargo run --bin e2e_verification

use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== H-2026-06-09-001 End-to-End Verification ===\n");

    // Check 1: Verify opencode is installed
    println!("Check 1: opencode binary on PATH");
    let opencode_path = find_binary("opencode");
    match opencode_path {
        Some(path) => println!("  ✓ opencode found at: {:?}", path),
        None => {
            println!("  ✗ opencode NOT found");
            println!("  Install with: npm install -g @opencode-ai/opencode");
            std::process::exit(1);
        }
    }

    // Check 2: Verify Hermes is installed
    println!("\nCheck 2: Hermes binary on PATH");
    let hermes_path = find_binary("hermes");
    match hermes_path {
        Some(path) => println!("  ✓ hermes found at: {:?}", path),
        None => {
            println!("  ✗ hermes NOT found");
            println!("  Install with: npm install -g @hermes-ai/hermes");
            std::process::exit(1);
        }
    }

    // Check 3: Verify kernel modules compile
    println!("\nCheck 3: Kernel compilation");
    let compile_result = std::process::Command::new("cargo")
        .args(["check", "--manifest-path", "src-tauri/Cargo.toml"])
        .output()?;
    if compile_result.status.success() {
        println!("  ✓ Kernel compilation passed");
    } else {
        println!("  ✗ Kernel compilation failed");
        println!("  stderr: {}", String::from_utf8_lossy(&compile_result.stderr));
        std::process::exit(1);
    }

    // Check 4: Verify PWA compiles
    println!("\nCheck 4: PWA TypeScript compilation");
    let compile_result = std::process::Command::new("npm")
        .args(["run", "--silent", "typecheck"])
        .current_dir("packages/ctrl-web")
        .output()?;
    if compile_result.status.success() {
        println!("  ✓ PWA TypeScript compilation passed");
    } else {
        println!("  ✗ PWA TypeScript compilation failed");
        println!("  stderr: {}", String::from_utf8_lossy(&compile_result.stderr));
        std::process::exit(1);
    }

    // Check 5: Verify kernel modules exist
    println!("\nCheck 5: Kernel source files");
    let required_files = vec![
        "src-tauri/src/shell/opencode_supervisor.rs",
        "src-tauri/src/shell/hermes_supervisor.rs",
        "src-tauri/src/commands/opencode_chat.rs",
        "src-tauri/src/commands/hermes_chat.rs",
    ];
    for file in required_files {
        if PathBuf::from(file).exists() {
            println!("  ✓ {}", file);
        } else {
            println!("  ✗ {} NOT found", file);
            std::process::exit(1);
        }
    }

    // Check 6: Verify PWA routes exist
    println!("\nCheck 6: PWA route files");
    let required_routes = vec![
        "packages/ctrl-web/src/routes/coding.tsx",
        "packages/ctrl-web/src/routes/assistant.tsx",
    ];
    for file in required_routes {
        if PathBuf::from(file).exists() {
            println!("  ✓ {}", file);
        } else {
            println!("  ✗ {} NOT found", file);
            std::process::exit(1);
        }
    }

    // Check 7: Verify Tauri commands are registered
    println!("\nCheck 7: Tauri command registration");
    let mod_rs_content = std::fs::read_to_string("src-tauri/src/commands/mod.rs")?;
    if mod_rs_content.contains("opencode_chat_stream") {
        println!("  ✓ opencode_chat_stream registered");
    } else {
        println!("  ✗ opencode_chat_stream NOT registered");
        std::process::exit(1);
    }
    if mod_rs_content.contains("hermes_chat_stream") {
        println!("  ✓ hermes_chat_stream registered");
    } else {
        println!("  ✗ hermes_chat_stream NOT registered");
        std::process::exit(1);
    }

    // Check 8: Verify PWA routes are registered
    println!("\nCheck 8: PWA route registration");
    let app_tsx_content = std::fs::read_to_string("packages/ctrl-web/src/App.tsx")?;
    if app_tsx_content.contains("path: '/coding'") {
        println!("  ✓ /coding route registered");
    } else {
        println!("  ✗ /coding route NOT registered");
        std::process::exit(1);
    }
    if app_tsx_content.contains("path: '/assistant'") {
        println!("  ✓ /assistant route registered");
    } else {
        println!("  ✗ /assistant route NOT registered");
        std::process::exit(1);
    }

    // Check 9: Verify L1 chips exist
    println!("\nCheck 9: PrimaryRail L1 chips");
    let primary_rail_content = std::fs::read_to_string("packages/ctrl-web/src/components/PrimaryRail.tsx")?;
    if primary_rail_content.contains("CODING_ITEM_ID") {
        println!("  ✓ Coding chip exists");
    } else {
        println!("  ✗ Coding chip NOT found");
        std::process::exit(1);
    }
    if primary_rail_content.contains("ASSISTANT_ITEM_ID") {
        println!("  ✓ Assistant chip exists");
    } else {
        println!("  ✗ Assistant chip NOT found");
        std::process::exit(1);
    }

    // Check 10: Verify lifecycle.rs starts supervisors
    println!("\nCheck 10: Lifecycle supervisor startup");
    let lifecycle_content = std::fs::read_to_string("src-tauri/src/shell/lifecycle.rs")?;
    if lifecycle_content.contains("OpencodeSupervisor::start") {
        println!("  ✓ OpencodeSupervisor started in lifecycle");
    } else {
        println!("  ✗ OpencodeSupervisor NOT started in lifecycle");
        std::process::exit(1);
    }
    if lifecycle_content.contains("HermesSupervisor::start") {
        println!("  ✓ HermesSupervisor started in lifecycle");
    } else {
        println!("  ✗ HermesSupervisor NOT started in lifecycle");
        std::process::exit(1);
    }

    // Check 11: Verify ADR amendments exist
    println!("\nCheck 11: ADR amendment document");
    if PathBuf::from(".olym/handoffs/H-2026-06-09-001-ADR-amendments.md").exists() {
        println!("  ✓ ADR amendments documented");
    } else {
        println!("  ✗ ADR amendments NOT documented");
        std::process::exit(1);
    }

    // Summary
    println!("\n=== All checks passed! ===");
    println!("\nNext steps:");
    println!("  1. Build and run the app: npm run tauri dev");
    println!("  2. Verify Coding tab works (opencode chat)");
    println!("  3. Verify Assistant tab works (Hermes chat)");
    println!("  4. Get bao approval for ADR amendments");
    println!("  5. Update ADR-001 spine.md (v2 → v3)");
    println!("  6. Update ADR-002 substrate.md (v11 → v12)");

    Ok(())
}

/// Find a binary on PATH (mirrors opencode_supervisor.rs::find_opencode).
fn find_binary(name: &str) -> Option<PathBuf> {
    // Check PATH first
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let binary = PathBuf::from(dir).join(name);
            if binary.exists() {
                return Some(binary);
            }
        }
    }

    // Check common global install dirs
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let common_dirs = vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from(home).join(".npm-global/bin"),
    ];

    for dir in common_dirs {
        let binary = dir.join(name);
        if binary.exists() {
            return Some(binary);
        }
    }

    None
}