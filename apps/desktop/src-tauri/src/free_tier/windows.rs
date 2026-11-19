//! The challenge windows on Tauri: a webview window that is created hidden, loads a remote page and has no access to the
//! host. It matches no capability (`capabilities/main.json` names only the `main` window), so none of the host's commands
//! answer it; the test `challenge_window_has_no_capability` keeps that true. It is ephemeral (no data kept), pinned to the
//! portal's origin for navigations, and refuses new windows and downloads. The web view's own permission prompts (camera,
//! location, notifications) are denied by wry's default.

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use super::challenge::{Window, WindowHost};
use crate::error::{Error, Result};

/// The label prefix of every challenge window. No capability names it.
pub const LABEL_PREFIX: &str = "free-tier-challenge";

/// Challenge windows on the running app.
pub struct TauriWindows {
    app: AppHandle,
    portal: Url,
    next: AtomicU64,
}

impl TauriWindows {
    /// Windows for `app`, pinned to `portal`'s origin.
    #[must_use]
    pub fn new(app: AppHandle, portal: Url) -> Self {
        Self {
            app,
            portal,
            next: AtomicU64::new(1),
        }
    }
}

impl WindowHost for TauriWindows {
    fn open_hidden(&self, url: &Url) -> Result<Box<dyn Window>> {
        let label = format!(
            "{LABEL_PREFIX}-{}",
            self.next.fetch_add(1, Ordering::Relaxed)
        );
        let origin = self.portal.origin();
        WebviewWindowBuilder::new(&self.app, &label, WebviewUrl::External(url.clone()))
            .title("Quick check")
            .inner_size(520.0, 720.0)
            .visible(false)
            .focused(false)
            .incognito(true)
            .on_navigation(move |to| to.origin() == origin)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .build()
            .map_err(|e| Error::Os(e.to_string()))?;
        Ok(Box::new(Live {
            app: self.app.clone(),
            label,
        }))
    }
}

struct Live {
    app: AppHandle,
    label: String,
}

impl Window for Live {
    fn url(&self) -> Option<Url> {
        self.app.get_webview_window(&self.label)?.url().ok()
    }
    fn alive(&self) -> bool {
        self.app.get_webview_window(&self.label).is_some()
    }
    fn reveal(&self) {
        if let Some(w) = self.app.get_webview_window(&self.label) {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    fn close(&self) {
        if let Some(w) = self.app.get_webview_window(&self.label) {
            let _ = w.destroy();
        }
    }
}
