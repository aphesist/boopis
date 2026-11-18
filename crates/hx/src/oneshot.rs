//! One-shot mode: run a single method and print its response. For debugging and tests; it goes
//! through the same dispatcher as `hx serve`.

use std::io::Read;
use std::path::Path;

use hx_proto::{AppError, Dispatcher, Id, Request, Response, codes};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

/// Reads params JSON from a file, or from stdin when `source` is `-`.
///
/// # Errors
/// The source cannot be read.
pub fn read_source(source: &str) -> std::io::Result<String> {
    if source == "-" {
        let mut text = String::new();
        std::io::stdin().read_to_string(&mut text)?;
        Ok(text)
    } else {
        std::fs::read_to_string(Path::new(source))
    }
}

/// Runs `method` with params parsed from `params_json` and returns the response.
///
/// Unparseable JSON becomes an `hx.parse_error` response, never a panic.
pub async fn run(
    dispatcher: &Dispatcher,
    method: &str,
    params_json: Option<&str>,
    cancel: CancellationToken,
) -> Response {
    let params: Option<Value> = match params_json {
        None => None,
        Some(text) => match serde_json::from_str(text) {
            Ok(v) => Some(v),
            Err(e) => {
                return Response::err(
                    Some(Id::Num(1)),
                    &AppError::new(
                        codes::HX_PARSE_ERROR,
                        format!("params are not valid JSON: {e}"),
                    ),
                );
            }
        },
    };
    dispatcher
        .handle(Request::new(Id::Num(1), method, params), cancel)
        .await
}

/// The process exit code for a response: 0 for a result, 1 for an error.
#[must_use]
pub fn exit_code(response: &Response) -> i32 {
    i32::from(response.error.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn runs_describe_and_reports_bad_json() {
        let d = crate::build_dispatcher();
        let ok = run(&d, "hx.describe", None, CancellationToken::new()).await;
        assert_eq!(exit_code(&ok), 0);
        let bad = run(&d, "txn.apply", Some("{nope"), CancellationToken::new()).await;
        assert_eq!(exit_code(&bad), 1);
        assert_eq!(bad.error.unwrap().string_code(), Some("hx.parse_error"));
        let invalid = run(&d, "txn.apply", Some("{}"), CancellationToken::new()).await;
        assert_eq!(
            invalid.error.unwrap().string_code(),
            Some("hx.invalid_params")
        );
    }
}
