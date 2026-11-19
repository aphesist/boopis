"""``denied_read_paths``: paths no tool of the agent may read. A hard deny, never an ask, in both modes.

The list is data (``defaults.json``) with the same grammar and the same matcher as ``protected_extra``
(``rules.path_spec_matches``: ``//abs`` globs, ``~/``, case-insensitive like hx-txn's protected paths). A session may
add globs (``SessionPolicy.denied_read``); it can never remove a default.

What is judged, for every tool and not only the read tools (a write to such a path is refused too: it would read or
replace the file the host trusts):

- **path arguments** (the tool's ``path_arguments``, and any argument named in ``denied_read_path_keys``): resolved
  with ``~``, environment variables, ``file://``, ``..`` and symlinks (realpath), then matched against the globs;
- **folders and globs**: the filesystem is never walked (a walk slows every search of a big project and would refuse
  a monorepo). The *concrete* denied locations are computed instead (``denied_locations``: this profile's journal key
  and old rendezvous file, the same two under every other profile of the Hermes root, and the socket named by
  ``BOOPIS_HOST_SECRETS_SOCKET``). A folder is refused when its realpath is one of them or an ancestor of one. A glob
  is refused when its literal head is such an ancestor and the glob matches the location. Nothing is excluded:
  ``search_files`` and ``pack`` have no exclusion option, so a refusal is the only answer that is safe for every tool.
  A project that lives at the Hermes root or above it (a project that is the home folder) is refused for the same
  reason. Globs a session adds are matched against the paths a call names, not against folders (they have no
  concrete location);
- **command lines and code** (arguments named in ``denied_read_script_keys``, which includes ``terminal``'s
  command): read word by word with ``shellcmd``, following ``cd``, and token by token when the line cannot be
  parsed, with the rules above. This is a best effort, not a boundary: a shell can build a path out of pieces. The
  host's own peer check is the boundary;
- **every other short single-line string argument**: matched whole, as a path, so a tool that takes a path under an
  argument name this module has not heard of is still covered. Long or multi-line text (file contents, diffs) is never
  read as a path, so writing a document that mentions the file is not blocked;
- a mod's ``fs.read`` subject.

Known gap: a symlink *inside* a folder that is searched, pointing at a denied file, is not seen, because nothing looks
inside the folder. The tools do not follow it either (Hermes's ``search_files`` runs ripgrep without ``-L``, and
``hx pack`` refuses a symlink that leaves the root), and a direct read of the link is caught by realpath. In
governed mode ``read_file`` and ``search_files`` stay inside the workspace in any case.
"""

from __future__ import annotations

import contextlib
import os
import re
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import unquote

from ..util.globs import compile_glob
from . import shellcmd
from .data import Defaults
from .rules import ResolvedPath, path_spec_matches, paths_of, resolve_path
from .types import Decision, SessionPolicy, ToolCall, block

__all__ = ["RULE", "denied_locations", "denied_read"]

RULE = "denied_read_paths"  # the rule's name in the ledger and in ``Decision.rule``
SOCKET_ENV = "BOOPIS_HOST_SECRETS_SOCKET"  # the host's secret socket (``hostsecrets.channel.SOCKET_ENV``)
_REASON = "denied_read"
_MESSAGE = (
    "Blocked: this call would read a path that the agent is never allowed to read (boopis's own host channel or "
    "journal key). Nothing was read. Do not retry it another way; work on the project's files instead."
)
_GLOB_CHARS = re.compile(r"[*?\[]")
_ESCAPE = re.compile(r"([*?\[])")
_TOKENS = re.compile(r"[\s;|&<>()'\"`=,{}]+")
_MAX_STRING = 1024
_MAX_SCRIPT = 100_000
_MAX_DEPTH = 4
_JOURNAL_KEY = ("boopis", "journals", ".hx-journal-key")  # <profile home>/boopis/journals/.hx-journal-key (hx-txn)
_RENDEZVOUS = ("boopis", "host-channel.json")  # what older hosts wrote in <hermes home>/boopis/


def denied_locations(home: str, root: str, env: Mapping[str, str]) -> tuple[str, ...]:
    """The concrete places a denied file lives, as absolute POSIX paths (each also by its realpath). Reads one folder,
    ``<root>/profiles``, to name the other profiles; never a tree."""
    found: list[str] = []
    homes = [h for h in (home, root) if h]
    profiles = os.path.join(root, "profiles") if root else ""
    if profiles:
        found.append(profiles)  # an ancestor of it is refused even when its listing fails
        with contextlib.suppress(OSError):
            homes.extend(os.path.join(profiles, name) for name in sorted(os.listdir(profiles)))
    for base in homes:
        found.append(os.path.join(base, *_JOURNAL_KEY))
        found.append(os.path.join(base, *_RENDEZVOUS))
    socket = env.get(SOCKET_ENV, "").strip()
    if socket:
        found.append(socket)
    out: dict[str, None] = {}
    for loc in found:
        for form in (os.path.abspath(os.path.expanduser(loc)), os.path.realpath(os.path.expanduser(loc))):
            out[form.replace(os.sep, "/")] = None
    return tuple(out)


def denied_read(call: ToolCall, defaults: Defaults, session: SessionPolicy) -> Decision | None:
    """A block when ``call`` would read a denied path, else None. An error is ``check``'s to turn into a block."""
    scan = _Scan((*defaults.denied_read_defaults, *session.denied_read), session, defaults)
    return block(_MESSAGE, _REASON, RULE) if scan.call(call) else None


class _Scan:
    def __init__(self, globs: tuple[str, ...], session: SessionPolicy, defaults: Defaults) -> None:
        self._globs = globs
        self._root = session.cwd
        self._session = session
        self._defaults = defaults
        self._seen: set[tuple[str, str]] = set()  # (base, path) already judged: a path argument is seen twice
        self._places: tuple[str, ...] | None = None

    def _locations(self) -> tuple[str, ...]:
        if self._places is None:
            s = self._session
            self._places = tuple(p.lower() for p in denied_locations(s.hermes_home, s.hermes_root, os.environ))
        return self._places

    # ---------------------------------------------------------------- the call

    def call(self, call: ToolCall) -> bool:
        d = self._defaults
        mod_read = call.principal.startswith("mod:") and call.capability == "fs.read" and call.subject
        if mod_read and self._path(call.subject, folder=True):
            return True
        if call.tool in d.path_arguments:
            for raw in paths_of(call, d) or ():
                if self._path(raw, folder=True):
                    return True
        return self._value(call.args, "", 0)

    def _value(self, value: Any, key: str, depth: int) -> bool:
        if depth > _MAX_DEPTH:
            return False
        if isinstance(value, str):
            return self._string(value, key)
        if isinstance(value, Mapping):
            return any(self._value(v, str(k), depth + 1) for k, v in value.items())
        if isinstance(value, Sequence):
            return any(self._value(v, key, depth + 1) for v in value)
        return False

    def _string(self, text: str, key: str) -> bool:
        d = self._defaults
        if key in d.denied_read_script_keys:
            return len(text) <= _MAX_SCRIPT and self._script(text)
        if key in d.denied_read_text_keys:
            return False
        if key in d.denied_read_keys:
            return "\0" not in text and self._path(text, folder=True)
        if len(text) > _MAX_STRING or "\n" in text or "\0" in text or not _pathlike(text):
            return False
        return self._path(text, folder=False)

    # ---------------------------------------------------------------- one path

    def _path(self, raw: str, *, folder: bool, base: str = "") -> bool:
        """Whether ``raw`` (a path, a ``file://`` URL or a glob, relative to ``base`` or the project) is denied or, as a
        ``folder``, holds a denied location."""
        text = raw.strip()
        if not text:
            return False
        if (base, text) in self._seen:
            return False
        self._seen.add((base, text))
        if text.lower().startswith("file://"):
            text = unquote(text[7:].removeprefix("localhost"))
        return any(self._variant(v, folder=folder, base=base) for v in dict.fromkeys((text, os.path.expandvars(text))))

    def _variant(self, text: str, *, folder: bool, base: str) -> bool:
        root = base or self._root
        text = os.path.expanduser(text)
        if _GLOB_CHARS.search(text):
            return self._glob(text, root, folder=folder)
        real = resolve_path(text, root).absolute
        return self._hit(real) or (folder and self._ancestor(real))

    def _glob(self, text: str, root: str, *, folder: bool) -> bool:
        """A glob is refused when its literal head holds a denied location and the glob selects it."""
        if not folder and not text.startswith("/"):
            return False  # a relative pattern in an argument we do not know is more likely a regex than a path
        segments = text.split("/")
        head: list[str] = []
        for segment in segments:
            if _GLOB_CHARS.search(segment):
                break
            head.append(segment)
        base = "/" if head == [""] else resolve_path("/".join(head) or ".", root).absolute
        selected = compile_glob(_ESCAPE.sub(r"[\1]", base.rstrip("/")) + "/" + "/".join(segments[len(head) :]), True)
        base_key = base.lower().rstrip("/")
        for place in self._locations():
            if (place == base_key or place.startswith(base_key + "/")) and selected.match(place.lstrip("/")):
                return True
        return False

    def _hit(self, real: str) -> bool:
        rel = _relative(real, self._root)
        path = ResolvedPath(real.replace(os.sep, "/"), rel)
        return any(path_spec_matches(glob, path, self._root, ignore_case=True) for glob in self._globs)

    def _ancestor(self, real: str) -> bool:
        """Whether the folder ``real`` is, or holds, a denied location (case-insensitive, like the globs)."""
        key = real.replace(os.sep, "/").lower().rstrip("/")
        return any(place == key or place.startswith(key + "/") for place in self._locations())

    # ---------------------------------------------------------------- command lines and code

    def _script(self, text: str) -> bool:
        cwd = resolve_path(".", self._root).absolute
        parsed = shellcmd.split(text)
        for item in parsed or ():
            words = item.words
            if words and words[0] in ("cd", "pushd") and len(words) > 1:
                target = resolve_path(os.path.expanduser(words[1]), cwd).absolute
                if os.path.isdir(target):
                    cwd = target
            for word in words:
                for piece in dict.fromkeys((word, word.partition("=")[2])):
                    if piece and self._path(piece, folder=True, base=cwd):
                        return True
        # also when it parsed: quotes and ``$(...)`` can hide a word from the split
        return any(t and _pathlike(t) and self._path(t, folder=False) for t in _TOKENS.split(text))


def _pathlike(text: str) -> bool:
    return "/" in text or text.startswith(("~", "$", "."))


def _relative(real: str, root: str) -> str | None:
    real_root = os.path.realpath(root) if root else ""
    if not real_root:
        return None
    try:
        candidate = os.path.relpath(real, real_root)
    except ValueError:
        return None
    if candidate == ".." or candidate.startswith(".." + os.sep):
        return None
    return candidate.replace(os.sep, "/")
