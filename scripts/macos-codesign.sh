#!/usr/bin/env bash
# Sign, or check the signatures of, every Mach-O file under the paths given (macOS only): the one place boopis signs nested
# code itself. Tauri signs the app bundle, `hx` and anything else it bundles; this script covers what Tauri never sees, the
# Hermes runtime inside its archive (scripts/build-runtime.sh calls it before it packs the payload), and is where a later
# nested helper that is built outside Tauri gets signed before the bundle is made (docs/RELEASING.md, "macOS").
#
#   scripts/macos-codesign.sh --identity <Developer ID identity> --entitlements <plist> <path>...
#   scripts/macos-codesign.sh --verify <path>...
#
# --identity signs with the hardened runtime and a secure timestamp (`codesign --options runtime --timestamp`), which
# notarisation requires of every nested executable, library and Python extension. Executables (Mach-O type MH_EXECUTE) get
# the entitlements; libraries and Python extensions get none (a library's entitlements are ignored). Then every signature is
# checked. --verify only checks: every Mach-O file must carry a valid signature for the slice this Mac runs (on Apple
# silicon the kernel refuses to map code without one), which a build that is not signed relies on (the linker's ad-hoc
# signature). Nothing is signed ad hoc here: a file that fails is reported and the script fails.
#
# A file is Mach-O when its first bytes are a Mach-O or universal ("fat") magic; Java class files share the universal magic
# and are told apart by their second word.
set -euo pipefail

IDENTITY=""
ENTITLEMENTS=""
VERIFY=0
PATHS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="$2"; shift 2 ;;
    --entitlements) ENTITLEMENTS="$2"; shift 2 ;;
    --verify) VERIFY=1; shift ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *) PATHS+=("$1"); shift ;;
  esac
done
[ "$(uname -s)" = Darwin ] || { echo "macos-codesign.sh runs on macOS only" >&2; exit 1; }
[ "${#PATHS[@]}" -gt 0 ] || { echo "no path given" >&2; exit 2; }
if [ "$VERIFY" = 0 ]; then
  [ -n "$IDENTITY" ] || { echo "--identity or --verify is needed" >&2; exit 2; }
  [ -f "$ENTITLEMENTS" ] || { echo "--entitlements must name a plist file (got '$ENTITLEMENTS')" >&2; exit 2; }
  plutil -lint -s "$ENTITLEMENTS" || { echo "$ENTITLEMENTS is not a valid plist" >&2; exit 1; }
fi
PY=python3
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Two lists, NUL-separated: executables, and everything else that is Mach-O (dylibs, bundles such as Python extensions).
"$PY" - "$WORK/exe" "$WORK/lib" "${PATHS[@]}" <<'PY'
import os, struct, sys

exe_out, lib_out, roots = sys.argv[1], sys.argv[2], sys.argv[3:]
THIN = {b"\xfe\xed\xfa\xce": ">", b"\xfe\xed\xfa\xcf": ">", b"\xce\xfa\xed\xfe": "<", b"\xcf\xfa\xed\xfe": "<"}
FAT = (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf")
MH_EXECUTE = 2

def kind(path):
    """'exe', 'lib' or None."""
    with open(path, "rb") as f:
        head = f.read(64)
        if len(head) < 16:
            return None
        if head[:4] in THIN:
            filetype = struct.unpack(THIN[head[:4]] + "I", head[12:16])[0]
            return "exe" if filetype == MH_EXECUTE else "lib"
        if head[:4] in FAT:
            nfat = struct.unpack(">I", head[4:8])[0]
            if not 0 < nfat < 32:  # a Java class file: its second word is a version, 45 or more
                return None
            wide = head[:4] == FAT[1]
            entry = head[8:8 + (32 if wide else 20)]
            if len(entry) < (32 if wide else 20):
                return None
            offset = struct.unpack(">Q", entry[8:16])[0] if wide else struct.unpack(">I", entry[8:12])[0]
            f.seek(offset)
            inner = f.read(16)
            if len(inner) < 16 or inner[:4] not in THIN:
                return None
            filetype = struct.unpack(THIN[inner[:4]] + "I", inner[12:16])[0]
            return "exe" if filetype == MH_EXECUTE else "lib"
    return None

found = {"exe": [], "lib": []}
for root in roots:
    walk = [(os.path.dirname(root), [], [os.path.basename(root)])] if os.path.isfile(root) else os.walk(root)
    for dirpath, _dirs, files in walk:
        for name in files:
            path = os.path.join(dirpath, name)
            if os.path.islink(path) or not os.path.isfile(path):
                continue
            k = kind(path)
            if k:
                found[k].append(path)
for k, out in (("exe", exe_out), ("lib", lib_out)):
    with open(out, "wb") as f:
        f.write(b"".join(os.fsencode(p) + b"\0" for p in sorted(found[k])))
print(f"Mach-O files: {len(found['exe'])} executables, {len(found['lib'])} libraries and extensions", file=sys.stderr)
PY

count() { tr -cd '\0' <"$1" | wc -c | tr -d ' '; }
if [ "$VERIFY" = 0 ]; then
  # libraries first, then the executables that load them
  if [ "$(count "$WORK/lib")" -gt 0 ]; then
    xargs -0 -n 64 codesign --force --timestamp --options runtime --sign "$IDENTITY" <"$WORK/lib"
  fi
  if [ "$(count "$WORK/exe")" -gt 0 ]; then
    xargs -0 -n 64 codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" <"$WORK/exe"
  fi
  echo "signed $(count "$WORK/lib") libraries and $(count "$WORK/exe") executables with the hardened runtime"
fi

# every signature, checked for the slice this Mac runs (a universal file's other slice is not loaded here)
arch="$(uname -m)"
bad=0
while IFS= read -r -d '' f; do
  if ! out="$(codesign --verify --strict --arch "$arch" "$f" 2>&1)"; then
    echo "invalid or missing signature: $f: $out" >&2
    bad=$((bad + 1))
  fi
done < <(cat "$WORK/lib" "$WORK/exe")
[ "$bad" = 0 ] || { echo "$bad Mach-O file(s) would not load on this Mac" >&2; exit 1; }
if [ "$VERIFY" = 0 ]; then
  # the hardened runtime is on every executable (notarisation refuses an executable without it)
  while IFS= read -r -d '' f; do
    codesign --display --verbose=2 "$f" 2>&1 | grep -q 'flags=.*runtime' || { echo "no hardened runtime on $f" >&2; exit 1; }
  done <"$WORK/exe"
fi
echo "every Mach-O signature is valid ($(count "$WORK/lib") libraries, $(count "$WORK/exe") executables)"
