#!/usr/bin/env python3
"""Merge the live probe's reports into one table: service, step, and the result on each platform.

    python3 scripts/live-table.py live-linux.jsonl live-windows.jsonl live-macos.jsonl

Each file is what `apps/desktop/src-tauri/tests/live_signins.rs` writes to `$HX_LIVE_REPORT`: one JSON object a line with
`platform`, `service`, `step`, `result` (pass, fail or blocked) and `note`. The table is Markdown, for a job summary; under it,
what each row that did not pass saw, by platform. Exits 1 when any row failed.
"""

import json
import sys


def main(paths: list[str]) -> int:
    rows: dict[tuple[str, str], dict[str, dict[str, str]]] = {}
    platforms: list[str] = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                r = json.loads(line)
                if r["platform"] not in platforms:
                    platforms.append(r["platform"])
                rows.setdefault((r["service"], r["step"]), {})[r["platform"]] = r
    out = ["### Live sign-in probe", "", "| Service | Step | " + " | ".join(platforms) + " |",
           "|---|---|" + "---|" * len(platforms)]
    notes = []
    failed = False
    for (service, step), by in rows.items():
        cells = []
        for p in platforms:
            r = by.get(p)
            cells.append(r["result"] if r else "not run")
            if r and r["result"] != "pass":
                failed = failed or r["result"] == "fail"
                notes.append(f"- **{service}, {step}** on {p} ({r['result']}): {r['note']}")
        out.append(f"| {service} | {step} | " + " | ".join(cells) + " |")
    if notes:
        out += ["", "What the rows that did not pass saw:", "", *notes]
    print("\n".join(out))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
