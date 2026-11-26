//! Dictation in the host (ADR-0059): the microphone button of a composer, heard and written down on this computer by
//! `boopis-dictation`. This file is the host's side of it: the service built once at start, how the speech model's bytes
//! leave the network ([`Https`], the host's one TLS setup), and the events a dictation sends its window.
//!
//! **Only a person's press in the app starts the microphone.** The one way in is the `dictation_start` command, which the
//! capability file allows to the main window alone and which checks the window that called it. Nothing else holds the
//! service: not the local API (`local_api/` has no route to it and does not name it; `nothing_but_the_command_reaches_the_
//! microphone` reads the sources to keep it so), not the command line, not the gateway proxy, so no other client, bot or
//! mod can start or read the microphone. A dictation ends when the composer says stop (`dictation_stop`), when its window
//! closes or its page loads again ([`stop_for_window`]), when its events can no longer be delivered, and at the cap.
//!
//! **Audio never leaves the process and is never written to disk**; the only request is the one-time fetch of the speech
//! model, to `<app data>/speech/`, checked against its pinned SHA-256 before it is ever loaded.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use specta::Type;

use boopis_dictation::capture::SystemMicrophone;
use boopis_dictation::fetch::{Reply, Transport};
use boopis_dictation::service::{Dictation, Parts};
use boopis_dictation::transcribe::{Whisper, WhisperOptions};
use boopis_dictation::{Event, Reason, model};

use crate::config::DictationLimits;

/// The folder of the speech model inside the app's data folder.
pub const SPEECH_DIR: &str = "speech";

/// What a dictation is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DictationKind {
    /// The speech model is being fetched, once: `done` of `total` bytes.
    Preparing,
    /// The microphone is open.
    Listening,
    /// `text` is the stretch being spoken, so far; each one replaces the last.
    Partial,
    /// `text` is a finished stretch of speech; it stays.
    Final,
    /// It could not start or stopped by itself: `reason`, `message`, `retry`.
    Error,
    /// The dictation is over; nothing follows.
    Ended,
}

/// One event of a dictation, on the channel `dictation_start` was given. One shape for every kind: the fields a kind does
/// not use are empty (`0`, `""`, `false`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct DictationEvent {
    /// Which event this is.
    pub kind: DictationKind,
    /// `preparing`: bytes of the speech model on disk so far.
    #[specta(type = f64)]
    pub done: u64,
    /// `preparing`: the speech model's size in bytes.
    #[specta(type = f64)]
    pub total: u64,
    /// `partial` and `final`: the words.
    pub text: String,
    /// `error`: `no-microphone`, `permission-denied`, `model-download-failed`, `busy`, `too-long` or `failed`.
    pub reason: String,
    /// `error`: what to tell the person, in plain words.
    pub message: String,
    /// `error`: whether pressing the mic again can help.
    pub retry: bool,
}

impl DictationEvent {
    fn of(kind: DictationKind) -> Self {
        Self {
            kind,
            done: 0,
            total: 0,
            text: String::new(),
            reason: String::new(),
            message: String::new(),
            retry: false,
        }
    }
}

impl From<Event> for DictationEvent {
    fn from(event: Event) -> Self {
        match event {
            Event::Preparing { done, total } => Self {
                done,
                total,
                ..Self::of(DictationKind::Preparing)
            },
            Event::Listening => Self::of(DictationKind::Listening),
            Event::Partial { text } => Self {
                text,
                ..Self::of(DictationKind::Partial)
            },
            Event::Final { text } => Self {
                text,
                ..Self::of(DictationKind::Final)
            },
            Event::Error {
                reason,
                message,
                retry,
            } => Self {
                reason: reason.as_str().to_owned(),
                message,
                retry,
                ..Self::of(DictationKind::Error)
            },
            Event::Ended => Self::of(DictationKind::Ended),
        }
    }
}

/// Every reason an `error` event can carry, as the UI reads them.
pub const REASONS: [Reason; 6] = [
    Reason::NoMicrophone,
    Reason::PermissionDenied,
    Reason::ModelDownloadFailed,
    Reason::Busy,
    Reason::TooLong,
    Reason::Failed,
];

/// How the speech model's bytes leave the network: one blocking GET over `ureq` and rustls with the system's trust store
/// (`tls::config()`), no redirect followed here (the fetch checks each hop against the repository's hosts), no cookie, no
/// credential.
pub struct Https {
    agent: ureq::Agent,
}

impl Https {
    /// An agent with the limits' timeouts.
    #[must_use]
    pub fn new(limits: &DictationLimits) -> Self {
        let agent = ureq::Agent::config_builder()
            .tls_config(crate::tls::config())
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_connect(Some(limits.connect_timeout))
            .timeout_recv_response(Some(limits.response_timeout))
            .timeout_recv_body(Some(limits.body_timeout))
            .user_agent(concat!("boopis/", env!("CARGO_PKG_VERSION")))
            .build()
            .new_agent();
        Self { agent }
    }
}

impl Transport for Https {
    fn get(&self, url: &url::Url, from: u64) -> std::result::Result<Reply, String> {
        // the file as it is stored: a transfer encoding would make the byte count and the range mean something else
        let mut request = self
            .agent
            .get(url.as_str())
            .header("Accept-Encoding", "identity");
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        let response = request.call().map_err(|e| e.to_string())?;
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        };
        Ok(Reply {
            status: response.status().as_u16(),
            location: header("location"),
            content_range: header("content-range"),
            body: Box::new(response.into_body().into_reader()),
        })
    }
}

/// The dictation service of this run: the system's microphone, whisper.cpp over the model `speech_model` names (the
/// default when it names none), the model in `<app data>/speech/`. Building it opens nothing and reads nothing.
#[must_use]
pub fn build(app_data: &Path, speech_model: Option<&str>, limits: &DictationLimits) -> Dictation {
    let spec = model::named(speech_model);
    let dir = app_data.join(SPEECH_DIR);
    Dictation::new(Parts {
        spec,
        dir: dir.clone(),
        tuning: limits.tuning.clone(),
        policy: limits.fetch.clone(),
        microphone: Arc::new(SystemMicrophone),
        recognizer: Arc::new(Whisper::new(spec, dir, WhisperOptions::default())),
        transport: Arc::new(Https::new(limits)),
    })
}

/// The window that could have asked for a dictation is gone, or its page is loading again: whatever runs is stopped (the
/// microphone closes at once; what was said is still written down, for nobody).
pub fn stop_for_window(dictation: &Dictation) {
    if dictation.active() {
        tracing::info!("the window is gone or loading again; the dictation is stopped");
    }
    dictation.stop_all();
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn every_event_has_the_one_shape_the_ui_reads() {
        let preparing = DictationEvent::from(Event::Preparing {
            done: 1024,
            total: 59_707_625,
        });
        assert_eq!(
            serde_json::to_value(&preparing).unwrap(),
            serde_json::json!({"kind": "preparing", "done": 1024, "total": 59_707_625_u64, "text": "", "reason": "", "message": "", "retry": false})
        );
        let kind =
            |e: Event| serde_json::to_value(DictationEvent::from(e)).unwrap()["kind"].clone();
        assert_eq!(kind(Event::Listening), "listening");
        assert_eq!(kind(Event::Ended), "ended");
        let partial = DictationEvent::from(Event::Partial {
            text: "and so".into(),
        });
        assert_eq!(
            (partial.kind, partial.text.as_str()),
            (DictationKind::Partial, "and so")
        );
        let last = serde_json::to_value(DictationEvent::from(Event::Final {
            text: "and so, my fellow Americans".into(),
        }))
        .unwrap();
        assert_eq!(last["kind"], "final");
        assert_eq!(last["text"], "and so, my fellow Americans");
    }

    #[test]
    fn an_error_carries_one_of_the_six_reasons_and_plain_words() {
        let names: Vec<&str> = REASONS.iter().map(|r| r.as_str()).collect();
        assert_eq!(
            names,
            [
                "no-microphone",
                "permission-denied",
                "model-download-failed",
                "busy",
                "too-long",
                "failed"
            ]
        );
        let e = DictationEvent::from(boopis_dictation::Error::Busy.event());
        assert_eq!(e.kind, DictationKind::Error);
        assert_eq!(e.reason, "busy");
        assert!(e.retry);
        assert!(
            e.message.ends_with('.') && !e.message.contains("Busy"),
            "{}",
            e.message
        );
        // nothing a person reads names the engine or quotes a library (ADR-0031, ADR-0041)
        for raw in [
            boopis_dictation::Error::NoMicrophone("ALSA lib pcm.c:2721".into()),
            boopis_dictation::Error::ModelFetch("huggingface.co: io: Connection refused".into()),
            boopis_dictation::Error::Failed("whisper_full_with_state returned 7".into()),
        ] {
            let shown = DictationEvent::from(raw.event()).message;
            assert!(
                !shown.contains("ALSA")
                    && !shown.contains("huggingface")
                    && !shown.contains("whisper"),
                "{shown}"
            );
        }
    }

    #[test]
    fn the_model_lives_in_the_apps_own_speech_folder_and_nothing_is_touched_at_start() {
        let dir = tempfile::tempdir().unwrap();
        let dictation = build(dir.path(), None, &DictationLimits::default());
        assert!(!dictation.active());
        assert!(!dictation.model_loaded());
        assert!(
            std::fs::read_dir(dir.path()).unwrap().next().is_none(),
            "building the service made a file or a folder"
        );
        assert_eq!(
            model::DEFAULT.path(&dir.path().join(SPEECH_DIR)),
            dir.path().join("speech").join("ggml-base-q5_1.bin")
        );
        // a name this build does not know is the default model, not a failure
        let _ = build(
            dir.path(),
            Some("a-model-from-the-future"),
            &DictationLimits::default(),
        );
    }

    #[test]
    fn the_model_request_uses_the_hosts_tls_and_follows_no_redirect_by_itself() {
        let https = Https::new(&DictationLimits::default());
        let config = https.agent.config();
        assert_eq!(config.max_redirects(), 0);
        assert!(!config.http_status_as_error());
        assert!(
            config
                .tls_config()
                .unversioned_rustls_crypto_provider()
                .is_some()
        );
        // and the address it will be asked for is https, on the repository's host, pinned to a commit
        let url = url::Url::parse(model::DEFAULT.url).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("huggingface.co"));
    }

    /// Every `.rs` file under `dir`, with its path relative to `src/`.
    fn sources(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                sources(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push((path.clone(), std::fs::read_to_string(&path).unwrap()));
            }
        }
    }

    /// Decision 5 of ADR-0059, kept by reading the host's own sources: the dictation service and the audio crate are
    /// named only here, in the two commands, in the app's start-up and in the numbers. A new way to the microphone (a
    /// local API route, a command-line command, a gateway method) has to edit this list, in the open.
    #[test]
    fn nothing_but_the_command_reaches_the_microphone() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut all = Vec::new();
        sources(&src, &mut all);
        assert!(all.len() > 100, "the host's sources were not found");
        let allowed = [
            "dictation.rs",
            "commands.rs",
            "lib.rs",
            "config.rs",
            "settings.rs",
        ];
        let mut seen_here = false;
        for (path, text) in &all {
            let rel = path
                .strip_prefix(&src)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            // a test may say what it proves is absent (`local_api/endpoint_tests.rs` does)
            if rel.ends_with("tests.rs") {
                continue;
            }
            let names = text.contains("boopis_dictation")
                || text.contains("crate::dictation")
                || text.contains("cpal::");
            if rel == "dictation.rs" {
                seen_here = names;
                continue;
            }
            assert!(
                !names || allowed.contains(&rel.as_str()),
                "{rel} reaches dictation: only {allowed:?} may"
            );
            // the local API, the command line and the gateway proxy never name it at all
            if rel.starts_with("local_api/")
                || rel.starts_with("cli")
                || rel.starts_with("gateway/")
                || rel.starts_with("rooms/")
            {
                let lower = text.to_ascii_lowercase();
                assert!(
                    !lower.contains("dictation") && !lower.contains("microphone"),
                    "{rel} names dictation or the microphone"
                );
            }
        }
        assert!(seen_here);
        // settings.rs and config.rs hold only the model's name and the numbers: neither can start anything
        for (path, text) in &all {
            let rel = path
                .strip_prefix(&src)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == "settings.rs" || rel == "config.rs" {
                assert!(
                    !text.contains("service::") && !text.contains(".start("),
                    "{rel} starts something"
                );
            }
        }
    }
}
