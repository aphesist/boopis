//! The one TLS setup of every HTTPS client in the host: the sign-ins (`chatgpt/`, `copilot/` and `xai/` share
//! `chatgpt::oauth::Https`), the provider checks (`providers::http::Https`) and the store (`store::net::Https`). rustls, with
//! **ring named on every agent** and the operating system's trust store, so a company's own certificate authority works.
//!
//! Why the provider is named here: ureq is built with `rustls-no-provider` (so ring is the only cryptography in the tree, and
//! rustls's other provider is never compiled). With that feature ureq takes the provider its `TlsConfig` names, else rustls's
//! process default, and when there is neither it **panics** on the first request ("No CryptoProvider for Rustls"). Before 0.1.8
//! nothing named one and nothing installed a default, so every HTTPS request of the host panicked, on every platform: the
//! ChatGPT sign-in showed the panic on Windows, and on Linux the same panic hid behind "could not check the key" (no sign-in
//! there had reached the network: the tests answer over loopback `http`, which needs no TLS). `tests/live_signins.rs` makes a
//! real HTTPS request through each agent, and `live-signins.yml` runs it on Linux, Windows and macOS.

use std::sync::{Arc, OnceLock};

use rustls::crypto::CryptoProvider;

/// ring, built once and shared by every agent.
#[must_use]
pub fn provider() -> Arc<CryptoProvider> {
    static RING: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    RING.get_or_init(|| Arc::new(rustls::crypto::ring::default_provider()))
        .clone()
}

/// The TLS settings of every agent: rustls, ring named explicitly, and the platform's verifier (the system's trust store).
#[must_use]
pub fn config() -> ureq::tls::TlsConfig {
    ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::Rustls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .unversioned_rustls_crypto_provider(provider())
        .build()
}

/// Make ring the process default too, for anything that asks rustls for one without naming it. Called first thing in `run()`;
/// a second call (or a default some other code installed first) changes nothing.
pub fn install_default() {
    if CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_agent_names_ring_and_the_default_installs_once() {
        let c = config();
        assert!(c.unversioned_rustls_crypto_provider().is_some());
        assert!(Arc::ptr_eq(&provider(), &provider()), "one provider, shared");
        install_default();
        install_default();
        assert!(CryptoProvider::get_default().is_some());
    }
}
