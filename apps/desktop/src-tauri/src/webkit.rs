//! The `WebKitGTK` this process runs on: its version, where it came from, and the one small piece of FFI the host needs
//! to reach a preference the `webkit2gtk` crate has no binding for (ADR-0025).
//!
//! Three things live here:
//!
//! - **The version** (`Version`), read at run time from `libwebkit2gtk` itself, never from what the build linked
//!   against: the `AppImage` carries its own copy and a distribution upgrades the system one under a binary that was
//!   built earlier.
//! - **Where the library came from** (`Origin`): the `AppImage`'s bundled copy or the system's, read from the process's
//!   own memory map, so the diagnostics can say which one a report is about.
//! - **The feature API** (`FeatureApi`, `set_feature`): `webkit_settings_set_feature_enabled` and its siblings exist
//!   from `WebKitGTK` 2.42, and the `webkit2gtk` crate stops at 2.40. The logic that decides whether a call may be made
//!   at all (version, symbols, the feature's existence) is plain Rust behind a trait, tested without a display. The
//!   real implementation (`native`, Linux only) is the host's one `unsafe` block for this, and it resolves the
//!   symbols with `dlsym` at run time, so a `WebKitGTK` older than 2.42 starts the app and gets a refusal, not a
//!   "symbol lookup error" at load time.

use std::fmt;

use serde::Serialize;
use specta::Type;

/// A `WebKitGTK` release: `2.54.2` is `major 2, minor 54, micro 2`. Ordered the way releases are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Version {
    /// Always 2 for the GTK 3 API (`webkit2gtk-4.1`).
    pub major: u32,
    /// The release series; stable series are even (2.52, 2.54).
    pub minor: u32,
    /// The point release.
    pub micro: u32,
}

impl Version {
    /// A version from its three numbers.
    #[must_use]
    pub const fn new(major: u32, minor: u32, micro: u32) -> Self {
        Self {
            major,
            minor,
            micro,
        }
    }

    /// Parse `2.54.2`, `2.54` (micro 0) or a distribution's `2.54.2-1`: the leading numbers, stopping at the first
    /// character that is not a digit or a dot. Fewer than two numbers, or a number that does not fit, is `None`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let numeric: String = text
            .trim()
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        let mut parts = numeric.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let micro = match parts.next() {
            None | Some("") => 0,
            Some(m) => m.parse().ok()?,
        };
        Some(Self::new(major, minor, micro))
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.micro)
    }
}

/// The first release with `webkit_settings_get_all_features` and `webkit_settings_set_feature_enabled`.
pub const FEATURES_SINCE: Version = Version::new(2, 42, 0);

/// The first release with the GTK 3 explicit-sync fix for NVIDIA on Wayland (`WebKit` bug 324551; absent from 2.54.0 and
/// 2.54.1, present in 2.54.2 and 2.54.3; `docs/research/120hz.md` section 4.1).
pub const EXPLICIT_SYNC_FIXED: Version = Version::new(2, 54, 2);

/// Where the loaded `libwebkit2gtk` lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "WebkitOrigin")]
pub enum Origin {
    /// Inside the `AppImage`'s mount: the copy the release carries.
    Bundled,
    /// The system's: the distribution's package.
    System,
    /// No `libwebkit2gtk` in the memory map (not Linux, or the map could not be read).
    Unknown,
}

/// The `WebKitGTK` this process runs on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Info {
    /// The runtime version, when the library could be asked.
    pub version: Option<Version>,
    /// Bundled or the system's.
    pub origin: Origin,
    /// The path of the loaded library.
    pub library: Option<String>,
}

impl Info {
    /// Nothing known (the state on a platform without `WebKitGTK`, and in tests).
    #[must_use]
    pub const fn unknown() -> Self {
        Self {
            version: None,
            origin: Origin::Unknown,
            library: None,
        }
    }

    /// Whether this release has the explicit-sync fix. An unknown version is "no": nothing is assumed.
    #[must_use]
    pub fn has_explicit_sync_fix(&self) -> bool {
        self.version.is_some_and(|v| v >= EXPLICIT_SYNC_FIXED)
    }

    /// The part the diagnostics show.
    #[must_use]
    pub fn report(&self) -> Report {
        Report {
            version: self.version.map(|v| v.to_string()),
            origin: self.origin,
            library: self.library.clone(),
        }
    }
}

/// The `WebKitGTK` part of the diagnostics report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename = "WebkitReport")]
pub struct Report {
    /// `2.54.2`, or none when it could not be read.
    pub version: Option<String>,
    /// Bundled (`AppImage`) or the system's.
    pub origin: Origin,
    /// The path of the loaded `libwebkit2gtk`.
    pub library: Option<String>,
}

/// Which `libwebkit2gtk` a `/proc/self/maps` text names, and whether it is inside the `AppImage`'s mount (`appdir`, the
/// `APPDIR` variable the `AppImage` runtime sets). With no `APPDIR`, a path under a `/.mount_` directory is the `AppImage`'s
/// mount too (older runtimes).
#[must_use]
pub fn origin_from_maps(maps: &str, appdir: Option<&str>) -> (Origin, Option<String>) {
    let library = maps.lines().find_map(|line| {
        // `address perms offset dev inode path`: the path is the sixth field and may hold spaces.
        let path = line
            .split_whitespace()
            .skip(5)
            .collect::<Vec<_>>()
            .join(" ");
        let name = path.rsplit('/').next()?;
        name.starts_with("libwebkit2gtk-").then_some(path)
    });
    let Some(path) = library else {
        return (Origin::Unknown, None);
    };
    let inside = appdir.map(str::trim).filter(|d| !d.is_empty()).map_or_else(
        || path.contains("/.mount_"),
        |d| path.starts_with(d.trim_end_matches('/')),
    );
    (
        if inside {
            Origin::Bundled
        } else {
            Origin::System
        },
        Some(path),
    )
}

/// Read the version and origin of the `WebKitGTK` this process loaded. Linux only; elsewhere everything is unknown.
#[must_use]
pub fn probe() -> Info {
    #[cfg(target_os = "linux")]
    {
        let maps = std::fs::read_to_string("/proc/self/maps").unwrap_or_default();
        let appdir = std::env::var("APPDIR").ok();
        let (origin, library) = origin_from_maps(&maps, appdir.as_deref());
        Info {
            version: native::Live::detached().version(),
            origin,
            library,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        Info::unknown()
    }
}

/// The feature that makes `WebKit` render and run `requestAnimationFrame` at about 60 fps on a faster display. Its
/// identifier is the preference key without `Enabled` (`WebKitFeature.cpp`); it is `stable`, so the feature list has it.
pub const PREFER_NEAR_60_FPS: &str = "PreferPageRenderingUpdatesNear60FPS";

/// Why the feature API was not used. Every one is a refusal made before anything was called.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
#[serde(rename = "WebkitRefusal")]
pub enum Refusal {
    /// The runtime version could not be read, so the API's presence cannot be known.
    VersionUnknown,
    /// `WebKitGTK` older than 2.42: the functions do not exist.
    TooOld,
    /// A symbol the API needs is not in the loaded library (a build that left it out).
    SymbolsMissing,
    /// The feature list has no feature with that identifier.
    NoSuchFeature,
    /// The call ran and reading the feature back did not give the asked value.
    NotApplied,
    /// There is no web view to ask (not Linux, or no window yet).
    NoWebview,
}

/// What `webkit_settings_*_feature_*` offers, reduced to what the logic needs. The real implementation is `native::Live`;
/// the tests use a scripted one.
pub trait FeatureApi {
    /// The runtime version of the library.
    fn version(&self) -> Option<Version>;
    /// Whether every symbol the calls below need is present in the loaded library.
    fn symbols_present(&self) -> bool;
    /// The feature's current state, or `None` when the list has no such feature.
    fn feature_enabled(&self, identifier: &str) -> Option<bool>;
    /// Set the feature; `false` when it was not found (nothing was changed).
    fn set_feature_enabled(&self, identifier: &str, enabled: bool) -> bool;
}

/// Check that the feature API may be used at all: the version is known and is 2.42 or later, and the symbols exist.
fn guard<A: FeatureApi + ?Sized>(api: &A) -> Result<(), Refusal> {
    match api.version() {
        None => Err(Refusal::VersionUnknown),
        Some(v) if v < FEATURES_SINCE => Err(Refusal::TooOld),
        Some(_) if !api.symbols_present() => Err(Refusal::SymbolsMissing),
        Some(_) => Ok(()),
    }
}

/// The state of a feature, after the guards.
///
/// # Errors
/// The refusal that stopped the read.
pub fn read_feature<A: FeatureApi + ?Sized>(api: &A, identifier: &str) -> Result<bool, Refusal> {
    guard(api)?;
    api.feature_enabled(identifier)
        .ok_or(Refusal::NoSuchFeature)
}

/// Set a feature and read it back. Nothing is called until the version, the symbols and the feature's existence are
/// checked; a feature that already has the value is left alone.
///
/// # Errors
/// The refusal that stopped it, or `NotApplied` when the read-back disagrees.
pub fn set_feature<A: FeatureApi + ?Sized>(
    api: &A,
    identifier: &str,
    enabled: bool,
) -> Result<(), Refusal> {
    if read_feature(api, identifier)? == enabled {
        return Ok(());
    }
    if !api.set_feature_enabled(identifier, enabled) {
        return Err(Refusal::NoSuchFeature);
    }
    match api.feature_enabled(identifier) {
        Some(now) if now == enabled => Ok(()),
        _ => Err(Refusal::NotApplied),
    }
}

/// The real `FeatureApi`, over the loaded `libwebkit2gtk`. Linux only.
#[cfg(target_os = "linux")]
pub mod native {
    use std::ffi::{CStr, c_char, c_int, c_uint, c_void};
    use std::marker::PhantomData;

    use webkit2gtk::glib::translate::ToGlibPtr;

    use super::{FeatureApi, Version};

    /// What one native call asks for.
    enum Op<'a> {
        Version,
        Symbols,
        Get(&'a str),
        Set(&'a str, bool),
    }

    /// What it answered.
    enum Reply {
        NoSymbols,
        NotFound,
        Version(Version),
        Bool(bool),
    }

    /// The loaded library, with the settings object the feature calls act on (none for a version query).
    pub struct Live<'a> {
        settings: *mut c_void,
        _borrow: PhantomData<&'a webkit2gtk::Settings>,
    }

    impl Live<'static> {
        /// No settings object: enough to ask the version and whether the symbols exist.
        #[must_use]
        pub const fn detached() -> Self {
            Live {
                settings: std::ptr::null_mut(),
                _borrow: PhantomData,
            }
        }
    }

    impl<'a> Live<'a> {
        /// Act on `settings`, which must outlive the returned value (the borrow says so).
        #[must_use]
        pub fn for_settings(settings: &'a webkit2gtk::Settings) -> Self {
            let stash = ToGlibPtr::<*mut webkit2gtk::ffi::WebKitSettings>::to_glib_none(settings);
            Live {
                settings: stash.0.cast(),
                _borrow: PhantomData,
            }
        }

        /// The runtime version (`webkit_get_major_version` and its two siblings).
        #[must_use]
        pub fn version(&self) -> Option<Version> {
            match self.call(&Op::Version) {
                Reply::Version(v) => Some(v),
                _ => None,
            }
        }

        /// The only `unsafe` in the feature path: resolve the symbols by name, then make the one call asked for.
        #[allow(unsafe_code, clippy::too_many_lines)]
        fn call(&self, op: &Op<'_>) -> Reply {
            type GetVersion = unsafe extern "C" fn() -> c_uint;
            type AllFeatures = unsafe extern "C" fn() -> *mut c_void;
            type ListLength = unsafe extern "C" fn(*mut c_void) -> usize;
            type ListGet = unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void;
            type ListUnref = unsafe extern "C" fn(*mut c_void);
            type Identifier = unsafe extern "C" fn(*mut c_void) -> *const c_char;
            type SetEnabled = unsafe extern "C" fn(*mut c_void, *mut c_void, c_int);
            type GetEnabled = unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int;
            // SAFETY: every symbol is looked up in the already loaded libraries with `dlsym` and used only when it was
            // found, as the function type WebKitGTK documents for it (webkit_get_{major,minor,micro}_version, and
            // `webkit_settings_get_all_features`, `webkit_feature_list_{get_length,get,unref}`,
            // `webkit_feature_get_identifier`, `webkit_settings_{get,set}_feature_enabled`, all since 2.42). The
            // caller has checked the version before any feature call, and `settings` is a live `WebKitSettings`
            // (borrowed for `'a`) that is never null on the feature paths (checked below). The list returned by
            // `get_all_features` is owned by this call: its features are read while it is alive and it is unreffed
            // once, last. Identifiers are NUL-terminated C strings owned by their feature.
            unsafe {
                macro_rules! sym {
                    ($name:literal, $ty:ty) => {{
                        let p =
                            libc::dlsym(libc::RTLD_DEFAULT, concat!($name, "\0").as_ptr().cast());
                        if p.is_null() {
                            None
                        } else {
                            Some(std::mem::transmute::<*mut c_void, $ty>(p))
                        }
                    }};
                }
                if matches!(op, Op::Version) {
                    return match (
                        sym!("webkit_get_major_version", GetVersion),
                        sym!("webkit_get_minor_version", GetVersion),
                        sym!("webkit_get_micro_version", GetVersion),
                    ) {
                        (Some(major), Some(minor), Some(micro)) => {
                            Reply::Version(Version::new(major(), minor(), micro()))
                        }
                        _ => Reply::NoSymbols,
                    };
                }
                let (
                    Some(all),
                    Some(length),
                    Some(get),
                    Some(unref),
                    Some(identifier),
                    Some(set_enabled),
                    Some(get_enabled),
                ) = (
                    sym!("webkit_settings_get_all_features", AllFeatures),
                    sym!("webkit_feature_list_get_length", ListLength),
                    sym!("webkit_feature_list_get", ListGet),
                    sym!("webkit_feature_list_unref", ListUnref),
                    sym!("webkit_feature_get_identifier", Identifier),
                    sym!("webkit_settings_set_feature_enabled", SetEnabled),
                    sym!("webkit_settings_get_feature_enabled", GetEnabled),
                )
                else {
                    return Reply::NoSymbols;
                };
                let (Op::Get(wanted) | Op::Set(wanted, _)) = op else {
                    return Reply::Bool(true); // `Symbols`: all of them resolved
                };
                if self.settings.is_null() {
                    return Reply::NotFound;
                }
                let list = all();
                if list.is_null() {
                    return Reply::NotFound;
                }
                let mut reply = Reply::NotFound;
                for i in 0..length(list) {
                    let feature = get(list, i);
                    if feature.is_null() {
                        continue;
                    }
                    let name = identifier(feature);
                    if name.is_null() || CStr::from_ptr(name).to_bytes() != wanted.as_bytes() {
                        continue;
                    }
                    reply = match op {
                        Op::Set(_, enabled) => {
                            set_enabled(self.settings, feature, c_int::from(*enabled));
                            Reply::Bool(true)
                        }
                        _ => Reply::Bool(get_enabled(self.settings, feature) != 0),
                    };
                    break;
                }
                unref(list);
                reply
            }
        }
    }

    impl FeatureApi for Live<'_> {
        fn version(&self) -> Option<Version> {
            Live::version(self)
        }
        fn symbols_present(&self) -> bool {
            matches!(self.call(&Op::Symbols), Reply::Bool(true))
        }
        fn feature_enabled(&self, identifier: &str) -> Option<bool> {
            match self.call(&Op::Get(identifier)) {
                Reply::Bool(b) => Some(b),
                _ => None,
            }
        }
        fn set_feature_enabled(&self, identifier: &str, enabled: bool) -> bool {
            matches!(self.call(&Op::Set(identifier, enabled)), Reply::Bool(true))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    /// A scripted library: the version, whether the symbols are there, and which features exist and their values. It
    /// counts the calls so a test can see that a refusal made none.
    struct Script {
        version: Option<Version>,
        symbols: bool,
        features: RefCell<Vec<(&'static str, bool)>>,
        sets: Cell<u32>,
        /// A library whose set call does nothing (the read-back then disagrees).
        ignores_set: bool,
        reads: Cell<u32>,
    }

    impl Script {
        fn new(version: Option<Version>, symbols: bool, features: &[(&'static str, bool)]) -> Self {
            Self {
                version,
                symbols,
                features: RefCell::new(features.to_vec()),
                sets: Cell::new(0),
                ignores_set: false,
                reads: Cell::new(0),
            }
        }
        fn current() -> Self {
            Self::new(
                Some(Version::new(2, 54, 2)),
                true,
                &[("Other", true), (PREFER_NEAR_60_FPS, true)],
            )
        }
    }

    impl FeatureApi for Script {
        fn version(&self) -> Option<Version> {
            self.version
        }
        fn symbols_present(&self) -> bool {
            self.symbols
        }
        fn feature_enabled(&self, id: &str) -> Option<bool> {
            self.reads.set(self.reads.get() + 1);
            self.features
                .borrow()
                .iter()
                .find(|(n, _)| *n == id)
                .map(|(_, v)| *v)
        }
        fn set_feature_enabled(&self, id: &str, enabled: bool) -> bool {
            self.sets.set(self.sets.get() + 1);
            if self.ignores_set {
                return true;
            }
            self.features
                .borrow_mut()
                .iter_mut()
                .find(|(n, _)| *n == id)
                .map(|f| f.1 = enabled)
                .is_some()
        }
    }

    #[test]
    fn versions_parse_and_order_like_releases() {
        assert_eq!(Version::parse("2.54.2"), Some(Version::new(2, 54, 2)));
        assert_eq!(Version::parse(" 2.54.2\n"), Some(Version::new(2, 54, 2)));
        assert_eq!(Version::parse("2.54"), Some(Version::new(2, 54, 0)));
        assert_eq!(Version::parse("2.54."), Some(Version::new(2, 54, 0)));
        assert_eq!(Version::parse("2.54.2-1"), Some(Version::new(2, 54, 2)));
        assert_eq!(
            Version::parse("2.52.6-0ubuntu0.24.04.2"),
            Some(Version::new(2, 52, 6))
        );
        assert_eq!(Version::parse("2"), None);
        assert_eq!(Version::parse(""), None);
        assert_eq!(Version::parse("webkit"), None);
        assert_eq!(Version::parse("2.x.1"), None);
        assert_eq!(Version::parse("2.99999999999.1"), None);
        assert_eq!(Version::new(2, 54, 2).to_string(), "2.54.2");
        // 2.9 is older than 2.10 (numbers, not text), and the fix is exactly 2.54.2.
        assert!(Version::new(2, 9, 0) < Version::new(2, 10, 0));
        assert!(Version::new(2, 54, 1) < EXPLICIT_SYNC_FIXED);
        assert!(Version::new(2, 54, 2) >= EXPLICIT_SYNC_FIXED);
        assert!(Version::new(2, 54, 3) >= EXPLICIT_SYNC_FIXED);
        assert!(Version::new(2, 56, 0) >= EXPLICIT_SYNC_FIXED);
        assert!(Version::new(2, 52, 6) < EXPLICIT_SYNC_FIXED);
    }

    #[test]
    fn an_unknown_version_never_has_the_fix() {
        let mut i = Info::unknown();
        assert!(!i.has_explicit_sync_fix());
        i.version = Some(Version::new(2, 54, 1));
        assert!(!i.has_explicit_sync_fix());
        i.version = Some(Version::new(2, 54, 2));
        assert!(i.has_explicit_sync_fix());
        assert_eq!(i.report().version.as_deref(), Some("2.54.2"));
    }

    #[test]
    fn the_library_is_found_in_the_memory_map() {
        let system = "7f00-7f01 r--p 00000000 fd:01 123 /usr/lib/libgtk-3.so.0\n\
                      7f02-7f03 r-xp 00000000 fd:01 124 /usr/lib/libwebkit2gtk-4.1.so.0.18.5\n";
        assert_eq!(
            origin_from_maps(system, None),
            (
                Origin::System,
                Some("/usr/lib/libwebkit2gtk-4.1.so.0.18.5".into())
            )
        );
        assert_eq!(
            origin_from_maps(system, Some("/tmp/.mount_hypotaXyz")),
            (
                Origin::System,
                Some("/usr/lib/libwebkit2gtk-4.1.so.0.18.5".into())
            )
        );
        let bundled =
            "7f02-7f03 r-xp 0 fd:01 9 /tmp/.mount_hypotaXyz/usr/lib/libwebkit2gtk-4.1.so.0.18.5\n";
        assert_eq!(
            origin_from_maps(bundled, Some("/tmp/.mount_hypotaXyz")).0,
            Origin::Bundled
        );
        assert_eq!(
            origin_from_maps(bundled, Some("/tmp/.mount_hypotaXyz/")).0,
            Origin::Bundled
        );
        // An older runtime that sets no APPDIR still mounts under `/.mount_`.
        assert_eq!(origin_from_maps(bundled, None).0, Origin::Bundled);
        assert_eq!(origin_from_maps(bundled, Some("")).0, Origin::Bundled);
        // A path with spaces survives; no webkit line is unknown.
        let spaced = "7f02-7f03 r-xp 0 fd:01 9 /opt/my apps/libwebkit2gtk-4.1.so.0\n";
        assert_eq!(
            origin_from_maps(spaced, None),
            (
                Origin::System,
                Some("/opt/my apps/libwebkit2gtk-4.1.so.0".into())
            )
        );
        assert_eq!(origin_from_maps("", None), (Origin::Unknown, None));
        assert_eq!(
            origin_from_maps("7f00-7f01 r--p 0 fd:01 1 /usr/lib/libc.so.6\n", None),
            (Origin::Unknown, None)
        );
    }

    #[test]
    fn the_feature_is_set_when_everything_checks_out() {
        let api = Script::current();
        assert_eq!(set_feature(&api, PREFER_NEAR_60_FPS, false), Ok(()));
        assert_eq!(api.feature_enabled(PREFER_NEAR_60_FPS), Some(false));
        assert_eq!(
            api.feature_enabled("Other"),
            Some(true),
            "no other feature is touched"
        );
        assert_eq!(api.sets.get(), 1);
    }

    #[test]
    fn a_feature_that_already_has_the_value_is_left_alone() {
        let api = Script::new(
            Some(Version::new(2, 54, 2)),
            true,
            &[(PREFER_NEAR_60_FPS, false)],
        );
        assert_eq!(set_feature(&api, PREFER_NEAR_60_FPS, false), Ok(()));
        assert_eq!(api.sets.get(), 0);
    }

    #[test]
    fn the_api_refuses_before_calling_anything() {
        let old = Script::new(
            Some(Version::new(2, 40, 5)),
            true,
            &[(PREFER_NEAR_60_FPS, true)],
        );
        assert_eq!(
            set_feature(&old, PREFER_NEAR_60_FPS, false),
            Err(Refusal::TooOld)
        );
        assert_eq!(read_feature(&old, PREFER_NEAR_60_FPS), Err(Refusal::TooOld));
        let edge = Script::new(
            Some(Version::new(2, 41, 99)),
            true,
            &[(PREFER_NEAR_60_FPS, true)],
        );
        assert_eq!(
            set_feature(&edge, PREFER_NEAR_60_FPS, false),
            Err(Refusal::TooOld)
        );
        let unknown = Script::new(None, true, &[(PREFER_NEAR_60_FPS, true)]);
        assert_eq!(
            set_feature(&unknown, PREFER_NEAR_60_FPS, false),
            Err(Refusal::VersionUnknown)
        );
        let no_symbols = Script::new(
            Some(Version::new(2, 54, 2)),
            false,
            &[(PREFER_NEAR_60_FPS, true)],
        );
        assert_eq!(
            set_feature(&no_symbols, PREFER_NEAR_60_FPS, false),
            Err(Refusal::SymbolsMissing)
        );
        for api in [&old, &edge, &unknown, &no_symbols] {
            assert_eq!(api.reads.get(), 0, "a refused call reads nothing");
            assert_eq!(api.sets.get(), 0, "a refused call changes nothing");
        }
    }

    #[test]
    fn a_missing_feature_is_refused_and_nothing_is_set() {
        let api = Script::new(Some(Version::new(2, 54, 2)), true, &[("Other", true)]);
        assert_eq!(
            set_feature(&api, PREFER_NEAR_60_FPS, false),
            Err(Refusal::NoSuchFeature)
        );
        assert_eq!(api.sets.get(), 0);
        let none = Script::new(Some(Version::new(2, 54, 2)), true, &[]);
        assert_eq!(
            read_feature(&none, PREFER_NEAR_60_FPS),
            Err(Refusal::NoSuchFeature)
        );
    }

    #[test]
    fn a_call_that_did_not_take_is_reported_not_assumed() {
        let mut api = Script::current();
        api.ignores_set = true;
        assert_eq!(
            set_feature(&api, PREFER_NEAR_60_FPS, false),
            Err(Refusal::NotApplied)
        );
        assert_eq!(api.sets.get(), 1);
    }

    /// The real library is not loaded in a unit test that has no window, but the symbol lookup itself runs anywhere
    /// `libwebkit2gtk` is linked: with no settings object it must refuse a feature call, not crash.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_native_wrapper_without_settings_refuses_feature_calls() {
        let live = native::Live::detached();
        assert_eq!(live.feature_enabled(PREFER_NEAR_60_FPS), None);
        assert!(!live.set_feature_enabled(PREFER_NEAR_60_FPS, false));
        // A version, when the library answers, is a 2.x release.
        if let Some(v) = live.version() {
            assert_eq!(v.major, 2);
        }
    }
}
