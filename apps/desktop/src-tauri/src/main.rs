//! The hypotaxis desktop app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hypotaxis_host::run();
}
