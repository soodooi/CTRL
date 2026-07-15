---
inclusion: fileMatch
fileMatchPattern: "vault/ctrl/adrs/**"
---

# ADR Editing

Follow `vault/ctrl/adrs/PROCESS.md` exactly. Amend an existing module section in place; synchronize `version`, `last_updated`, `changelog`, `sections`, INDEX, and code citations. Create a new ADR only for a genuinely new module. Retired sections lose their body but retain a historical `sections` entry marked `retired-vN`.

Non-trivial code citations use `(ADR-NNN module § section vN)`. Never amend a lock point without bao consensus. `scripts/check-adr-acceptance.sh` is the executable Acceptance gate: `--soft` reports every design/release Acceptance scope during normal development, while `scripts/release.sh` strictly blocks only open items under explicit `Release Acceptance` / `发布验收` headings. Keep long-horizon backlog in a non-release design Acceptance scope; never mark it complete merely to ship.
