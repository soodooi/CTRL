#!/usr/bin/env python3
"""olym ADR governance lint — config-driven, project-agnostic.

Usage:
    python3 scripts/adr-check.py [--strict] [--config PATH]

Configuration:
    Reads .olym/decisions/adr-check.config.yaml (relative to git repo root)
    if present; falls back to built-in olym defaults if absent. See
    DEFAULT_CONFIG below for the full schema.

Pre-push hook: integrate via .husky/pre-push to block pushes that break
ADR cross-refs. With --strict, warnings become errors (release prep).

This script is the **advised** ADR lint for any olym consumer project.
Live in hello-olym/scripts/. Consumed by:
    - hello-olym itself (own .olym/decisions/)
    - iris-mro-camo via PATH (~/hello-olym/scripts/ on $PATH) + iris-local
      config-yaml override for legacy ADR-NNN- filename prefix +
      uppercase status (drift from olym 0.1+ standard).
    - future olym consumers — same pattern: install via PATH or plugin,
      add adr-check.config.yaml only when overriding.

Validation rules (10 errors + 2 warnings):

  E1: Every ADR file has parseable YAML frontmatter
  E2: Required fields present (configurable; default = adr_id, title,
      status, date, deciders, scope)
  E3: status value is in allowed set (configurable; olym default =
      proposed/accepted/rejected/superseded/deprecated)
  E4: Cross-refs (supersedes / superseded_by / partially_superseded_by /
      amended_by) point to existing ADR ids
  E5: Bidirectional supersede — if A.supersedes=[B], B.status must be
      "superseded" AND B.superseded_by must equal A
  E6: Bidirectional partial supersede — if A in B.partially_superseded_by,
      B.status must be accepted/amended (NOT superseded)
  E7: Bidirectional amend — if A in B.amended_by, A.status must be
      accepted (amender does NOT supersede)
  E8: INDEX.md row count matches ADR file count + every ADR represented
  E9: INDEX.md row ordering follows numeric ADR id order
  E10: `## Alternatives considered` section present with ≥2 table rows
  E11: `**Reversal cost**:` token present inside `## Consequences`
  E12: `## Acceptance` section present with at least one `- [ ]` checkbox
  E13: `## Changelog` section present with markdown table (≥1 data row)

  W1: Two accepted ADRs share scope + title similarity >0.70 (potential
      duplicate scope conflict; needs reviewer eyeball)
  W2: deciders is a single-element list of length 1 (low-quorum decision)

Config knobs (.olym/decisions/adr-check.config.yaml):

    filename_pattern: regex matching ADR filenames in DECISIONS_DIR
    status_values: list of allowed status strings
    required_fields: list of required frontmatter keys
    id_field: which frontmatter field holds the ADR identifier
    index_filename: name of the index markdown file inside DECISIONS_DIR
    index_link_pattern: regex extracting ADR ids from INDEX.md
    duplicate_scope_warn: bool — enable W1 same-scope heuristic
    scope_field: name of the scope field used for W1 (default: scope)
    enriched_sections: bool — enable E10-E13 (set false for legacy ADRs)
    superseded_status: token used in cross-refs (e.g. "superseded" or
      "SUPERSEDED" depending on project)
    accepted_statuses: list of statuses treated as "currently in force"
      for E6/E7 (default: [accepted, amended])
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path


# ──────────────────────────────────────────────────────────────────────
# Built-in defaults (used when no config yaml present in target repo).
# Matches olym 0.1+ advised template (hello-olym/.olym/decisions/_template.md).
# ──────────────────────────────────────────────────────────────────────
DEFAULT_CONFIG = {
    "filename_pattern": r"^[0-9]{3}-[a-z0-9-]+\.md$",
    "status_values": ["proposed", "accepted", "rejected", "superseded", "deprecated"],
    "required_fields": ["adr_id", "title", "status", "date", "deciders", "scope"],
    "id_field": "adr_id",
    "index_filename": "INDEX.md",
    "index_link_pattern": r"\[(\d{3})\]\(",
    "duplicate_scope_warn": True,
    "scope_field": "scope",
    "enriched_sections": True,
    "superseded_status": "superseded",
    "accepted_statuses": ["accepted", "amended"],
}


# ──────────────────────────────────────────────────────────────────────
# YAML frontmatter parser (no pyyaml dep) — supports the actual shapes
# olym ADRs use: scalars, list-of-scalars, list-of-dicts (depth 2).
# ──────────────────────────────────────────────────────────────────────
def parse_frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?\n)---\s*\n", text, re.DOTALL)
    if not m:
        return {}
    body = m.group(1)

    result: dict = {}
    current_key: str | None = None
    current_list: list | None = None
    current_dict: dict | None = None

    for raw_line in body.splitlines():
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())

        if indent == 0:
            current_dict = None
            m2 = re.match(r"^(\w[\w_-]*)\s*:\s*(.*)$", line)
            if not m2:
                continue
            key, value = m2.group(1), m2.group(2).strip()
            if value == "":
                current_key = key
                current_list = []
                result[key] = current_list
            else:
                # Inline list value: key: [a, b, c]
                if value.startswith("[") and value.endswith("]"):
                    inner = value[1:-1].strip()
                    items = [_strip_quotes(x.strip()) for x in inner.split(",") if x.strip()]
                    result[key] = items
                else:
                    result[key] = _strip_quotes(value)
                current_key = None
                current_list = None
        elif indent == 2 and current_list is not None:
            stripped = line.lstrip()
            if stripped.startswith("- "):
                item = stripped[2:].strip()
                if ":" in item and not item.startswith("ADR-") and not item.startswith("http"):
                    m3 = re.match(r"^(\w[\w_-]*)\s*:\s*(.*)$", item)
                    if m3:
                        d: dict = {m3.group(1): _strip_quotes(m3.group(2).strip())}
                        current_list.append(d)
                        current_dict = d
                        continue
                current_list.append(_strip_quotes(item))
                current_dict = None
        elif indent >= 4 and current_dict is not None:
            stripped = line.lstrip()
            m4 = re.match(r"^(\w[\w_-]*)\s*:\s*(.*)$", stripped)
            if m4:
                v = _strip_quotes(m4.group(2).strip())
                if v.startswith("[") and v.endswith("]"):
                    inner = v[1:-1].strip()
                    items = [_strip_quotes(x.strip()) for x in inner.split(",") if x.strip()]
                    current_dict[m4.group(1)] = items
                else:
                    current_dict[m4.group(1)] = v

    return result


def _strip_quotes(s: str) -> str:
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        return s[1:-1]
    return s


# ──────────────────────────────────────────────────────────────────────
# Config loader — reads .olym/decisions/adr-check.config.yaml if present,
# else returns DEFAULT_CONFIG. Mini-yaml parser (no pyyaml dep).
# ──────────────────────────────────────────────────────────────────────
def load_config(decisions_dir: Path) -> dict:
    config_path = decisions_dir / "adr-check.config.yaml"
    if not config_path.is_file():
        return dict(DEFAULT_CONFIG)
    cfg = dict(DEFAULT_CONFIG)
    text = config_path.read_text(encoding="utf-8")
    current_key: str | None = None
    current_list: list | None = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0:
            m = re.match(r"^(\w[\w_-]*)\s*:\s*(.*)$", line)
            if not m:
                continue
            key, value = m.group(1), m.group(2).strip()
            if value == "":
                current_key = key
                current_list = []
                cfg[key] = current_list
                continue
            current_key = None
            current_list = None
            if value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                cfg[key] = [_strip_quotes(x.strip()) for x in inner.split(",") if x.strip()]
            elif value.lower() in ("true", "false"):
                cfg[key] = value.lower() == "true"
            else:
                cfg[key] = _strip_quotes(value)
        elif indent == 2 and current_list is not None:
            stripped = line.lstrip()
            if stripped.startswith("- "):
                item = stripped[2:].strip()
                current_list.append(_strip_quotes(item))
    return cfg


# ──────────────────────────────────────────────────────────────────────
# ADR collection — driven by filename_pattern from config.
# ──────────────────────────────────────────────────────────────────────
def collect_adrs(decisions_dir: Path, cfg: dict) -> dict[str, dict]:
    adrs: dict[str, dict] = {}
    pattern = re.compile(cfg["filename_pattern"])
    id_field = cfg["id_field"]
    for p in sorted(decisions_dir.glob("*.md")):
        if p.name in {"README.md", "INDEX.md", "_template.md"}:
            continue
        if not pattern.match(p.name):
            continue
        meta = parse_frontmatter(p)
        # Prefer id from frontmatter; fallback to filename leading digits.
        adr_id = meta.get(id_field)
        if not adr_id:
            digits = re.match(r"^(?:ADR-)?(\d{3})", p.stem)
            adr_id = digits.group(1) if digits else p.stem
        adrs[str(adr_id)] = {"meta": meta, "path": p, "raw": p.read_text(encoding="utf-8")}
    return adrs


# ──────────────────────────────────────────────────────────────────────
# Validation — applies E1-E13 + W1/W2 against the loaded ADR set.
# ──────────────────────────────────────────────────────────────────────
def validate(adrs: dict[str, dict], cfg: dict, decisions_dir: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    required_fields = cfg["required_fields"]
    valid_status = set(cfg["status_values"])
    id_field = cfg["id_field"]
    superseded_status = cfg["superseded_status"]
    accepted_statuses = set(cfg["accepted_statuses"])
    enriched = bool(cfg["enriched_sections"])

    # E1, E2, E3: frontmatter shape
    for adr_id, item in adrs.items():
        meta = item["meta"]
        path = item["path"]
        if not meta:
            errors.append(f"E1 {path.name}: missing or unparseable frontmatter")
            continue
        for f in required_fields:
            if f not in meta or meta[f] in (None, "", [], {}):
                errors.append(f"E2 {path.name}: missing required field '{f}'")
        status = meta.get("status")
        if status and status not in valid_status:
            errors.append(
                f"E3 {path.name}: invalid status '{status}'; allowed: {sorted(valid_status)}"
            )

    # E4-E7: cross-ref integrity
    for adr_id, item in adrs.items():
        meta = item["meta"]
        path = item["path"]

        supersedes = _as_list(meta.get("supersedes"))
        for target in supersedes:
            tid = _adr_ref(target, id_field)
            if tid not in adrs:
                errors.append(f"E4 {path.name}: supersedes references unknown ADR '{target}'")
                continue
            tgt = adrs[tid]["meta"]
            if tgt.get("status") != superseded_status:
                errors.append(
                    f"E5 {path.name}: supersedes {tid} but {tid}.status='{tgt.get('status')}', "
                    f"expected '{superseded_status}'"
                )
            tgt_sb = _adr_ref(tgt.get("superseded_by", ""), id_field)
            if tgt_sb != adr_id:
                errors.append(
                    f"E5 {path.name}: supersedes {tid}, but {tid}.superseded_by='{tgt_sb}' != '{adr_id}'"
                )

        sb = meta.get("superseded_by")
        if sb:
            tid = _adr_ref(sb, id_field)
            if tid not in adrs:
                errors.append(f"E4 {path.name}: superseded_by references unknown ADR '{sb}'")
            elif adr_id not in [_adr_ref(x, id_field) for x in _as_list(adrs[tid]["meta"].get("supersedes"))]:
                errors.append(
                    f"E5 {path.name}: superseded_by={tid} but {tid} does NOT list {adr_id} in supersedes"
                )

        partial = meta.get("partially_superseded_by") or []
        if isinstance(partial, list):
            for entry in partial:
                if isinstance(entry, dict):
                    tid = _adr_ref(entry, id_field)
                    if tid and tid not in adrs:
                        errors.append(
                            f"E4 {path.name}: partially_superseded_by references unknown ADR '{tid}'"
                        )
                    elif tid and adrs[tid]["meta"].get("status") not in accepted_statuses:
                        warnings.append(
                            f"E6 {path.name}: partially_superseded_by {tid} but {tid}.status="
                            f"'{adrs[tid]['meta'].get('status')}'; one of {sorted(accepted_statuses)} expected"
                        )

        amended = meta.get("amended_by") or []
        if isinstance(amended, list):
            for entry in amended:
                if isinstance(entry, dict):
                    tid = _adr_ref(entry, id_field)
                    if tid and tid not in adrs:
                        errors.append(f"E4 {path.name}: amended_by references unknown ADR '{tid}'")

    # E8, E9: INDEX consistency
    index_file = decisions_dir / cfg["index_filename"]
    if not index_file.is_file():
        # INDEX is optional — only fail if config explicitly insists; otherwise skip.
        # Default: not present is a warning.
        warnings.append(f"E8 {cfg['index_filename']} not found under {decisions_dir.name}/")
    else:
        idx_text = index_file.read_text(encoding="utf-8")
        # Pattern's capture group MUST yield identifiers in the same form as
        # adrs.keys() (i.e. matching the value of frontmatter id_field).
        # For iris (id_field=id, values like "ADR-018") use
        # `\[(ADR-\d{3})\]\(`. For olym default (id_field=adr_id, values
        # like "018") use `\[(\d{3})\]\(`.
        ids_in_index = re.findall(cfg["index_link_pattern"], idx_text)
        unique_in_index = []
        seen = set()
        for x in ids_in_index:
            if x not in seen:
                unique_in_index.append(x)
                seen.add(x)
        adr_keys = set(adrs.keys())
        if set(unique_in_index) != adr_keys:
            missing = adr_keys - set(unique_in_index)
            extra = set(unique_in_index) - adr_keys
            if missing:
                errors.append(f"E8 {cfg['index_filename']} missing ADR rows: {sorted(missing)}")
            if extra:
                errors.append(f"E8 {cfg['index_filename']} has rows pointing at non-existent ADRs: {sorted(extra)}")

    # E10-E13: enriched section discipline (advised olym format)
    if enriched:
        for adr_id, item in adrs.items():
            raw = item["raw"]
            path = item["path"]
            if not _section_present(raw, "Alternatives considered"):
                errors.append(f"E10 {path.name}: missing '## Alternatives considered' section")
            else:
                rows = _count_table_data_rows(raw, "Alternatives considered")
                if rows < 2:
                    errors.append(
                        f"E10 {path.name}: '## Alternatives considered' table has {rows} data row(s); ≥2 required"
                    )
            if not _section_present(raw, "Consequences"):
                errors.append(f"E11 {path.name}: missing '## Consequences' section")
            elif "**Reversal cost**" not in _section_body(raw, "Consequences"):
                errors.append(f"E11 {path.name}: '## Consequences' missing '**Reversal cost**:' line")
            if not _section_present(raw, "Acceptance"):
                errors.append(f"E12 {path.name}: missing '## Acceptance' section")
            elif "- [ ]" not in _section_body(raw, "Acceptance") and "- [x]" not in _section_body(raw, "Acceptance"):
                errors.append(f"E12 {path.name}: '## Acceptance' has no checkbox items")
            if not _section_present(raw, "Changelog"):
                errors.append(f"E13 {path.name}: missing '## Changelog' section")
            else:
                rows = _count_table_data_rows(raw, "Changelog")
                if rows < 1:
                    errors.append(
                        f"E13 {path.name}: '## Changelog' table has {rows} data rows; ≥1 required"
                    )

    # W1: scope-conflict heuristic
    if cfg.get("duplicate_scope_warn", True):
        scope_field = cfg["scope_field"]
        accepted = [
            (aid, item["meta"])
            for aid, item in adrs.items()
            if item["meta"].get("status") in accepted_statuses
        ]
        for i, (aid, ameta) in enumerate(accepted):
            for bid, bmeta in accepted[i + 1:]:
                if not ameta.get(scope_field) or ameta.get(scope_field) != bmeta.get(scope_field):
                    continue
                ratio = difflib.SequenceMatcher(
                    None, ameta.get("title", "").lower(), bmeta.get("title", "").lower()
                ).ratio()
                if ratio > 0.70:
                    warnings.append(
                        f"W1 {aid} vs {bid}: same {scope_field}='{ameta.get(scope_field)}' + "
                        f"title similarity {ratio:.2f} — check for duplicate scope"
                    )

    # W2: low-quorum (single decider)
    for adr_id, item in adrs.items():
        deciders = item["meta"].get("deciders")
        if isinstance(deciders, list) and len(deciders) == 1:
            warnings.append(f"W2 {item['path'].name}: deciders has only 1 entry '{deciders[0]}'")

    return errors, warnings


def _as_list(value) -> list:
    if not value:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        return [value]
    return []


def _adr_ref(value, id_field: str) -> str:
    """Return the cross-ref target string as-is (trimmed).

    Keeping the id in whatever form the project uses (with or without
    `ADR-` prefix) so it directly matches adrs.keys(). Projects that
    mix forms inside one repo are unsupported — pick one and stick to it.
    """
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        v = value.get(id_field) or value.get("adr_id") or ""
        return v.strip() if isinstance(v, str) else ""
    return ""


def _section_present(raw: str, header: str) -> bool:
    pattern = rf"^##\s+{re.escape(header)}\s*$"
    return bool(re.search(pattern, raw, re.MULTILINE))


def _section_body(raw: str, header: str) -> str:
    """Return body of a section between its '## Header' line and the next '## ' or EOF."""
    pattern = rf"^##\s+{re.escape(header)}\s*$"
    m = re.search(pattern, raw, re.MULTILINE)
    if not m:
        return ""
    start = m.end()
    nxt = re.search(r"^##\s+", raw[start:], re.MULTILINE)
    end = start + nxt.start() if nxt else len(raw)
    return raw[start:end]


def _count_table_data_rows(raw: str, section_header: str) -> int:
    body = _section_body(raw, section_header)
    if not body:
        return 0
    # Markdown table: header row | --- | --- | separator | data rows
    lines = [ln.strip() for ln in body.splitlines() if ln.strip().startswith("|")]
    if len(lines) < 3:
        return 0  # need at least: header, separator, 1 data
    # Skip header and separator (which contains ---)
    data = [ln for ln in lines[2:] if not re.match(r"^\|[\s\-:|]+\|$", ln)]
    return len(data)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="warnings become errors")
    parser.add_argument("--config", help="explicit config yaml path (default: .olym/decisions/adr-check.config.yaml)")
    args = parser.parse_args()

    # Resolve repo root from cwd (where the user ran the script)
    cwd = Path.cwd()
    while cwd != cwd.parent:
        if (cwd / ".olym").is_dir() or (cwd / ".git").is_dir():
            break
        cwd = cwd.parent
    decisions_dir = cwd / ".olym" / "decisions"
    if not decisions_dir.is_dir():
        print(f"adr-check: no .olym/decisions/ found near cwd ({Path.cwd()})", file=sys.stderr)
        return 1

    cfg = load_config(decisions_dir)
    adrs = collect_adrs(decisions_dir, cfg)
    if not adrs:
        print(f"adr-check: no ADRs found under {decisions_dir}", file=sys.stderr)
        return 1

    errors, warnings = validate(adrs, cfg, decisions_dir)

    if warnings:
        print(f"\n--- {len(warnings)} warning(s) ---", file=sys.stderr)
        for w in warnings:
            print(f"WARN: {w}", file=sys.stderr)
    if errors:
        print(f"\n--- {len(errors)} error(s) ---", file=sys.stderr)
        for e in errors:
            print(f"ERR : {e}", file=sys.stderr)

    if errors:
        return 1
    if warnings and args.strict:
        return 1

    print(f"adr-check: OK ({len(adrs)} ADRs verified)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
