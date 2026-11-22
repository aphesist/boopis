#!/usr/bin/env python3
"""Check what boopis finds of a real Claude Code install, and that the engine's plugin runs the same program (ADR-0029).

    scripts/claude-cli-check.py <claude_probe binary> <plugin dir> <scenario> [--dir DIR]... [--expect ...]

The CI workflow `claude-cli.yml` installs Claude Code the way a person does (Anthropic's installer, npm) and calls this once
per scenario. Each call:

1. runs `claude_probe` (the host's own lookup and probe, `apps/desktop/src-tauri/examples/claude_probe.rs`) with `PATH` set
   to the system's folders plus `--dir` (on Windows the variable is spelled `Path`, as Windows spells it, which is how the
   owner's `npm install` went unseen before);
2. runs the plugin's own `_resolve(None, os.environ)` (`directsdk_setup.py` at the commit the engine's catalogue pins) in a
   Python started with exactly the environment the engine gets (`engine_env`), as the gateway would;
3. checks the expectations: the state, a version that serves at least one model, where `claude` was found, whether the
   engine was handed the path, and that the plugin resolves the very file boopis found;
4. with `--signin`, starts what the card's "Sign in to Claude" starts (`claude_probe signin`: the host's own sign-in process,
   `claude auth login --claudeai` from the `claude` boopis found), and checks that Claude Code sends the person to Claude's
   own sign-in page from that very file, and that the page answers. It stops there: the next step needs a person.

Standard library only. Prints what it saw, and exits 1 on the first expectation that does not hold.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

WINDOWS = os.name == "nt"


def system_dirs() -> list[str]:
    """The folders every program finds on a fresh system, and nothing a developer added."""
    if WINDOWS:
        root = os.environ.get("SYSTEMROOT", r"C:\Windows")
        return [os.path.join(root, "system32"), root, os.path.join(root, "System32", "WindowsPowerShell", "v1.0")]
    return ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]


def probe(binary: str, dirs: list[str], *args: str) -> dict:
    env = {k: v for k, v in os.environ.items() if k.upper() != "PATH"}
    # Windows spells it `Path`; a lookup that asks for `PATH` by exact name misses it
    env["Path" if WINDOWS else "PATH"] = os.pathsep.join(dirs)
    run = subprocess.run([binary, *args], env=env, capture_output=True, text=True, encoding="utf-8", timeout=180)
    if run.returncode != 0:
        sys.exit(f"claude_probe failed ({run.returncode}): {run.stderr}")
    return json.loads(run.stdout)


PLUGIN_RESOLVE = """
import json, os, sys
sys.path.insert(0, sys.argv[1])
from directsdk_setup import _resolve
found = _resolve(None, os.environ)
print(json.dumps(found[0] if found else None))
"""


def plugin_resolve(plugin_dir: str, engine_env: dict) -> str | None:
    run = subprocess.run([sys.executable, "-I", "-c", PLUGIN_RESOLVE, plugin_dir], env=engine_env, capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    if run.returncode != 0:
        sys.exit(f"the plugin's _resolve failed: {run.stderr}")
    return json.loads(run.stdout)


def same_file(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return a is b
    if WINDOWS:
        return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))
    return os.path.realpath(a) == os.path.realpath(b)


# where Claude Code's own sign-in sends a person (claude.ai for a Claude plan; the others are Anthropic's own sign-in hosts)
SIGNIN_HOSTS = {"claude.ai", "claude.com", "platform.claude.com", "console.anthropic.com"}


def answers(url: str) -> str:
    """How the page answers a plain request: any HTTP answer below 500 means it is online (Cloudflare may ask a script, not a
    browser, to prove itself first); no answer or a server error does not."""
    req = urllib.request.Request(url, headers={"User-Agent": "boopis-ci (claude-cli check)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        if e.code >= 500:
            raise
        challenge = " (Cloudflare's browser check, which a browser passes)" if e.headers.get("cf-mitigated") == "challenge" else ""
        return f"HTTP {e.code}{challenge}"


def check_signin(binary: str, dirs: list[str], found: str, fail) -> None:
    s = probe(binary, dirs, "signin")
    print(f"Sign in to Claude runs: {s['command_line']} (as {s['program']})")
    for line in s["said"]:
        print(f"  claude said: {line}")
    if not same_file(s["program"], found):
        fail(f"the sign-in runs {s['program']}, boopis found {found}")
    if s["ended_first"]:
        fail("Claude Code's sign-in ended before it named a page")
    page = s["page"] or ""
    u = urllib.parse.urlsplit(page)
    if u.scheme != "https" or u.hostname not in SIGNIN_HOSTS or "/oauth/" not in u.path:
        fail(f"the sign-in named no page of Claude's own sign-in ({page!r})")
    try:
        how = answers(page)
    except (urllib.error.URLError, OSError) as e:
        fail(f"{u.scheme}://{u.hostname}{u.path} did not answer: {e}")
    print(f"ok: Sign in to Claude opens {u.scheme}://{u.hostname}{u.path}, which answers: {how}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("binary")
    ap.add_argument("plugin_dir")
    ap.add_argument("scenario")
    ap.add_argument("--dir", action="append", default=[], help="a folder to put on PATH after the system's")
    ap.add_argument("--expect-state", required=True)
    ap.add_argument("--expect-found", help="the end of the path boopis finds (folder and file name)")
    ap.add_argument("--expect-override", choices=["yes", "no"], default="no")
    ap.add_argument("--signin", action="store_true", help="also start Sign in to Claude, up to the page that needs a person")
    a = ap.parse_args()

    dirs = system_dirs() + [os.path.expandvars(os.path.expanduser(d)) for d in a.dir]
    out = probe(a.binary, dirs)
    p = out["probe"]
    shown = {k: out[k] for k in ("os", "found", "plugin_alone", "engine_override", "desktop_copy", "auth_status_logged_in")}
    print(f"== {a.scenario}: PATH = {os.pathsep.join(dirs)}")
    print(json.dumps({**shown, "probe": p}, indent=2))

    def fail(why: str) -> None:
        sys.exit(f"FAIL ({a.scenario}): {why}")

    if p["state"] != a.expect_state:
        fail(f"state is {p['state']}, expected {a.expect_state}: {p['detail']}")
    if a.expect_state == "not_installed":
        if out["found"] is not None:
            fail(f"found {out['found']} where nothing should be")
        if not (p.get("install") or {}).get("command"):
            fail("not installed, but no installer to show")
        print(f"ok: not installed, and the card shows {p['install']['command']!r} for {p['install']['shell']}")
        return
    if not isinstance(out.get("auth_status_logged_in"), bool):
        fail(f"`claude auth status` gave no loggedIn answer ({out.get('auth_status_logged_in')!r})")
    if not p.get("version") or not p.get("aliases"):
        fail(f"version {p.get('version')!r} serves no model ({p.get('aliases')})")
    norm = (lambda s: s.replace("/", "\\").lower()) if WINDOWS else (lambda s: s)
    if a.expect_found and not norm(out["found"] or "").endswith(norm(a.expect_found)):
        fail(f"found {out['found']}, expected …{a.expect_found}")
    has_override = out["engine_override"] is not None
    if has_override != (a.expect_override == "yes"):
        fail(f"engine override is {out['engine_override']}, expected {a.expect_override}")
    if has_override and out["engine_env"].get(out["engine_override"][0]) != out["found"]:
        fail("the engine's environment does not carry the override")
    resolved = plugin_resolve(a.plugin_dir, out["engine_env"])
    print(f"the plugin's _resolve in the engine's environment: {resolved}")
    if not same_file(resolved, out["found"]):
        fail(f"the plugin would run {resolved}, boopis found {out['found']}")
    print(f"ok: {p['state']}, Claude Code {p['version']} at {out['found']}, and the plugin runs the same file")
    if a.signin:
        check_signin(a.binary, dirs, out["found"], fail)


if __name__ == "__main__":
    main()
