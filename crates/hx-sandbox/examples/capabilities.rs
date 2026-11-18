//! Prints what this host can enforce, as the JSON `sandbox.capabilities` would return.
#![allow(missing_docs, reason = "an example binary, not a public API")]

fn main() {
    match serde_json::to_string_pretty(&hx_sandbox::capabilities()) {
        Ok(json) => println!("{json}"),
        Err(e) => eprintln!("cannot serialise capabilities: {e}"),
    }
}
