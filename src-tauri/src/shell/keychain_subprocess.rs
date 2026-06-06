// Keychain via subprocess `security` CLI.
//
// bao 2026-06-05 d: the `keyring` v3 crate with `apple-native` feature
// works in unsigned binaries (verified standalone probe round-trips
// macOS Keychain successfully) but in a Code-Signed CTRL.app without
// proper entitlements the SecItemAdd path returns OK from the API but
// the entry is never persisted to disk. Same-process reads moments
// later miss the entry. The CTRL log path:
//   config_set_provider_key ok provider=volc-byok        (write OK)
//   get_active_provider_details: no keychain entry        (read 1ms later FAILS)
// confirms write-then-immediate-read fails in the signed-app context.
//
// The `security` CLI bypasses this entirely — it uses the same
// Keychain Services framework but at the process level (not bound to
// the CTRL bundle's missing entitlements), so writes persist and
// later reads find them. Apple's `security(1)` tool has been stable
// since 10.0; this is a safe long-term substrate for credential I/O.
//
// All provider credential reads + writes now go through this module.
// Direct `keyring::Entry` usage in the provider subsystem is retired.

use std::process::Command;

const SERVICE: &str = "app.ctrl.spike";

/// Set a generic password under service=app.ctrl.spike account=<account>.
/// Updates the entry in place if it already exists (-U flag). Returns the
/// underlying error from the security tool on failure (e.g. user denied
/// keychain access, locked keychain).
pub fn set(account: &str, value: &str) -> Result<(), String> {
    if account.is_empty() {
        return Err("keychain set: account is empty".into());
    }
    if value.is_empty() {
        return Err("keychain set: value is empty (use delete to remove)".into());
    }
    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-s",
            SERVICE,
            "-a",
            account,
            "-w",
            value,
            "-U", // update if exists
        ])
        .output()
        .map_err(|e| format!("security add-generic-password spawn: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        Err(format!(
            "security add-generic-password failed (status {}): {}",
            output.status, stderr
        ))
    }
}

/// Same as `get` but with a caller-supplied service name. Used by the
/// kernel registry which historically searched both "app.ctrl" (primary)
/// and "app.ctrl.spike" (current) services for backward compat.
/// bao 2026-06-06 e fix.
pub fn get_for_service(service: &str, account: &str) -> Result<Option<String>, String> {
    if account.is_empty() {
        return Err("keychain get: account is empty".into());
    }
    let output = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .map_err(|e| format!("security find-generic-password spawn: {e}"))?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim_end().to_string();
        if value.is_empty() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("could not be found")
            || stderr.contains("specified item could not be found")
        {
            Ok(None)
        } else {
            Err(format!(
                "security find-generic-password failed (status {}): {}",
                output.status, stderr
            ))
        }
    }
}

/// Read a generic password value. Returns Ok(Some(value)) when entry
/// exists, Ok(None) when not present (the most common "user hasn't
/// configured this provider yet" case), Err on actual tool errors.
pub fn get(account: &str) -> Result<Option<String>, String> {
    if account.is_empty() {
        return Err("keychain get: account is empty".into());
    }
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            SERVICE,
            "-a",
            account,
            "-w", // print password value to stdout
        ])
        .output()
        .map_err(|e| format!("security find-generic-password spawn: {e}"))?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim_end().to_string();
        if value.is_empty() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // "could not be found" = entry not present = Ok(None)
        if stderr.contains("could not be found")
            || stderr.contains("specified item could not be found")
        {
            Ok(None)
        } else {
            Err(format!(
                "security find-generic-password failed (status {}): {}",
                output.status, stderr
            ))
        }
    }
}

/// Remove a generic password. Idempotent — succeeds when entry missing.
pub fn delete(account: &str) -> Result<(), String> {
    if account.is_empty() {
        return Err("keychain delete: account is empty".into());
    }
    let output = Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-s",
            SERVICE,
            "-a",
            account,
        ])
        .output()
        .map_err(|e| format!("security delete-generic-password spawn: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("could not be found")
        || stderr.contains("specified item could not be found")
    {
        // Idempotent: not-present is success for delete semantics.
        Ok(())
    } else {
        Err(format!(
            "security delete-generic-password failed (status {}): {}",
            output.status, stderr
        ))
    }
}
