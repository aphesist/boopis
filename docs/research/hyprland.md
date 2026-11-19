# Agent control of desktop apps on Hyprland (Arch)

Researched 2026-11-19. Labels: **[V]** read in a source (URL or file:line given), **[V2]** read, but in a secondary or third-party source (still a real page, not Hyprland/Cua's own docs), **[I]** my inference, **[?]** not verified.
Caveat on method: pages were read through a fetch tool that summarises; wiki.hypr.land pages are huge (sidebar ~100k chars), so quotes come from chunked reads. Several GitHub/Gitea/Anubis-protected pages were blocked (grim's repo, Arch wiki, the wiki's own `.md` source, `HyprCtl.cpp`). Where a claim rests on a snippet rather than a full page it is marked.
Current versions seen: Hyprland **v0.57.2 (09 Nov 2026)**, v0.57.0 (28 Oct) [V: github.com/hyprwm/Hyprland/releases]. xdph **v1.5.0 (28 Oct; year not shown on the page, 2026 by [I] from PR dates)** [V: github.com/hyprwm/xdg-desktop-portal-hyprland/releases].

---
## 1. xdg-desktop-portal-hyprland (xdph)

| Interface | State | Evidence |
|---|---|---|
| Screenshot | Implemented | `src/portals/Screenshot.cpp` [V: github.com/hyprwm/xdg-desktop-portal-hyprland/tree/master/src/portals] |
| ScreenCast | Implemented (file `Screencopy.cpp`, `WorkspaceCapture.cpp`); v1.5.0 added "workspace sharing support" and a picker rewritten on hyprtoolkit | same tree; [V: releases/tag/v1.5.0] |
| GlobalShortcuts | Implemented (`GlobalShortcuts.cpp`; v1.4.0 "race-safe session lifetimes" #397) | [V: tree; releases] |
| InputCapture | Implemented since **v1.4.0 (18 Jul)**: "Implement Input Capture Desktop Portal" #268, merged 14 Jul 2026; talks to Hyprland's `hyprland-input-capture-v1` protocol; `ConnectToEIS` hands an EIS fd to the client; one `//TODO` about pointer warping on release | [V: releases; PR search; blob/master/src/portals/InputCapture.cpp] |
| **RemoteDesktop** | **Not in a release.** No `RemoteDesktop.cpp` in the `src/portals` listing (listing had a "View all files" link, so [V] for what was shown, not a full proof) | [V: tree]; hypruse's README states it flatly: "xdg-desktop-portal-hyprland does not implement the RemoteDesktop portal" [V2: pypi.org/project/hypruse/] |

RemoteDesktop / libei status, all in the xdph repo [V: github.com/hyprwm/xdg-desktop-portal-hyprland/issues?q=RemoteDesktop and /pulls?q=RemoteDesktop]:
- Issue #252 "Support for org.freedesktop.portal.RemoteDesktop?" open since 26 Aug 2024.
- #308 "Implement remote desktop portal" (draft, opened 21 Dec 2024, still open).
- #402 "portals/remotedesktop: add RemoteDesktop portal with ConnectToEIS support" open since 29 May 2026. Backend for wlroots-style compositors; injects through `wlr-virtual-pointer` and `virtual-keyboard`, runs a libei EIS server, adds the Notify* D-Bus methods. Maintainer vaxerski asked for libeis in the Nix inputs and for an AI-usage disclosure; no approval or merge shown [V: pull/402].
- #426 (draft) closed 30 Oct 2026; #428 "revive portal implementation" open.
- **#448 "Fundamental remotedesktop portal"** (keitheis) open, ready for review 1 Nov 2026, new commits 17 Nov 2026. Implements session lifecycle, SelectDevices, Start, Notify* incl. absolute pointer, `ConnectToEIS`, virtual pointer/keyboard via the wlr protocols, an explicit consent prompt, opt-in persistent authorization scoped to app and devices, restore tokens validated per app, compositor keymap, combined RemoteDesktop+ScreenCast sessions. One approval shown, not from a maintainer with merge weight; not merged [V: pull/448].
- #449 "inputcapture: hand the EIS fd over instead of duplicating it" merged 1 Nov 2026 [V: PR search page].
- A Deskflow thread of 7 Nov 2026 says Hyprland "still lacks a usable RemoteDesktop ConnectToEIS path"; workaround is routing RemoteDesktop to xdg-desktop-portal-luminous [V2: github.com/deskflow/deskflow/discussions/7499].
- [I] **Conclusion: on current releases, the "portal RemoteDesktop with persist_mode=2" route in AUTOMATION.md section 13 does not exist on Hyprland.** It could arrive if #448 merges; no date.
- [?] Whether v1.5.0's ScreenCast supports `persist_mode`/restore tokens: not verified.

## 2. Input-injection protocols and the permission system

**Protocol support** (wayland.app compositor tables list Hyprland 0.52.1):
- `zwp_virtual_keyboard_manager_v1`: supported [V2: wayland.app/protocols/virtual-keyboard-unstable-v1]. (KWin and Mutter are marked unsupported there.)
- `zwlr_virtual_pointer_manager_v1`: supported, version 2 [V2: wayland.app/protocols/wlr-virtual-pointer-unstable-v1].
- So wtype (virtual keyboard) and wlrctl or a pointer helper (virtual pointer) work on Hyprland. Both Hermes catalog plugins rely on this (section 8).
- Known multi-monitor bug in absolute virtual-pointer motion, issue #6749 (closed, milestone 0.42, opened 3 Jul 2024) [V: github.com/hyprwm/Hyprland/issues/6749; body truncated]. hypruse avoids absolute motion: it moves the cursor with a compositor dispatcher and sends only buttons and axes through the virtual pointer [V2: github.com/IlyasKhallouki/hypruse].

**Permission system**
- Arrived in **Hyprland 0.49.0** (release 8 May 2025), "disabled by default for now" [V: hypr.land/news/update49 for the date and the default; the "0.49" attribution to the permission feature is [V2] linuxiac and the wiki 0.49 page existing; no 0.48 page exists (404)].
- Enabling: `ecosystem:enforce_permissions = true`, "disabled by default"; rules are not reloaded live, a restart is required "for security reasons" [V: wiki.hypr.land/0.49.0/Configuring/Permissions/ and 0.50.0].
- Needs `hyprland-qtutils` (0.49/0.50 docs) and now `hyprland-guiutils` (current docs) for the popups [V].
- Legacy (hyprlang) syntax [V: wiki.hypr.land/0.50.0/Configuring/Permissions/]:
  ```
  ecosystem { enforce_permissions = true }
  permission = regex, permission, mode
  permission = /usr/bin/grim, screencopy, allow
  permission = /usr/(lib|libexec|lib64)/xdg-desktop-portal-hyprland, screencopy, allow
  ```
- Current docs use Lua (hyprlang deprecated since 0.55 per the wiki; see wiki.hypr.land variables page) [V: wiki.hypr.land/configuring/core/advanced-configuration/permissions/]:
  `hl.permission({ binary = "/usr/bin/grim", type = "screencopy", mode = "allow" })` and `hl.config({ ecosystem = { enforce_permissions = true } })` [the second form is from a search snippet, [V2]].
- Modes: `allow`, `ask` (popup: Deny, Allow until the app exits, Allow until Hyprland exits), `deny` [V].
- **Types, current wiki** [V]: `screencopy` (default ASK; "access to your screen without going through xdg-desktop-portal-hyprland", e.g. grim, wf-recorder; denied = black frame with "permission denied"), `plugin` (default ASK; loading a plugin, regex on binary or plugin path; warns not to let hyprctl load plugins by default), `keyboard` (default **ALLOW**; "connecting a new keyboard", regex on the **device name**; "Why deny? Rubber duckies, malicious virtual / usb keyboards"), `cursorpos` (default ASK; cursor position and image via Wayland protocols), `input-capture` (default ASK; capture all input events). The 0.50 wiki listed only screencopy, plugin, keyboard.
- Notes [V]: portals including xdph are ordinary apps and go through permissions too; the wiki tip says anyone who cares about permissions should also block access to Hyprland's IPC sockets, and "Hyprland itself cannot enforce this" (sandbox job).
- **Not gated** [V by absence from the type list; the inference is [I]]: **virtual pointer** (`zwlr_virtual_pointer`), `hyprctl dispatch`/IPC, XWayland/XTest, `/dev/uinput`. Virtual **keyboard** is only gated by the `keyboard` device-name rule, whose default is ALLOW, so wtype is not gated by default; a `.*` deny rule would block it but also blocks everything not listed, and cannot name a binary [I].
- [I] Net: Hyprland's permissions protect *capture* (grim, wf-recorder), *plugins*, and *cursor read*. They do not give a per-app "may inject input" consent. boopis must own that consent.

## 3. Screen capture

- `wlr-screencopy-unstable-v1`: supported, version 3 [V2: wayland.app/protocols/wlr-screencopy-unstable-v1]. Gated by the `screencopy` permission [V].
- `ext-image-copy-capture-v1` + `ext-image-capture-source-v1`: **added in Hyprland v0.54.0** ("protocols: implement image-capture-source-v1 and image-copy-capture-v1", #11709) [V2: newreleases.io/project/github/hyprwm/Hyprland/release/v0.54.0]; wayland.app's 0.52.1 table correctly shows "x" (unsupported) [V2]. `ext-foreign-toplevel-list-v1` was present by 0.52.1 [V2 via search]. [?] Whether Hyprland also implements `ext-foreign-toplevel-image-capture-source-manager-v1` (per-window source for the ext protocol): not confirmed.
- `hyprland-toplevel-export-v1`: Hyprland-only, protocol version 2; `capture_toplevel(handle)` takes the window address as shown by `hyprctl clients`; v2 also accepts a `zwlr_foreign_toplevel_handle_v1`. Excludes server-side decorations and rounded corners; copies wait for damage unless `ignore_damage` [V: wayland.app/protocols/hyprland-toplevel-export-v1].
- **grim**: man page [V: man.archlinux.org/man/grim.1]: `-o <output>` (one monitor), `-g "x,y WxH"` (layout coordinates), `-T <identifier>` ("foreign toplevel handle" = one window). "For now it requires support for the screencopy protocol". hypruse says window capture works with **grim 1.5+ on Hyprland 0.54+**, even for a window on a hidden workspace or under another window, but a hidden window's pixels may be stale because many apps stop drawing [V2: hypruse README].
- **hyprshot**: GPL-3.0 wrapper over grim, slurp, jq, wl-clipboard, libnotify; modes window/output/region; no releases listed [V2: github.com/Gustash/Hyprshot]. [?] I could not open the official hyprwm hyprshot repo.
- xdph ScreenCast is the sanctioned route (user picker dialog); v1.5.0 adds workspace sharing [V].

## 4. hyprctl IPC

- Sockets: `$XDG_RUNTIME_DIR/hypr/[HIS]/.socket.sock` (requests, form `[flags]/command args`; open, write, close at once, because an unclosed connection blocks Hyprland up to 5 s) and `.socket2.sock` (events `EVENT>>DATA`: `workspacev2`, `focusedmon`, `activewindowv2`, ...) [V: wiki.hypr.land/IPC/]. `HIS` = `HYPRLAND_INSTANCE_SIGNATURE`; `hyprctl -i` selects an instance; `-j` = JSON [V: Using hyprctl].
- Calls are synchronous: "any spam of the utility will cause slowdowns" [V].
- `hyprctl clients -j` fields, per hyprland-rs's `Client` struct [V2: docs.rs/hyprland/latest/hyprland/data/struct.Client.html; I could not open Hyprland's own `HyprCtl.cpp`]: `address`, `at` (window location, pair), `size`, `workspace` (id+name), `floating`, `fullscreen`, `monitor`, `class`, `initialClass`, `title`, `initialTitle`, `pid`, `xwayland`, `pinned`, `mapped`, `grouped`, `swallowing`, `focusHistoryID`. [?] Whether `at` is global layout coordinates or monitor-relative is not stated there; Hyprland's `monitors` entries carry `x,y` so global is the natural reading [I].
- Dispatchers [V: wiki.hypr.land/0.49.0/Configuring/Dispatchers/]: `exec` ("supports rules"; `bind = SUPER, E, exec, [workspace 2 silent; float; move 0 0] kitty`; "records the PID of the spawned process"; a process that forks then opens the window will not match), `focuswindow` (first window matching), `movetoworkspace` / `movetoworkspacesilent` (workspace or `workspace,window`), `movewindowpixel`, `resizewindowpixel`, `sendshortcut mod,key[,window]` ("sends specified keys to an optionally specified window"). Window selectors: class regex, `class:`, `pid:`, `address:`, `activewindow`.
- **Syntax is moving.** The current wiki shows Lua dispatch: `hyprctl dispatch 'hl.dsp.focus({ workspace = "3" })'` [V: Using hyprctl, current]. Old names above are from the 0.49 page. [?] Exact Lua equivalents and whether `hyprctl dispatch movetoworkspacesilent ...` still works on 0.57 were not checked. Pin a Hyprland version in tests.
- AT-SPI + hyprctl → global coordinates: hypruse does this ("uses window-relative extents plus the window position it gets from hyprctl") and says AT-SPI screen coordinates are unreliable on Wayland [V2: hypruse README]. **That it gives *exact* coordinates is [I]**: fractional scale, decorations/borders/gaps, CSD shadows, XWayland offsets, and GTK4 extents bugs (from earlier research) can all shift it; needs a calibration spike (click a known button, compare).

## 5. Headless outputs (the agent-owned screen)

- **Create/remove** [V: wiki.hypr.land/configuring/core/advanced-configuration/using-hyprctl/]: `hyprctl output create [backend] (name)` / `hyprctl output remove [name]`; "headless: Creates a headless monitor output. If you're running a VNC/RDP/Sunshine server, you should use this." Default names look like `HEADLESS-2`, `WL-1`. Real displays cannot be removed. So it is **documented, supported** by the project for remote-display use.
- **Workspace binding** [V: 0.49 Workspace Rules]: `monitor:` "Binds a workspace to a monitor" (name or `desc:`), plus `default:` and `persistent:`. A Sunshine setup pins workspace 11 to the headless output and sets the mode with `hyprctl keyword monitor "$HEADLESS,1920x1080@60,9999x0,1"` [V2: github.com/jhonsnake/sunshine-hyprland-virtual-display]. A ghost-monitor wayvnc script uses `HEADLESS-2` + workspace 3 [V2: github.com/Zellington3/Ghost-Monitor-Wayvnc-Hyprland].
- **Launch with no window on user screens**: the exec rule `[workspace N silent] cmd` [V], or `movetoworkspacesilent` with `pid:` after the window appears (used in a headless-browser-screenshot gist) [V2: gist.github.com/dougvk/e0fb18de87b11a9f58cf991ed6e95618]. [I] The exec rule is the one that avoids a flash on the user's workspace, but it is PID-based and fails on forking launchers; the silent move is a fallback with a possible visible flicker. Neither was tested.
- **Capture**: `grim -o <HEADLESS-N>` is used with that gist [V2]; grim's `-o` is documented [V]. Works as a normal output [I].
- **Input only to it: not verified, and probably no.** One seat, one cursor, one keyboard focus: "There is one cursor and one keyboard focus" [V2: hypruse README]. Virtual keyboard/pointer events go to whatever is focused/under the cursor; to type into a window on the headless output the agent must focus it, which moves the user's keyboard focus [I]. Pointer must be warped onto the headless output [I]. hypruse's answer is not isolation: it uses AT-SPI actions plus `sendshortcut` and refuses coordinate pointer actions in the background [V2]. Hyprland's multi-seat support: [?] not found. Cua's Hyprland plugin adds two extra "agent seats" (section 7), which is the one real isolation mechanism found.
- **Limits reported**: Hyprland does not exec anything when no monitor exists, so the output must exist first; names increment (HEADLESS-1 vs -2) so look it up with `hyprctl monitors -j` [V2: forum.hypr.land/t/remote-desktop-with-hyprland/270; zerodya gist]; Sunshine caches the output name if started earlier; frozen black frame after S3 resume; a Lua-config path is "experimental" for workspace placement [V2: jhonsnake repo]. hypruse notes aquamarine needs a real GPU render node to run headless CI [V2]. Outputs vanish with the Hyprland instance [I].
- [I] **Verdict**: a headless output + pinned workspace gives a *visual* agent screen (capturable, nothing on the user's monitors). It does **not** give *input* isolation on a single seat. Use it for observation plus AT-SPI element actions; pixel input into it needs focus changes unless cua's plugin seats are used. A stronger boundary is a nested compositor session (Cua lists a `cua-compositor` as experimental [V2: cua.ai/docs/concepts/linux-desktops-and-computer-use]; others are [?]).

## 6. AT-SPI on Hyprland

- Hyprland ships no a11y bus; the bus comes from `at-spi2-core` + a session D-Bus [I]. Hermes docs say AT-SPI "default on GNOME/KDE/Xfce", which omits Hyprland [V: hermes `website/docs/user-guide/features/computer-use.md:108`]. hypruse lists `at-spi2-core` as an optional dependency [V2]. Cua's Omarchy walkthrough drove Inkscape through it on Hyprland [V2: starryhope.com/linux/omarchy-cua-driver/]. [?] Whether a plain Arch + Hyprland install starts the registry daemon without extra setup was not verified; treat as "works if `at-spi2-core` is installed and the session bus is exported to the agent" [I]. Pitfall seen: an agent launched by Codex lacked `WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, `HYPRLAND_INSTANCE_SIGNATURE`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP`, `DISPLAY`, and reported "not a Wayland session" [V2: starryhope].
- Chromium/Electron: accessibility is "off by default and enabled automatically on-demand" and `--force-renderer-accessibility[=basic|form-controls|complete]` forces it on [V: chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility/overview.md]. On Omarchy hypruse says Chromium, web apps and Obsidian build the tree "only when asked": put `--force-renderer-accessibility` on its own line in `~/.config/chromium-flags.conf` [V2: hypruse README]. Electron: `app.setAccessibilitySupportEnabled()`; system assistive tools take priority [V: electronjs.org/docs/latest/tutorial/accessibility; no Linux flag documented there]. [?] No source states which Ozone flags (`--ozone-platform=wayland`) the AT-SPI tree needs; no Ozone-specific accessibility claim is verified. Cua says Chromium/Electron "bind only the user's seat" on Hyprland, so use browser tools for pages [V2: Cua platform page].
- XWayland: `xwayland { enabled }` default **true** ("allow running applications using X11") [V: wiki.hypr.land/0.54.0/Configuring/Variables/]. [?] Current (0.57, Lua) default was not re-read; Arch needs `xorg-xwayland` installed for it to run [I].

## 7. cua-driver on Hyprland

- **Cua documents Hyprland** [V2: cua.ai/docs/concepts/linux-desktops-and-computer-use; I read a summarising fetch, not raw HTML]: "Hyprland/Omarchy: Experimental. Qualified isolated input since 0.24.0. Does not inherit Sway coverage." "Modern Hyprland is not wlroots, so Sway results do not carry over." Native Wayland is **off by default**; `CUA_DRIVER_RS_ENABLE_WAYLAND=1` enables it, else Wayland sessions use XWayland for apps with an X11 window. An **optional, off-by-default Hyprland plugin** adds **two agent seats** for isolated background input: Qt 6 apps accept background clicks, scrolls, drags but not keys; Chromium and Electron bind only the user's seat; not covered: XWayland raw input, Unicode/IME, multiple layouts, modified pointer gestures. Foreground actions on Hyprland change focus and the pointer and do not restore them.
- Linux getting-started requires "X11 or XWayland, with AT-SPI 2" and says "native Wayland depends on the compositor" [V2: cua.ai/docs/cua-driver/guide/getting-started/linux]. Cua's `explanation/linux-and-wayland` page names only Sway, GNOME, KDE and does not mention Hyprland [V2].
- Field report (third party, 19 Oct 2026, Omarchy, Hyprland 0.56.2-4, cua-driver 0.33.4, `cua-hyprland-plugin` 0.33.2): plugin loaded with `hyprctl plugin load`, only in Omarchy's Edge repo, **pins exact Hyprland and ten other package versions**; setting `plugin.cua.enabled` in a Lua file (not `hyprctl eval`) turned it on; check with `hyprctl -j cua:status`; background input worked in Inkscape, was refused in Chromium (`background_unavailable (client_not_qualified)`); the agent cursor is drawn over the whole screen incl. other workspaces; "Try it on a spare machine" [V2: starryhope.com/linux/omarchy-cua-driver/].
- [I] Loading that plugin goes through Hyprland's `plugin` permission (default ASK) [V: wiki permission list], a real compositor-owned consent step.
- **What Hermes sets** [V: `tools/computer_use/cua_backend.py:35` `_CUA_NATIVE_WAYLAND_ENV_VAR = "CUA_DRIVER_RS_ENABLE_WAYLAND"`; `:156-157`]: if `sys.platform == "linux"` and `WAYLAND_DISPLAY` is set and `computer_use.native_wayland` is true, the child env gets `CUA_DRIVER_RS_ENABLE_WAYLAND=1`. Nothing compositor-specific, so it applies equally on Hyprland [V by code reading; the effect inside the driver is [?]]. Hermes docs: capture on pure Wayland needs an XWayland bridge; "cua-driver's Wayland inject path handles input independently" [V: `computer-use.md:108, 477-478`]. Doctor only reports the CLI process env on Wayland [V: `doctor.py:387-391`].
- **Version gap** [I from V]: Hermes pins `cua-driver-rs-v0.21.0` (`pm/lock.json:73-96`); Cua's Hyprland qualified input is "since 0.24.0" [V2], and the field report used 0.33.4. So Hermes's pinned driver predates documented Hyprland support. Using it needs `HERMES_CUA_DRIVER_CMD` pointing at a newer driver (documented, `computer-use.md` ~line 506) [V], or a bump of the pin.
- [?] Which capture path (wlr-screencopy, ext-image-copy-capture, portal) the Hyprland path of cua uses is not stated in anything I could open.
- **Hermes already has two Hyprland providers** (selected via `computer_use.backend`; `hermes_cli/tools_config_providers.py:139,729`): `plugin-catalog/hypruse.yaml` (hypruse 0.13+, AT-SPI + background workspaces; known issues: no `set_value`, pointer never in background, no launch action, not under `plugins.isolation: host`) and `plugin-catalog/hyprland.yaml` (mddragon18/hyprland-computer-use 0.3.0: grim + wlr-virtual-pointer helper built locally + wtype, window-scoped target enforcement, no AT-SPI) [V: local files, `requires_hermes >=0.23.0`]. This changes the plan: **no new MCP server is needed on Hyprland; a Hermes backend exists.**

## 8. Existing tools and MCP servers (only ones opened)

| Project | Licence | Last activity seen | Tools / approach | Maturity |
|---|---|---|---|---|
| **hypruse** (github.com/IlyasKhallouki/hypruse; PyPI `hypruse` 0.15.1) | MIT | PyPI release **15 Nov 2026** [V2]; 68 stars, 265 commits | `desktop, screenshot, zoom, ui, marks, click_ui, pointer, keyboard, hypr, launch, binds, use_bind, sequence, wait_for, clipboard`. hyprctl + grim + AT-SPI + wtype + `zwlr_virtual_pointer`; no portals, no root, no uinput. Background mode on workspaces 99..90; read-only mode; confinement; strict mode; auth-dialog guard; Waybar beacon; panic key `hypruse stop`; stdio only. No headless mode | Most complete; active; one maintainer. Forks exist (mateuszruszkowski/hypruse, 0 stars, 181 commits, labelled a fork of IlyasKhallouki's; a search snippet called the Ruszkowski copy original: **ownership is unclear [?]**) |
| **hypr-cua-mcp** (PyPI 0.2.0; github.com/Smirnov-Labs/hypr-computer-use-mcp) | MIT | **6 Nov 2026** [V2] | Windows/outputs/screenshots (grim), click/drag/type/keys, clipboard, dispatchers, tmux, Chrome DevTools. Input through own **uinput** device (needs `/dev/uinput`); "no sandbox on Wayland"; focus is pointer-follows, typing refused if focus unverifiable; US-ASCII only | Early (0.2.0). Uses the path AUTOMATION.md rejects (uinput) |
| zenodea/hyprland-mcp | MIT | no date; 16 commits, 0 stars | Go binary; windows, workspaces, monitors, audio, network, BT, clipboard, recording; screenshot via grim; opt-in `input`: `type_text`, `send_shortcut`, `move_cursor`; "clicking isn't supported" | Hobby |
| keanehatescoding/hyprland-mcp | licence not shown | no date; 75 commits, 0 stars | Windows, workspaces, monitors, screenshots (grim/slurp), cursor move, raw dispatch/exec, hyprsunset etc.; no typing or click; security note that `unlock_screen` bypasses authentication | Hobby |
| 0aaryan/hypr-tools | MIT | 1 commit, 0 stars | 178 tools in 30 categories (incl. `write_file`, `kill_app`, `lock_screen`); no input tools; no permission model | Not suitable |
| mddragon18/hyprland-computer-use | MIT | 6 commits, 0 stars | Hermes provider: grim + wlr-virtual-pointer helper (C, build locally) + wtype + hyprctl; clicks outside the captured window refused (`target_mismatch`) | Tiny but already catalogued by Hermes |
| wtype, wlrctl, ydotool | not opened | n/a | n/a | [?] not opened as primary sources; wtype/wlrctl protocol basis is in section 2 |
(Several others surfaced in search results and were not opened: hyprcu, hyprmcp, agentd, AgentSeat. hyprcu's GitHub page returned 404.)

---
## Recommended route on Hyprland

Principle (carries over from AUTOMATION.md): element actions first; pixels only where needed; nothing the compositor does not already gate may be assumed to be consented to. On Hyprland, **the compositor gates capture, plugins and cursor-read, but not input and not IPC**, so boopis's own grant card is the main consent, and the compositor adds one layer for capture.

**Perception (what is on screen)**
1. `hyprctl clients -j` / `monitors -j` / `workspaces -j` for window list, class, pid, workspace and global geometry. Consent: none from Hyprland (IPC is unguarded [V]); it is boopis's `desktop.observe` grant. Sandbox consideration: the IPC socket also allows `dispatch exec`, so do not hand it raw to the agent.
2. AT-SPI tree through cua-driver or hypruse (`ui`). Consent: boopis per-app `desktop.observe`; none from the desktop (the a11y bus has no consent layer [I]). Requires `at-spi2-core`, session env passed through, `--force-renderer-accessibility` for Chromium/Electron.
3. Screenshots, see Capture.

**Element actions (click/set by name, no pixels)**
1. hypruse `click_ui` or cua AT-SPI actions. Work in the background, do not touch the user's cursor or focus [V2]. Consent: boopis per-app `desktop.act` card. No compositor consent exists or is needed. This is the best-supported route and fits the existing grant model.
2. Hermes already has the `hypruse` backend; selecting it costs a config line, not a server. Compare with cua's AT-SPI path after bumping cua's pin (spike).

**Pixel input (coordinates and raw keys)**
1. **X11/XWayland apps via cua** (XTest). Consent: boopis `desktop.display`/`desktop.act`. Works when `xwayland.enabled` and the app runs under X [V for default, I for effect].
2. **wlr virtual pointer + wtype (hypruse / mddragon18 provider)**. Works today on Hyprland [V]; foreground only, shared seat, steals focus unless the window is already focused [V2]. Consent: boopis only (neither protocol is permission-gated; `keyboard` is allow by default [V]). Treat as high-impact and per-task, with the "do not type while the agent drives" warning shown on the card.
3. **cua's Hyprland plugin (agent seats)**: the only isolated pixel-input path found; experimental, Qt 6 only for keys, version-pinned to an exact Hyprland build, off by default [V2]. Consent: Hyprland's `plugin` permission popup when it is loaded [V], plus the plugin's enable flag, plus boopis's grant. Not suitable as default now.
4. **Portal RemoteDesktop**: not available (section 1); revisit if xdph PR #448 merges. Its design (consent prompt, per-app persistent tokens) matches what we want, and it would reuse the same wlr protocols underneath.
5. Not recommended: uinput (`ydotool`, `hypr-cua-mcp`): bypasses the compositor, needs `/dev/uinput`.

**Capture**
1. `grim -T <toplevel>` (window) or `-o <output>`, grim 1.5+ with Hyprland 0.54+ for window capture [V/V2]. Consent: **Hyprland `screencopy` permission** (ASK popup, or an `allow` rule for exactly the binary the harness spawns; `deny` for everything else), which requires `enforce_permissions = true` and a Hyprland restart to configure [V]. Layer boopis's `desktop.observe`/`desktop.display` grant on top. Note: hidden-window frames can be stale [V2].
2. xdph ScreenCast / Screenshot portal: user picker dialog each time (persistence [?]). Use for "whole screen" grants. Needs a `screencopy allow` rule for the xdph binary if default is deny [V].
3. cua's X11 capture of XWayland windows (no Wayland consent involved; [I]).

**Agent-owned screen**
1. Headless output (`hyprctl output create headless <name>`) + pinned workspace (`workspace` rule with `monitor:`) + `exec [workspace N silent]` launch + `grim -o` capture. Gives a screen the user never sees. **Perception and element actions work there; pixel input does not stay isolated on one seat** (section 5). Consent: boopis's grant ("this task gets its own screen"); capture of that output still passes the `screencopy` rule; no Hyprland dialog for creating an output [I: the permission list has no such type].
2. hypruse background workspaces (99..90) are the same idea without a headless output: windows stay on the user's monitors' workspace list but are hidden [V2]. Cheaper to run; weaker "screen" boundary (capture of hidden windows can be stale).
3. Nested compositor or separate session as a true boundary: [?] not verified for Hyprland; Hermes Bot Screen (Xvnc) already exists for servers [V: earlier research].
Spike needed: whether `exec` rules + headless pinned workspace keep a window off the user's monitors with no flicker; whether `movecursor` onto the headless output is allowed; and whether focus can be shifted without moving the user's cursor.

**Overall ranking**: (1) hyprctl + AT-SPI perception and AT-SPI element actions through hypruse (already a Hermes backend) or cua after a driver bump; (2) grim with a narrow `screencopy` permission rule; (3) headless output as a view-only/element-actions screen; (4) XWayland XTest for pixel work; (5) wlr virtual pointer/wtype as an explicit, high-impact foreground grant; (6) Cua plugin seats as an experiment; (7) RemoteDesktop portal when it exists.

## Unverified / open
- Whether a bare Arch+Hyprland session runs the AT-SPI registry without extra packages; any Ozone-specific accessibility requirement; GTK/Qt accessibility env flags.
- `hyprctl clients -j` field semantics from Hyprland's own source (I only had hyprland-rs's struct); whether `at` is global; exact AT-SPI + hyprctl coordinate error.
- Lua-era (0.55+) equivalents of dispatchers and exec rules; XWayland default on 0.57.
- Which capture path cua-driver uses on Hyprland; whether Hermes-pinned cua 0.21.0 does anything useful with `CUA_DRIVER_RS_ENABLE_WAYLAND` on Hyprland.
- Whether xdph ScreenCast v1.5.0 offers persistent restore tokens; whether Hyprland supports `ext-foreign-toplevel-image-capture-source-manager-v1`.
- Input isolation on a headless output; Hyprland multi-seat; headless output behaviour on Hyprland restarts and no-GPU hosts.
- Several project licences/last-commit dates not shown on the pages (keanehatescoding, zenodea last activity). hypruse repo ownership. Official hyprwm/hyprshot, wtype and wlrctl pages were not opened.
