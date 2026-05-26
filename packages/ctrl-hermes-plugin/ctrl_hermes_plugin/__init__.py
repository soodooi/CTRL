"""CTRL hermes Tool plugin — primary hermes integration path.

Per ADR-019, this plugin is the primary UX for hermes-agent to consume
CTRL's capability surface. Every handler is a thin shim that forwards
to the kernel MCP server at 127.0.0.1:17873 (ADR-013) — no business
logic lives here.

Discovery: hermes auto-loads the plugin via pip entry-point group
`hermes_agent.plugins` OR via `~/.hermes/plugins/ctrl/` directory.

Handshake: the kernel writes ~/.ctrl/state/kernel-handshake.json on each
CTRL.app boot with a fresh Bearer token. Handlers read it on first call
and refresh lazily on 401.
"""

from __future__ import annotations

__version__ = "0.1.0"

from ctrl_hermes_plugin.register import register

__all__ = ["register", "__version__"]
