//! Generates `codes.rs` from `errors.json`, so the code strings are typed once, in the data file.
// A build script has no better failure channel than aborting the build, so `expect` is the intent here.
#![allow(clippy::expect_used)]

use std::fmt::Write as _;
use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=errors.json");
    let raw = fs::read_to_string("errors.json").expect("errors.json is part of the crate");
    let doc: serde_json::Value = serde_json::from_str(&raw).expect("errors.json is valid JSON");
    let errors = doc["errors"]
        .as_array()
        .expect("errors.json has an `errors` array");

    let mut out = String::new();
    let mut all = Vec::new();
    for entry in errors {
        let code = entry["code"].as_str().expect("every error has a code");
        let description = entry["description"]
            .as_str()
            .expect("every error has a description");
        let ident: String = code
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_uppercase()
                } else {
                    '_'
                }
            })
            .collect();
        writeln!(out, "/// {description}").expect("writing to a String");
        writeln!(out, "pub const {ident}: &str = \"{code}\";").expect("writing to a String");
        all.push(ident);
    }
    writeln!(out, "/// Every code in the catalog, in file order.").expect("writing to a String");
    writeln!(out, "pub const ALL: &[&str] = &[{}];", all.join(", ")).expect("writing to a String");

    let dest = Path::new(&env::var("OUT_DIR").expect("cargo sets OUT_DIR")).join("codes.rs");
    fs::write(dest, out).expect("OUT_DIR is writable");
}
