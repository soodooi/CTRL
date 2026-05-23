"""Kernel handshake — read URL + Bearer token from ~/.ctrl/state/kernel-handshake.json.

The CTRL.app kernel writes this file on each boot (mode 0600) so that
the hermes plugin can authenticate against the kernel MCP server without
the user ever copy-pasting a token.

Refresh semantics: read on first call, cache in process. On any tool-call
401 (token rotated by a kernel restart), drop the cache and re-read.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


HANDSHAKE_FILE_ENV = "CTRL_HANDSHAKE_FILE"
DEFAULT_HANDSHAKE_PATH = Path.home() / ".ctrl" / "state" / "kernel-handshake.json"


@dataclass(frozen=True)
class Handshake:
    """Kernel handshake snapshot. Immutable; rotate by replacing the instance."""

    url: str
    token: str


class HandshakeCache:
    """Process-local cache of the kernel handshake."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._value: Optional[Handshake] = None

    def get(self) -> Handshake:
        """Return the cached handshake, reading from disk if absent."""
        with self._lock:
            if self._value is None:
                self._value = _read_from_disk()
            return self._value

    def invalidate(self) -> None:
        """Drop the cache; the next get() re-reads from disk."""
        with self._lock:
            self._value = None


def _handshake_path() -> Path:
    """Resolve the handshake file path (env override for tests)."""
    env_override = os.environ.get(HANDSHAKE_FILE_ENV)
    if env_override:
        return Path(env_override)
    return DEFAULT_HANDSHAKE_PATH


def _read_from_disk() -> Handshake:
    """Read the handshake file. Raises FileNotFoundError if CTRL.app
    hasn't booted yet, or ValueError if the file is malformed."""
    path = _handshake_path()
    if not path.exists():
        raise FileNotFoundError(
            f"CTRL kernel handshake file not found at {path}. "
            "Is CTRL.app running? The kernel writes this file on each boot."
        )
    raw = path.read_text()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"handshake file malformed: {e}") from e
    url = data.get("url")
    token = data.get("token")
    if not isinstance(url, str) or not isinstance(token, str):
        raise ValueError(f"handshake file missing url or token: {data!r}")
    return Handshake(url=url, token=token)


# Module-level singleton — one cache per Python process. Hermes loads
# this plugin once per session, so a singleton is the right scope.
_cache = HandshakeCache()


def get_handshake() -> Handshake:
    """Return the current handshake (cached)."""
    return _cache.get()


def invalidate_handshake() -> None:
    """Drop the cache. Call after a 401 from the kernel."""
    _cache.invalidate()
