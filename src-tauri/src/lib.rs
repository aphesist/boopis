#[tauri::command]
fn ping_hypotaxis() -> &'static str {
    "hypotaxis-ready"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping_hypotaxis])
        .run(tauri::generate_context!())
        .expect("error while running hypotaxis tauri application");
}
