// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod http;

use log::LevelFilter;
use native_tls::TlsConnector;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_log::LogTarget;
use tokio_tungstenite::Connector;

#[derive(Clone, Serialize)]
struct SingleInstance {
    args: Vec<String>,
    cwd: String
}

fn main() {
    // Prepare a TLS connector for invalid certificates.
    let tls_connector = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap();

    // Build the Tauri app.
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(LevelFilter::Info)
            .targets([LogTarget::Webview, LogTarget::Stdout, LogTarget::LogDir])
            .build())
        .plugin(tauri_plugin_websocket::Builder::default()
            .tls_connector(Connector::NativeTls(tls_connector))
            .build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_single_instance::init(single_instance))
        .invoke_handler(tauri::generate_handler![http::fetch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Callback function for when an additional app instance attempts to launch.
fn single_instance(app: &AppHandle, args: Vec<String>, working_dir: String) {
    app.emit_all("single-instance", SingleInstance {
        args, cwd: working_dir
    }).unwrap();
}
