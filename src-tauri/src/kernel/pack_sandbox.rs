// Feature-pack shell sandbox (ADR-001 spine §6 lock #1 + ADR-004 cap §1:28).
//
// ADR-004 §1: "v1 sandbox = OS-level (macOS sandbox-exec / Linux
// landlock+seccomp / Win AppContainer) with capability gates declared in
// manifest. Missing capability → syscall block." This module is the
// macOS arm of that lock — it was specified but never implemented, so a
// feature-pack `shell` step ran as a bare `sh -c` with full user
// privileges (the C1/C2/C4 hole the red-team surfaced).
//
// A feature pack is potentially-untrusted third-party code (ADR-002 §7.4
// commons / pack library). The threat model here is NOT "the local user
// account is compromised" (that is a declared residual risk, out of
// scope) — it is "an installed pack's shell body tries to exfiltrate or
// destroy data beyond what the pack legitimately needs". This profile
// confines that body to:
//
//   - NO network (outbound or inbound) — a pack reaches the network only
//     through the kernel `http_get`/`http_post` tools, which enforce the
//     manifest `capabilities.network.http.allowlist`. So `curl evil.com`
//     and "read secret from env, POST it out" both die at the syscall.
//   - NO filesystem WRITE except the pack's own dir + the OS temp dirs.
//     Reads stay open (the pack needs python/libs); since the network is
//     denied, anything it reads cannot leave the machine.
//
// This is defense-in-depth, not the only layer: the `:17873` gate still
// scopes which tools are visible/callable, and secrets still resolve
// kernel-side. The sandbox closes the gap *below* tool granularity — the
// shell body itself, which the gate can neither see nor stop.
//
// Linux/Windows arms (landlock+seccomp / AppContainer) are follow-up
// work; on those platforms `wrap()` currently logs a loud warning and
// runs unsandboxed rather than silently pretending isolation exists.

use std::path::Path;
use std::process::Command;

/// macOS Seatbelt (SBPL) profile: start from the system default, then
/// subtract network + non-scoped writes. `(allow default)` keeps dyld /
/// interpreter loading working; the later `deny`/`allow` rules override
/// it (last-match-wins in SBPL).
#[cfg(target_os = "macos")]
fn seatbelt_profile(pack_dir: &Path) -> String {
    // Writable scopes: the pack's own install dir + the OS temp dirs an
    // interpreter (python/node) legitimately needs. Everything else is
    // read-only.
    let pack = pack_dir.display();
    format!(
        r#"(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write*
    (subpath "{pack}")
    (subpath "/tmp")
    (subpath "/private/tmp")
    (subpath "/private/var/folders")
    (subpath "/var/folders")
    (literal "/dev/null")
    (literal "/dev/zero")
    (literal "/dev/random")
    (literal "/dev/urandom")
    (literal "/dev/stdout")
    (literal "/dev/stderr")
    (regex #"^/dev/tty"))
"#
    )
}

/// Wrap a shell command so it runs inside the OS sandbox. On macOS this
/// returns a `Command` that invokes `sandbox-exec -p <profile> sh -c
/// <command>`; on other platforms it returns the bare shell `Command`
/// after logging that the sandbox arm is not yet wired.
///
/// `pack_dir` is the pack's install root (`~/.ctrl/mcps/<id>`), used as
/// the single writable scope outside the OS temp dirs.
pub fn wrap_shell(command: &str, pack_dir: &Path) -> Command {
    #[cfg(target_os = "macos")]
    {
        let profile = seatbelt_profile(pack_dir);
        let mut cmd = Command::new("/usr/bin/sandbox-exec");
        cmd.arg("-p").arg(profile).args(["sh", "-c", command]);
        cmd
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = pack_dir;
        tracing::warn!(
            "pack_sandbox: Linux landlock+seccomp arm not yet wired \
             (ADR-004 §1) — running pack shell UNSANDBOXED"
        );
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command]);
        cmd
    }
    #[cfg(windows)]
    {
        let _ = pack_dir;
        tracing::warn!(
            "pack_sandbox: Windows AppContainer arm not yet wired \
             (ADR-004 §1) — running pack shell UNSANDBOXED"
        );
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", command]);
        cmd
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn run(command: &str, pack_dir: &Path) -> std::process::Output {
        wrap_shell(command, pack_dir).output().expect("spawn sandbox-exec")
    }

    #[test]
    fn allows_write_inside_pack_dir() {
        let dir = std::env::temp_dir().join("ctrl-sbx-pack-ok");
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("out.txt");
        let out = run(
            &format!("echo hello > {}", target.display()),
            &dir,
        );
        assert!(out.status.success(), "in-scope write should succeed: {out:?}");
        assert_eq!(std::fs::read_to_string(&target).unwrap().trim(), "hello");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn denies_write_outside_pack_dir() {
        let pack = std::env::temp_dir().join("ctrl-sbx-pack-scope");
        std::fs::create_dir_all(&pack).unwrap();
        // Try to write to HOME (outside the pack dir + temp) — must fail.
        let escape = PathBuf::from(std::env::var("HOME").unwrap())
            .join("ctrl-sbx-should-not-exist.txt");
        let out = run(&format!("echo pwned > {}", escape.display()), &pack);
        assert!(
            !out.status.success(),
            "out-of-scope write must be denied by the sandbox"
        );
        assert!(
            !escape.exists(),
            "sandbox let an out-of-scope write through: {escape:?}"
        );
        let _ = std::fs::remove_dir_all(&pack);
    }

    #[test]
    fn denies_network() {
        let pack = std::env::temp_dir().join("ctrl-sbx-pack-net");
        std::fs::create_dir_all(&pack).unwrap();
        // A TCP connect must be blocked. Use bash/dev-tcp-free approach:
        // nc may be absent, so probe with a tiny python connect if present,
        // else fall back to curl. Either way the sandbox should deny it.
        let out = run(
            "curl -s -m 3 http://example.com >/dev/null 2>&1; echo $?",
            &pack,
        );
        let code = String::from_utf8_lossy(&out.stdout);
        assert_ne!(
            code.trim(),
            "0",
            "network egress must be denied inside the sandbox (curl exited 0)"
        );
        let _ = std::fs::remove_dir_all(&pack);
    }
}
