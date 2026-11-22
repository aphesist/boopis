//! Why a source could not be read, in plain words (`docs/STORE.md` 5.3). A source row says either how many items it holds and
//! when it was read, or one of these: what happened and what to do, never a transport error, a status number, JSON or the
//! engine's name. What the source or the transport actually said is kept for Diagnostics (`error::keep`).

use super::net::retry_after_s;
use super::types::{SourceFetch, StoreSource};
use crate::error::Error;

/// Where a source is read from, as the row says it: the host for the network sources, the engine for the ones read through it.
/// The engine's own catalogue is named by what it is, because its address carries the engine's name (ADR-0031).
#[must_use]
pub fn place(s: &StoreSource) -> String {
    if s.id == "engine-plugins" {
        return "the engine's online store".into();
    }
    if s.id == "mcp-registry" && s.url.is_none() {
        return "registry.modelcontextprotocol.io".into();
    }
    s.url
        .as_deref()
        .and_then(|u| url::Url::parse(u).ok())
        .and_then(|u| u.host_str().map(str::to_owned))
        .filter(|h| !crate::error::names_engine(h))
        .unwrap_or_else(|| "that source".into())
}

/// Whether a source is read through the engine (its skills hub): its failures are the engine's state, not the network's.
#[must_use]
pub fn through_engine(s: &StoreSource) -> bool {
    s.fetch == SourceFetch::EngineGateway && s.id != "engine-plugins"
}

/// The row's sentence for a read of `s` that failed with `e`. The raw text is kept for Diagnostics.
#[must_use]
pub fn reason(s: &StoreSource, e: &Error) -> String {
    let code = e.code();
    let raw = e.to_string();
    crate::error::keep(code, &raw);
    let at = place(s);
    let engine = through_engine(s);
    match code {
        "hx.engine.unavailable" if engine => {
            "The engine is not running yet. This source is read through it: read the sources again once it has started.".into()
        }
        "hx.engine.incompatible" if engine => {
            "The engine is a version this app cannot use, so this source was not read. Reinstall boopis to get a matching one.".into()
        }
        "hx.engine.refused" | "hx.store.install_failed" | "hx.config.invalid" if engine => {
            "The engine could not read its hub just now. Try again later.".into()
        }
        // A blocking read that never answered (a panic in the transport) arrives as one of these from a network source: it is
        // boopis's failure, not the engine's, whatever the code's own sentence says.
        "hx.host.task_failed" | "hx.engine.unavailable" | "hx.host.unknown" => {
            "Something went wrong inside boopis while reading it, and nothing was changed. Try again; the details are in Settings, General, Diagnostics.".into()
        }
        "hx.store.rate_limited" => {
            let mins = retry_after_s(&raw).unwrap_or(60).div_ceil(60).max(1);
            format!(
                "{at} is limiting requests right now. Read it again in about {mins} minute{}.",
                if mins == 1 { "" } else { "s" }
            )
        }
        "hx.store.too_large" => format!(
            "The list at {at} is larger than boopis accepts, so it was not read."
        ),
        "hx.store.invalid_manifest" => format!(
            "{at} answered with a list boopis could not read. Try again later."
        ),
        "hx.store.source_unreachable" if raw.contains("not JSON") => format!(
            "{at} answered with something that is not its list (a proxy or a sign-in page can do that). Check the connection or proxy, then read it again."
        ),
        "hx.store.source_unreachable" => format!(
            "Could not reach {at}. Check the connection or proxy, then read the sources again."
        ),
        "hx.store.offline" => {
            "You are offline, so it was not read. What it listed before is still shown.".into()
        }
        other => crate::error::user_message(other, &raw),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::store::types::{Terms, Tier};

    fn src(id: &str, fetch: SourceFetch, url: Option<&str>) -> StoreSource {
        StoreSource {
            id: id.into(),
            label: id.into(),
            description: None,
            kinds: vec![],
            fetch,
            default_tier: Tier::NotReviewed,
            default_on: true,
            user_added: false,
            engine_origin: false,
            url: url.map(str::to_owned),
            path: None,
            terms: Some(Terms::Checked),
            note: None,
            enabled: None,
            refreshed_at: None,
            items: None,
            error: None,
            refreshable: None,
            stale: None,
        }
    }

    /// No sentence a row shows carries a status number, a transport's words, JSON or the engine's name.
    fn plain(t: &str) {
        for bad in [
            "hx.",
            "panicked",
            "{",
            "Connection",
            "os error",
            "403",
            "500",
        ] {
            assert!(!t.contains(bad), "{t}");
        }
        assert!(!crate::error::names_engine(t), "{t}");
        assert!(t.ends_with('.'), "{t}");
    }

    #[test]
    fn an_unreachable_network_source_names_its_host_and_the_fix() {
        let reg = src(
            "mcp-registry",
            SourceFetch::RegistryApi,
            Some("https://registry.modelcontextprotocol.io"),
        );
        let t = reason(
            &reg,
            &Error::Store(
                "hx.store.source_unreachable",
                "boopis will not read registry.modelcontextprotocol.io (io: Connection refused (os error 111))".into(),
            ),
        );
        assert_eq!(
            t,
            "Could not reach registry.modelcontextprotocol.io. Check the connection or proxy, then read the sources again."
        );
        plain(&t);
    }

    #[test]
    fn the_engines_catalogue_is_never_named_by_its_address() {
        let e = src(
            "engine-plugins",
            SourceFetch::EngineGateway,
            Some("https://hermes-agent.nousresearch.com/docs/api/plugin-catalog.json"),
        );
        let t = reason(
            &e,
            &Error::Store(
                "hx.store.source_unreachable",
                "boopis will not read hermes-agent.nousresearch.com (it answered 503)".into(),
            ),
        );
        assert!(
            t.starts_with("Could not reach the engine's online store."),
            "{t}"
        );
        plain(&t);
    }

    #[test]
    fn the_hub_says_the_engine_is_not_running_yet() {
        let hub = src("skills-hub", SourceFetch::EngineGateway, None);
        let t = reason(&hub, &Error::Unavailable("no gateway".into()));
        assert!(t.starts_with("The engine is not running yet."), "{t}");
        plain(&t);
        let t = reason(
            &hub,
            &Error::Store("hx.store.install_failed", "skills.manage: boom".into()),
        );
        assert_eq!(
            t,
            "The engine could not read its hub just now. Try again later."
        );
    }

    #[test]
    fn a_transport_that_panicked_is_boopiss_failure_not_the_engines() {
        let reg = src("mcp-registry", SourceFetch::RegistryApi, None);
        let t = reason(
            &reg,
            &Error::Io("task 424 panicked with message \"No CryptoProvider for Rustls\"".into()),
        );
        assert!(t.starts_with("Something went wrong inside boopis"), "{t}");
        plain(&t);
        assert!(
            crate::error::recent()
                .iter()
                .any(|r| r.detail.contains("No CryptoProvider")),
            "the raw words are kept for Diagnostics"
        );
    }

    #[test]
    fn a_rate_limit_says_when_to_try_again_and_a_proxy_page_is_not_a_list() {
        let anth = src(
            "anthropic",
            SourceFetch::GitMarketplace,
            Some("https://github.com/anthropics/claude-plugins-official"),
        );
        let t = reason(
            &anth,
            &Error::Store(
                "hx.store.rate_limited",
                "that source is limiting requests; retry_after_s=300".into(),
            ),
        );
        assert_eq!(
            t,
            "github.com is limiting requests right now. Read it again in about 5 minutes."
        );
        plain(&t);
        let reg = src("mcp-registry", SourceFetch::RegistryApi, None);
        let t = reason(
            &reg,
            &Error::Store(
                "hx.store.source_unreachable",
                "the registry's answer is not JSON: expected value at line 1".into(),
            ),
        );
        assert!(t.contains("not its list"), "{t}");
        plain(&t);
    }
}
