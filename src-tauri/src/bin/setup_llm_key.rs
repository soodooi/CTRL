// One-shot CLI: store an LLM provider's API key in the macOS Keychain via the keyring
// crate (so it matches the ACL the runtime read path expects).
//
// Usage:
//   cargo run --manifest-path src-tauri/Cargo.toml --bin setup_llm_key -- <profile> <key>
//   cargo run ... --bin setup_llm_key -- minimax sk-cp-...
//
// This sidesteps the well-known incompatibility between `security add-generic-password`
// (which produces an item only readable by apps explicitly listed in the ACL) and the
// keyring crate's modern SecItemCopyMatching read path.

use std::process::ExitCode;

const SERVICE: &str = "app.ctrl.spike";

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let profile = match args.next() {
        Some(s) if !s.is_empty() => s,
        _ => {
            eprintln!("usage: setup_llm_key <profile> <api_key>");
            return ExitCode::from(2);
        }
    };
    let key = match args.next() {
        Some(s) if !s.is_empty() => s,
        _ => {
            eprintln!("usage: setup_llm_key <profile> <api_key>");
            return ExitCode::from(2);
        }
    };

    let entry = match keyring::Entry::new(SERVICE, &profile) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("✗ keyring entry creation failed: {}", e);
            return ExitCode::from(1);
        }
    };
    if let Err(e) = entry.set_password(&key) {
        eprintln!("✗ keyring write failed: {}", e);
        return ExitCode::from(1);
    }

    // Read-back verification (without printing the value).
    match entry.get_password() {
        Ok(_) => {
            println!(
                "✓ stored & verified · service={} account={}",
                SERVICE, profile
            );
            ExitCode::from(0)
        }
        Err(e) => {
            eprintln!("✗ readback failed (write succeeded but read errored): {}", e);
            ExitCode::from(1)
        }
    }
}
