// Kernel ACP client — drives hermes (the assistant brain) over the Agent
// Client Protocol (ADR-002 substrate §1.8). Newline-delimited JSON-RPC 2.0
// on stdio: initialize -> session/new -> session/prompt, streaming the
// agent_message_chunk text back to the caller via an on_delta callback.
//
// Design (§1.8.1 single door):
// - ONE persistent hermes-acp process + ONE ACP session, reused across turns
//   (held in the `singleton()` Mutex). Only the first prompt pays uvx/plugin
//   startup (~7s); later turns are warm.
// - Single-tasked: prompts serialize through the Mutex, and one read loop on
//   the calling task handles notifications + answers agent->client requests
//   inline, so no concurrent reader is needed (mirrors the JS probe).
// - Verified end-to-end by scripts/probes/hermes-acp-probe.mjs (2026-06-17).
//
// MCP-bus passthrough (§1.8.2): `session/new` passes CTRL's :17873 bus as the
// agent's MCP server (build_mcp_servers), so hermes reaches the FULL CTRL tool
// surface — Notes / clipboard / OCR / provider router (fal.ai image/video) /
// downstream MCP servers (via mcp.proxy_*; Obsidian connector retired, ADR-002
// §1.9 v46) / skills — through the single ACP door. This is how
// the functions ACP itself scopes out (messaging/cron) are supplied by CTRL's
// own layers instead of hermes's upgrade-fragile internal protocol.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

/// Per-line read budget — covers uvx cold start + first-token model latency.
const READ_TIMEOUT: Duration = Duration::from_secs(180);

pub struct AcpClient {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    session_id: String,
    next_id: i64,
    /// Whether the CTRL capability preamble has been sent this session (§1.8.2).
    primed: bool,
    /// Which Irisy engine this client drives — `hermes` | `codex` | `claude-code`
    /// (ADR-005 irisy §8.7). All speak ACP; only the spawn command differs. When
    /// the user switches engine the caller resets the singleton so it restarts
    /// with the chosen adapter.
    engine_id: String,
}

/// One-time capability brief prepended to the first turn so hermes KNOWS it can
/// drive CTRL's tools (the user's notes vault is reachable via the `ctrl` MCP
/// server passed in session/new; ADR-002 §1.9 v46 — notes are CTRL-native)
/// instead of answering from its own memory (ADR-002 substrate §1.8.2 v23).
/// Concise so it doesn't fight SOUL.md.
const CTRL_CAPABILITY_BRIEF: &str = "\
[CTRL context — you are Irisy, the user's personal assistant inside CTRL. Your \
CAPABILITIES ARE THE `ctrl` TOOLS connected to you (already wired): that ctrl \
tool list is the single source of truth for what you can do, and it is your \
PRIMARY toolset — prefer it over any built-in. Through ctrl you reach the user's \
OWN notes vault (the vault tools already point at the library the user configured), their structured tables, \
live market data, web search, and building new feature packs — their real data \
and work, on their machine. Built-in tools are a secondary aid (e.g. image \
generation, browsing) — use them only when the ctrl tools lack a capability, and \
never present them as your main repertoire. When asked what you can do, lead \
with what the ctrl tools give you (the user's notes, tables, market data, web \
search, building feature packs) — not a long list of built-ins — and never \
claim a capability the ctrl tools don't provide. When the user asks about their \
notes or knowledge, USE the vault tools — do not answer from memory alone. \
PROJECT COMPANION: the user's projects live under projects/<name>/ in the \
vault; CTRL itself is the FIRST companion project (projects/ctrl/vault = its \
strategy docs, projects/ctrl/decisions = its ADRs) — when asked about the CTRL \
project, its architecture or decisions, READ those files, never answer from \
memory. For note edits prefer the surgical tools over whole-file writes: \
note_map first (see real headings/frontmatter keys), then doc_produce \
(append/replace/delete_section by heading; set/delete_frontmatter_key). \
note_get reads a note WITH its links/backlinks in one call; note_periodic \
resolves today's daily / weekly / monthly note; note_recent_changes = what \
changed lately; note_history / note_diff / vault_pulse show WHO (user vs \
agents) changed what — cite them when asked what happened in the vault. \
For live market data use the market/stock tools on the gate (market_quote / \
market_screen for global tickers; a stocks feature pack adds richer domain \
tools when installed) — use them, never invent a quote or statistic. Domain \
playbooks (watchlist conventions, daily-review recipes) live in the relevant \
feature pack's knowledge base as skills — load them ON DEMAND via skill_list / \
skill_read when the task matches, not from this brief. \
You also have web_search(query) for facts / news / research you don't already \
hold — call it instead of guessing. It uses any BYOK keyed provider you have \
configured (Tavily / Brave / Serper / Exa) and otherwise a keyless full-web \
fallback (DuckDuckGo, then Wikipedia) — so YES, you CAN search the live web; \
never tell the user you cannot, and never call your research 'simulated'. When \
research is done, ANSWER IN THE CHAT BY DEFAULT. Ordinary questions and short \
findings stay conversational — do NOT produce an HTML file for them, and do NOT \
turn every research turn into a document. Build an HTML artifact ONLY when it \
clearly earns one: the user asks for a document / report / deck / dashboard / \
slides / something visual or saveable, OR the findings are substantial enough \
that the user will want to keep, scan, or revisit them (a multi-source report, a \
comparison, a structured guide). Never make the user name a format or repeat \
'presentation' to control this — infer it from the request and the result. When \
you DO build one, write it to the vault (Research/<topic>.html) and leave only a \
one-line pointer in the chat (it opens in the workspace — good-looking, \
editable, auto-saved; the dialog stays for conversation). Pick the skill by need \
(skills_list / skill_view): render-html for a simple report / long-page (static \
inline CSS) is the lighter default; frontend-slides-editable is ONLY for an \
actual slide deck or visual dashboard the user wants to present, never for plain \
findings. Either way the document must be FULLY self-contained — never load from \
a CDN, never inline a secret. \
You can also CREATE feature packs for the user — a feature pack is a tool that \
appears in their workbench and runs when triggered. CRITICAL: describing a pack \
in prose creates NOTHING. There is NO `add key`, `keycap`, or `create tool` \
function — never call or mention one. The ONLY way to create a pack is to \
actually INVOKE two real tools, in order: mcp_pack_install (pass a manifest), \
then mcp_pack_run (smoke one action). If you write text about what you 'will' or \
'would' create instead of CALLING these tools, you have created nothing and \
FAILED. When the user asks for a new tool / button / shortcut / connector / data \
tracker / \u{529F}\u{80FD}\u{5305}, do this — keep calling tools, do not narrate: \
(1) RESEARCH FIRST — first open a knowledge base for this pack: read any prior \
notes under its vault folder (e.g. Packs/<name>/) with the vault tools so you do \
not start cold, then call discover_packs (MCP Registry + Smithery), \
discover_skills, and web_search for the real source/API; never invent an \
endpoint. Write each candidate source you find back into that vault folder, and \
later declare it as the manifest's knowledge_base so the pack ships with its \
dossier. Keyless endpoints exist for most data — 'free data needs an API key' \
is almost always WRONG. For A-share quotes, Tencent is keyless: \
http://qt.gtimg.cn/q=sh600519,sz000001 . Screening (e.g. top gainers) = fetch a \
keyless market-wide list (research how akshare/efinance do it), then filter it in \
the shell step with jq/awk/python. \
(2) REPORT + CONFIRM what you found, which source you will use, and what the pack \
will do; if a source needs a key, ask for it (it goes to the keychain — you \
NEVER see its value). Wait for the user's go-ahead. \
(3) COMPOSE a manifest and INSTALL it by actually CALLING mcp_pack_install. A \
working manifest needs only a string `id` plus an `actions[]` array where each \
action has an `id` and a `steps[]` array; a shell step is \
{ \"type\": \"shell\", \"command\": \"...\" } and the action returns its stdout. \
Minimal copy-ready manifest — adapt the command, then CALL mcp_pack_install with \
it: { \"id\": \"a-share-quote\", \"name\": \"A-Share Quote\", \"actions\": [ \
{ \"id\": \"quote\", \"name\": \"Quote\", \"steps\": [ { \"type\": \"shell\", \
\"command\": \"curl -s 'http://qt.gtimg.cn/q=sh600519,sz000001'\" } ] } ] } . A \
comprehensive workbench is ONE pack with MULTIPLE actions (quote, screen, \
add-to-watchlist, log-trade), not many separate things; stateful lists \
(watchlist, trade log) are Markdown the action appends into the vault. For a \
secret, add config_schema.fields[] with a kind \"secret\" field and map it in \
provision.env as { \"VAR\": \"{{secret:key}}\" } — never inline a secret value. \
(4) SMOKE by CALLING mcp_pack_run on one action; a pack is NOT done until an \
action returns real green output (not lint-clean). If it errors, fix the \
manifest and CALL mcp_pack_install + mcp_pack_run again. \
(5) Only after a green run, tell the user in plain words what you made and the \
real result it produced (never say manifest / variant / schema). mcp_pack_list \
shows what is already installed; a deeper create-feature-pack skill exists \
(skills_list / skill_view) if you need more detail. \
Your long-term memory is the user's SOUL.md (ADR-005 irisy v5 §6.3): read it and \
persist durable facts THERE via the ctrl soul/memory tools, not in your own \
private store, so the chat and agent paths share one memory and never drift.]";

/// Process-wide persistent client. `None` until the first turn starts it;
/// reset to `None` on any error so the next turn restarts cleanly.
pub fn singleton() -> &'static Mutex<Option<AcpClient>> {
    static ACP: OnceLock<Mutex<Option<AcpClient>>> = OnceLock::new();
    ACP.get_or_init(|| Mutex::new(None))
}

/// Best-effort kill of the persistent hermes-acp process at app shutdown
/// (RunEvent::ExitRequested with an explicit code). try_lock so a turn in
/// flight never blocks exit; the OS reclaims the child either way.
pub fn shutdown() {
    if let Ok(mut g) = singleton().try_lock() {
        if let Some(mut c) = g.take() {
            let _ = c.child.start_kill();
        }
    }
}

fn notes_dir() -> Result<PathBuf> {
    // hermes's cwd = the user's REAL configured vault, NOT a hardcoded Notes dir
    // (bao 2026-06-29: pkm is the single default knowledge base — there is no
    // separate notes store; feature-pack-specific docs live in their own project
    // dir). Follow `configured_vault_root` so the engine's working directory never
    // drifts from where the vault tools actually read/write (root-fix for "Irisy
    // organized the wrong library").
    let p = crate::kernel::vault::configured_vault_root()
        .or_else(crate::kernel::vault::default_vault_root)
        .ok_or_else(|| anyhow!("vault root"))?;
    std::fs::create_dir_all(&p).context("create vault dir")?;
    Ok(p)
}

/// Irisy's engine soul, owned by CTRL (ADR-005 §9.5). hermes reads ~/.hermes/SOUL.md
/// as its persona every turn; that file was an ORPHAN runtime copy no code owned,
/// so it silently kept a stale "co-pilot" persona while the real soul lived
/// elsewhere. This seed is the single owner of the engine identity.
const HERMES_SOUL: &str = include_str!("hermes-soul.md");

/// Re-pin ~/.hermes/SOUL.md from the repo seed before every hermes launch
/// (ADR-005 §9.5 — close the orphan-soul drain). CTRL owns the engine IDENTITY;
/// the user's learned memory lives in hermes's own MEMORY.md / the vault, not in
/// this file, so overwriting identity is safe. Idempotent: only writes when the
/// content differs, to avoid needless IO / mtime churn.
fn ensure_hermes_soul() {
    let Some(base) = directories::BaseDirs::new() else {
        return;
    };
    let soul = base.home_dir().join(".hermes").join("SOUL.md");
    if std::fs::read_to_string(&soul).ok().as_deref() == Some(HERMES_SOUL) {
        return;
    }
    if let Some(dir) = soul.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&soul, HERMES_SOUL);
}

/// MCP-bus passthrough (ADR-002 §1.8.2): expose CTRL's kernel MCP server
/// (:17873, streamable-http + bearer) to hermes so the 3 faces (MCP / API /
/// Skills) reach the agent. Gated on the kernel having published its port +
/// token (set by kernel_supervisor); absent in unit tests -> no passthrough.
fn build_mcp_servers() -> Vec<Value> {
    let token = match std::env::var("CTRL_KERNEL_MCP_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => return Vec::new(),
    };
    let port = std::env::var("CTRL_KERNEL_MCP_PORT").unwrap_or_else(|_| "17873".to_string());
    vec![json!({
        "type": "http",
        "name": "ctrl",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        // Stamp the caller so the gate recognizes Irisy as first-party and
        // projects the broad first-party toolset (vault/smart_table/notes/...).
        // Without this header the gate normalizes the caller to "external" and
        // applies the minimal scope (system tools only — 2 tools), so Irisy
        // could not reach vault.* at all (ADR-010 communication § trust-domains
        // v3, SC3 — intent-scoped projection; default_for_caller("hermes")).
        "headers": [
            { "name": "Authorization", "value": format!("Bearer {token}") },
            { "name": "x-ctrl-caller", "value": "hermes" }
        ]
    })]
}

/// Pick an "allow" outcome for an ACP `session/request_permission` request by
/// scanning the offered `options` (ADR-002 substrate §1.8.2 v23 — single door):
/// prefer `allow_once`, then `allow_always`, then any non-`reject` option;
/// cancel only when no allow option is offered. Without this the client
/// cancelled every tool permission, so hermes could never execute a tool call —
/// notes were never saved, searches never ran (P-1/P-3/P-4). The :17873 gate is
/// the real permission/audit layer; this ACP prompt is hermes-side, approved
/// headlessly so the agent loop can actually do work.
fn select_allow_outcome(req: &Value) -> Value {
    let cancelled = json!({ "outcome": { "outcome": "cancelled" } });
    let Some(options) = req
        .get("params")
        .and_then(|p| p.get("options"))
        .and_then(|o| o.as_array())
    else {
        return cancelled;
    };
    let kind_of = |o: &Value| {
        o.get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("")
            .to_string()
    };
    let pick = options
        .iter()
        .find(|o| kind_of(o) == "allow_once")
        .or_else(|| options.iter().find(|o| kind_of(o) == "allow_always"))
        .or_else(|| options.iter().find(|o| !kind_of(o).starts_with("reject")));
    match pick
        .and_then(|o| o.get("optionId"))
        .and_then(|i| i.as_str())
    {
        Some(option_id) => {
            json!({ "outcome": { "outcome": "selected", "optionId": option_id } })
        }
        None => cancelled,
    }
}

/// Build the spawn argv for an Irisy engine (ADR-005 irisy §8.7). All three
/// engines speak ACP; only the launch command differs. hermes is the bundled
/// default (uvx, with the Python pin + `--with mcp` the adapter needs); Codex
/// and Claude Code are driven via their npm-distributed ACP adapters (npx
/// fetches on first use), which wrap the user's OWN installed CLI — the UI only
/// offers a BYO engine once `list_byo_drivers` has detected it.
fn engine_argv(engine: &str) -> Result<Vec<String>> {
    use crate::shell::agent_installer::{read_manifest, AgentName, HERMES_PYTHON};
    match engine {
        "" | "hermes" => {
            let manifest = read_manifest(&AgentName::Hermes)
                .ok_or_else(|| anyhow!("hermes not installed"))?;
            let mut argv = manifest.entry_cmd.clone();
            if argv.is_empty() {
                return Err(anyhow!("hermes manifest.entry_cmd empty"));
            }
            // Stale manifests lack the Python pin hermes-agent[acp] needs (>=3.11);
            // inject it so uvx fetches a managed CPython (see agent_installer).
            if argv[0].ends_with("uvx") && !argv.iter().any(|a| a == "--python") {
                argv.splice(1..1, ["--python".to_string(), HERMES_PYTHON.to_string()]);
            }
            // CRITICAL: `hermes-agent[acp]` does NOT depend on the `mcp` package, so
            // in the spawned environment hermes's `_MCP_AVAILABLE` is False and
            // `register_mcp_servers` SILENTLY returns [] — the CTRL gate we pass via
            // `session/new.mcpServers` never connects and the brain sees ZERO CTRL
            // tools. Inject `--with mcp>=1.24` so the ephemeral uvx env has the MCP
            // client SDK (streamable-http API, `_MCP_NEW_HTTP`). Verified end-to-end
            // 2026-06-28: without it register returns 0 tools; with it all 24 load.
            if argv[0].ends_with("uvx")
                && !argv.windows(2).any(|w| w[0] == "--with" && w[1].starts_with("mcp"))
            {
                argv.splice(1..1, ["--with".to_string(), "mcp>=1.24".to_string()]);
            }
            Ok(argv)
        }
        // npm-distributed ACP adapters wrapping the user's own CLI (verified on a
        // real machine 2026-06-29): codex moved to `@agentclientprotocol/codex-acp`
        // (the old `@zed-industries/codex-acp` is DEPRECATED and answers nothing on
        // stdio → silent hang); claude-code is still `@zed-industries/claude-code-acp`.
        "codex" => Ok(vec![
            "npx".to_string(),
            "-y".to_string(),
            "@agentclientprotocol/codex-acp".to_string(),
        ]),
        "claude-code" => Ok(vec![
            "npx".to_string(),
            "-y".to_string(),
            "@zed-industries/claude-code-acp".to_string(),
        ]),
        other => Err(anyhow!("unknown Irisy engine: {other}")),
    }
}

/// Resolve the actual CLI binary a BYO ACP adapter wraps (ADR-005 §8.8): CTRL's
/// one-click managed install (~/.ctrl/agents/<id>/node_modules/.bin/<bin>) first,
/// else the user's own on PATH. None when neither exists — the adapter then falls
/// back to its own discovery. This is what lets codex-acp find the codex CTRL
/// installed instead of hanging.
fn resolve_engine_binary(engine: &str) -> Option<PathBuf> {
    use crate::shell::agent_installer::{agent_dir, AgentName};
    let agent = match engine {
        "codex" => AgentName::Codex,
        "claude-code" => AgentName::ClaudeCode,
        _ => return None,
    };
    if let Ok(dir) = agent_dir(&agent) {
        let p = dir.join("node_modules").join(".bin").join(agent.bin_name());
        if p.exists() {
            return Some(p);
        }
    }
    crate::kernel::provider::path_resolver::resolve_binary_path(agent.bin_name())
}

impl AcpClient {
    /// Spawn the selected ACP engine, handshake (initialize), and open one ACP
    /// session. `engine` = `hermes` (default) | `codex` | `claude-code`
    /// (ADR-005 irisy §8.7). `provider_env` is the BYOK credential the engine
    /// should use (ADR-002 §1.3): for hermes the active Irisy provider (also
    /// mirrored into ~/.hermes/.env); for a BYO engine its canonical key
    /// (OPENAI_API_KEY / ANTHROPIC_API_KEY, via byo_engine_auth_env) — injected
    /// into the adapter subprocess env below so Codex / Claude reuse the key the
    /// user already configured in CTRL instead of a second sign-in (§8.8).
    pub async fn start(engine: &str, provider_env: &BTreeMap<String, String>) -> Result<Self> {
        let engine = if engine.is_empty() { "hermes" } else { engine };
        let argv = engine_argv(engine)?;

        // Mirror CTRL's active provider into ~/.hermes/.env BEFORE spawn —
        // hermes reads it at startup, not from process env (ADR-002 §1.3).
        // Merge, never clobber; no managed key -> file untouched. BYO adapters
        // read process env, so their key arrives via cmd.env below (§8.8), not
        // here.
        if engine == "hermes" {
            let _ = crate::commands::agents::write_hermes_dotenv(provider_env);
            ensure_hermes_soul();
        }

        let cwd = notes_dir()?;
        let mut cmd = Command::new(&argv[0]);
        cmd.args(&argv[1..]);
        for (k, v) in provider_env {
            cmd.env(k, v);
        }
        cmd.current_dir(&cwd);
        // BYO engines launch via npx and WRAP the user's own CLI binary. CTRL's
        // one-click install lands codex/claude under ~/.ctrl/agents (NOT on PATH),
        // so without this the adapter can't find the binary and hangs (ADR-005
        // §8.8 — the pending PATH-wiring item). Make discoverable: (a) the Node
        // runtime so `npx` resolves even where CTRL bootstrapped Node; (b) the
        // wrapped binary's dir on PATH; (c) for codex, CODEX_PATH points straight
        // at it (codex-acp honors it).
        if engine == "codex" || engine == "claude-code" {
            let mut extra: Vec<String> = Vec::new();
            if let Ok(node_bin) = crate::shell::agent_installer::ensure_node() {
                extra.push(node_bin.display().to_string());
            }
            if let Some(cli) = resolve_engine_binary(engine) {
                if let Some(dir) = cli.parent() {
                    extra.push(dir.display().to_string());
                }
                if engine == "codex" {
                    cmd.env("CODEX_PATH", &cli);
                }
            }
            if !extra.is_empty() {
                let sep = if cfg!(windows) { ";" } else { ":" };
                let existing = std::env::var("PATH").unwrap_or_default();
                cmd.env("PATH", format!("{}{}{}", extra.join(sep), sep, existing));
            }
        }
        // stdout = JSON-RPC wire (clean); stderr = adapter logs, drained to CTRL's
        // stderr below so the pipe can't fill AND startup failures (npx fetch,
        // "binary not found", auth prompts) are VISIBLE instead of a silent 180s
        // hang. kill_on_drop ties the child to this struct.
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn {engine} acp ({})", argv.join(" ")))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        // Drain stderr (ADR-005 §8.8): without this the piped buffer fills and the
        // adapter blocks; with it, the real reason a BYO engine stalls shows up.
        if let Some(errpipe) = child.stderr.take() {
            let eng = engine.to_string();
            tokio::spawn(async move {
                let mut lines = BufReader::new(errpipe).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    eprintln!("[acp:{eng}] {l}");
                }
            });
        }
        let mut s = AcpClient {
            child,
            stdin,
            reader: BufReader::new(stdout),
            session_id: String::new(),
            next_id: 0,
            primed: false,
            engine_id: engine.to_string(),
        };

        let mut noop = |_: &str| {};
        let init = s
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } }
                }),
                &mut noop,
            )
            .await
            .context("ACP initialize")?;

        // ACP authenticate (ADR-005 §8.8, verified vs codex-acp 1.0.1 2026-06-29):
        // some engines REQUIRE an explicit `authenticate` before `session/new` —
        // codex returns "Authentication required" otherwise. hermes advertises no
        // authMethods, so this is skipped for it (no regression). We prefer the
        // `api-key` method: codex-acp reads OPENAI_API_KEY (injected from the user's
        // CTRL provider via byo_engine_auth_env), so this is what lets "use our
        // OpenAI key, no second login" actually work. A failure here is logged but
        // not fatal — session/new returns the authoritative error, which the caller
        // surfaces (e.g. "configure an OpenAI key, or run codex login").
        if let Some(methods) = init.get("authMethods").and_then(|m| m.as_array()) {
            let method_id = methods
                .iter()
                .find_map(|m| m.get("id").and_then(|i| i.as_str()).filter(|id| *id == "api-key"))
                .or_else(|| methods.iter().find_map(|m| m.get("id").and_then(|i| i.as_str())));
            if let Some(mid) = method_id {
                let mid = mid.to_string();
                if let Err(e) = s
                    .request("authenticate", json!({ "methodId": mid }), &mut noop)
                    .await
                {
                    eprintln!("[acp:{engine}] authenticate({mid}) failed: {e}");
                }
            }
        }

        // §1.8.2: try with the MCP-bus passthrough; if hermes rejects the
        // entry (format / transport), retry WITHOUT it so the agent still runs
        // (worst case = no CTRL tools, never a disabled hermes).
        let mcp_servers = build_mcp_servers();
        let had_mcp = !mcp_servers.is_empty();
        let cwd_str = cwd.to_string_lossy().to_string();
        let ns = match s
            .request(
                "session/new",
                json!({ "cwd": cwd_str, "mcpServers": mcp_servers }),
                &mut noop,
            )
            .await
        {
            Ok(v) => v,
            Err(e) if had_mcp => {
                eprintln!("[acp] session/new with MCP passthrough failed ({e}); retrying without tools");
                s.request(
                    "session/new",
                    json!({ "cwd": cwd_str, "mcpServers": [] }),
                    &mut noop,
                )
                .await
                .context("ACP session/new")?
            }
            Err(e) => return Err(e.context("ACP session/new")),
        };
        s.session_id = ns
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("session/new returned no sessionId"))?
            .to_string();
        Ok(s)
    }

    /// Run one prompt turn; `on_delta` receives streamed text as it arrives.
    /// Returns the ACP stopReason.
    /// True while the hermes-acp child is still running. On a prompt error the
    /// caller uses this to decide whether the engine is recoverable (keep the
    /// session — the conversation context survives in it) or genuinely dead
    /// (reset + re-prime). ADR-005 irisy §8.3 — continuity is the ENGINE's; never
    /// drop a live session into amnesia just because one turn errored.
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Which Irisy engine this client drives (ADR-005 §8.7). The caller compares
    /// it to the selected engine and resets the singleton on a switch.
    pub fn engine(&self) -> &str {
        &self.engine_id
    }

    /// Run one prompt turn; `on_delta` receives streamed text as it arrives.
    /// `turns` is the conversation so far as `(role, content)` pairs (user /
    /// assistant, in order). The actual prompt = the last `user` turn; the
    /// earlier turns are used ONLY to re-hydrate a fresh session (§8.4).
    /// Returns the ACP stopReason.
    pub async fn prompt(
        &mut self,
        turns: &[(String, String)],
        system_preamble: Option<&str>,
        mut on_delta: impl FnMut(&str) + Send,
    ) -> Result<String> {
        let sid = self.session_id.clone();
        let last_user = turns
            .iter()
            .rev()
            .find(|(r, _)| r == "user")
            .map(|(_, c)| c.clone())
            .unwrap_or_default();
        // Prime the first turn of a session with CTRL's composed system prompt
        // (persona + capability catalog, ADR-005 v5 §6.2) THEN the capability
        // brief THEN — the §8.4 fix — a replay of the prior conversation so a
        // fresh / restarted engine session starts WITH context instead of blank
        // (the durable transcript is the recovery source; the live session is
        // the working context). While the SAME session continues, only the
        // latest user message is sent (the engine already holds the history).
        let turn_text = if self.primed {
            last_user
        } else {
            self.primed = true;
            let mut head = String::new();
            if let Some(sys) = system_preamble {
                let sys = sys.trim();
                if !sys.is_empty() {
                    head.push_str(sys);
                    head.push_str("\n\n");
                }
            }
            head.push_str(CTRL_CAPABILITY_BRIEF);
            // Replay everything before the final user message (§8.4).
            let last_idx = turns.iter().rposition(|(r, _)| r == "user");
            let prior = match last_idx {
                Some(i) => &turns[..i],
                None => &turns[..],
            };
            if !prior.is_empty() {
                head.push_str("\n\n[Conversation so far \u{2014} context only, continue it:]\n");
                for (role, content) in prior {
                    let who = if role == "user" { "User" } else { "Irisy" };
                    head.push_str(&format!("{who}: {}\n", content.trim()));
                }
            }
            format!("{head}\n\n{last_user}")
        };
        let res = self
            .request(
                "session/prompt",
                json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": turn_text }] }),
                &mut on_delta,
            )
            .await?;
        Ok(res
            .get("stopReason")
            .and_then(|v| v.as_str())
            .unwrap_or("end_turn")
            .to_string())
    }

    async fn write_msg(&mut self, v: &Value) -> Result<()> {
        let mut line = serde_json::to_string(v)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    /// Send a JSON-RPC request, then pump stdout until its response arrives,
    /// streaming agent_message_chunk text to `on_delta` and answering any
    /// agent->client requests (permission / fs) minimally so the turn never
    /// stalls.
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        on_delta: &mut (dyn FnMut(&str) + Send),
    ) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.write_msg(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;

        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(READ_TIMEOUT, self.reader.read_line(&mut line))
                .await
                .map_err(|_| anyhow!("hermes-acp read timed out"))??;
            if n == 0 {
                return Err(anyhow!("hermes-acp closed stdout"));
            }
            let line = line.trim();
            if !line.starts_with('{') {
                continue;
            }
            let v: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Response to our request?
            if v.get("id").and_then(|i| i.as_i64()) == Some(id)
                && (v.get("result").is_some() || v.get("error").is_some())
            {
                if let Some(err) = v.get("error") {
                    return Err(anyhow!("ACP error: {err}"));
                }
                return Ok(v.get("result").cloned().unwrap_or(Value::Null));
            }

            // session/update notification → stream chunk text.
            if v.get("method").and_then(|m| m.as_str()) == Some("session/update") {
                if let Some(u) = v.get("params").and_then(|p| p.get("update")) {
                    if u.get("sessionUpdate").and_then(|s| s.as_str()) == Some("agent_message_chunk")
                    {
                        if let Some(t) = u
                            .get("content")
                            .and_then(|c| c.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            on_delta(t);
                        }
                    }
                }
                continue;
            }

            // Agent → client request (id + method) → minimal reply.
            if let (Some(req_id), Some(req_method)) = (
                v.get("id").and_then(|i| i.as_i64()),
                v.get("method").and_then(|m| m.as_str()),
            ) {
                let result = if req_method == "session/request_permission" {
                    select_allow_outcome(&v)
                } else if req_method == "fs/read_text_file" {
                    json!({ "content": "" })
                } else {
                    Value::Null
                };
                self.write_msg(&json!({ "jsonrpc": "2.0", "id": req_id, "result": result }))
                    .await?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perm_req(options: Value) -> Value {
        json!({ "params": { "options": options } })
    }

    #[test]
    fn approves_allow_once_over_other_options() {
        let req = perm_req(json!([
            { "optionId": "r", "kind": "reject_once" },
            { "optionId": "a", "kind": "allow_once" },
            { "optionId": "aa", "kind": "allow_always" },
        ]));
        assert_eq!(
            select_allow_outcome(&req),
            json!({ "outcome": { "outcome": "selected", "optionId": "a" } })
        );
    }

    #[test]
    fn falls_back_to_allow_always_then_any_non_reject() {
        let only_always = perm_req(json!([
            { "optionId": "r", "kind": "reject_once" },
            { "optionId": "aa", "kind": "allow_always" },
        ]));
        assert_eq!(
            select_allow_outcome(&only_always),
            json!({ "outcome": { "outcome": "selected", "optionId": "aa" } })
        );

        // Unknown kind that isn't a reject is still usable.
        let custom = perm_req(json!([
            { "optionId": "r", "kind": "reject_always" },
            { "optionId": "x", "kind": "grant" },
        ]));
        assert_eq!(
            select_allow_outcome(&custom),
            json!({ "outcome": { "outcome": "selected", "optionId": "x" } })
        );
    }

    #[test]
    fn cancels_when_only_reject_options_or_none() {
        let only_reject = perm_req(json!([
            { "optionId": "r1", "kind": "reject_once" },
            { "optionId": "r2", "kind": "reject_always" },
        ]));
        assert_eq!(
            select_allow_outcome(&only_reject),
            json!({ "outcome": { "outcome": "cancelled" } })
        );
        // Malformed / missing options -> cancel, never panic.
        assert_eq!(
            select_allow_outcome(&json!({})),
            json!({ "outcome": { "outcome": "cancelled" } })
        );
    }

    /// Real end-to-end: spawn hermes-acp via the kernel client, run one
    /// streamed prompt turn. Network + uvx + a configured hermes provider.
    /// Run: `cargo test acp_smoke -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn acp_smoke() {
        let env = BTreeMap::new();
        let mut client = AcpClient::start("hermes", &env)
            .await
            .expect("start hermes-acp");
        let mut answer = String::new();
        let turns = vec![("user".to_string(), "Reply with exactly: ACP OK".to_string())];
        let stop = client
            .prompt(&turns, None, |d| answer.push_str(d))
            .await
            .expect("prompt turn");
        println!("\nANSWER: {answer:?}  stopReason={stop}");
        assert!(!answer.trim().is_empty(), "no streamed text from hermes");
    }
}
