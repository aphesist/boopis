"""The command splitter the rules and the read-only check stand on."""

from __future__ import annotations

import pytest
from boopis.policy.shellcmd import SimpleCommand, split, strip_wrappers

SPLITS: list[tuple[str, list[tuple[tuple[str, ...], bool]] | None]] = [
    ("ls -la", [(("ls", "-la"), False)]),
    ("a && b || c; d | e |& f & g", [((x,), False) for x in "abcdefg"]),
    ("a\nb", [(("a",), False), (("b",), False)]),
    ("echo 'a && b'", [(("echo", "a && b"), False)]),
    ('echo "a; b"', [(("echo", "a; b"), False)]),
    (r"echo a\ b", [(("echo", "a b"), False)]),
    ("echo hi > out", [(("echo", "hi"), True)]),
    ("echo hi>out", [(("echo", "hi"), True)]),
    ("echo hi >> out", [(("echo", "hi"), True)]),
    ("echo hi &> out", [(("echo", "hi"), True)]),
    ("echo hi > /dev/null", [(("echo", "hi"), False)]),
    ("echo hi 2>&1", [(("echo", "hi"), False)]),
    ("echo hi 2> err", [(("echo", "hi"), True)]),
    ("cat < in", [(("cat",), False)]),
    ("echo '>'", [(("echo", ">"), False)]),
    ("echo $HOME ${HOME}", [(("echo", "$HOME", "${HOME}"), False)]),
    ("echo $(x)", None),
    ("echo `x`", None),
    ('echo "$(x)"', None),
    ("(cd a; ls)", None),
    ("cat <(x)", None),
    ("cat <<EOF", None),
    ("echo 'unterminated", None),
    ('echo "unterminated', None),
    ("echo a\\", None),
    ("", []),
]


@pytest.mark.parametrize(("command", "expected"), SPLITS)
def test_split(command: str, expected: list[tuple[tuple[str, ...], bool]] | None) -> None:
    got = split(command)
    if expected is None:
        assert got is None
    else:
        assert got == [SimpleCommand(words, writes) for words, writes in expected]


WRAPPERS = frozenset({"timeout", "time", "nice", "nohup", "stdbuf", "command", "builtin", "noglob"})
SAFE = frozenset({"LANG", "CI"})


@pytest.mark.parametrize(
    ("words", "expected"),
    [
        (("timeout", "5", "npm", "test"), ("npm", "test")),
        (("timeout", "-s", "KILL", "5", "npm"), ("npm",)),
        (("nice", "-n", "5", "make"), ("make",)),
        (("nohup", "x"), ("x",)),
        (("stdbuf", "-oL", "x"), ("x",)),
        (("command", "-v", "x"), ("x",)),
        (("time", "time", "x"), ("x",)),
        (("LANG=C", "ls"), ("ls",)),
        (("FOO=1", "ls"), ("FOO=1", "ls")),
        (("xargs", "rm"), ("rm",)),
        (("xargs", "-n1", "rm"), ("xargs", "-n1", "rm")),
        (("sh", "-c", "x"), ("sh", "-c", "x")),
    ],
)
def test_strip_wrappers(words: tuple[str, ...], expected: tuple[str, ...]) -> None:
    assert strip_wrappers(words, WRAPPERS, SAFE) == expected


def test_strip_all_env_and_extra_wrappers_for_deny() -> None:
    assert strip_wrappers(("FOO=1", "env", "BAR=2", "rm"), WRAPPERS, SAFE, strip_all_env=True, extra=("env",)) == (
        "rm",
    )
