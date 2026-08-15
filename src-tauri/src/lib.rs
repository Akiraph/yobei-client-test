mod commands;
mod integration;
mod platform;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;
#[cfg(desktop)]
use tauri::WindowEvent;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::security::keychain::ActiveKeys;
use yobei_core::sync::SyncConfig;
use yobei_core::vault::storage;

use crate::integration::bridge::BridgeServer;

struct AppState {
    db_path: PathBuf,
    db_conn: Mutex<Option<rusqlite::Connection>>,
    device_key: [u8; 32],
    active_keys: Arc<Mutex<Option<ActiveKeys>>>,
    last_activity: Arc<Mutex<Instant>>,
    sync_runtime: Mutex<SyncRuntime>,
    bridge: Arc<BridgeServer>,
    #[cfg(desktop)]
    browser_cache: Arc<Mutex<commands::extension::BrowserCache>>,
}

impl AppState {
    fn touch(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    fn idle_exceeded(&self, auto_lock_min: u32) -> bool {
        if auto_lock_min == 0 {
            return false;
        }
        self.last_activity.lock().unwrap().elapsed()
            >= Duration::from_secs(u64::from(auto_lock_min) * 60)
    }

    fn sync_identity(&self) -> Result<([u8; 32], SyncConfig)> {
        self.with_vault(|conn, master_key| {
            let config = storage::load_sync_config(conn)?.ok_or(ErrorCode::NotInitialized)?;
            Ok((*master_key, config))
        })
    }

    fn with_db<T>(&self, action: impl FnOnce(&rusqlite::Connection) -> Result<T>) -> Result<T> {
        let conn_guard = self.db_conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or(ErrorCode::VaultLocked)?;
        action(conn)
    }

    fn with_vault<T>(
        &self,
        action: impl FnOnce(&rusqlite::Connection, &[u8; 32]) -> Result<T>,
    ) -> Result<T> {
        self.with_db(|conn| {
            let keys = self.active_keys.lock().unwrap();
            let master_key = &keys.as_ref().ok_or(ErrorCode::VaultLocked)?.master_key;
            action(conn, master_key)
        })
    }

    fn master_key(&self) -> Result<[u8; 32]> {
        self.active_keys
            .lock()
            .unwrap()
            .as_ref()
            .map(|keys| keys.master_key)
            .ok_or(ErrorCode::VaultLocked)
    }

    fn notify_items_changed<T>(&self, result: Result<T>) -> Result<T> {
        if result.is_ok() {
            self.bridge.broadcast_items_changed();
        }
        result
    }
}

struct SyncRuntime {
    last_error: Option<ErrorCode>,
    last_sync_at: Option<i64>,
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App) -> Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)
        .map_err(|_| ErrorCode::OperationFailed)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|_| ErrorCode::OperationFailed)?;
    let menu =
        Menu::with_items(app, &[&show_item, &quit_item]).map_err(|_| ErrorCode::OperationFailed)?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or(ErrorCode::OperationFailed)?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Yobei")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|_| ErrorCode::OperationFailed)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app)
        }));
    }

    builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder = builder.plugin(tauri_plugin_biometric::init());
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::DECORATIONS
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_yobei_biometric::init())
        .on_window_event(|window, event| {
            #[cfg(not(desktop))]
            let _ = (window, event);

            #[cfg(desktop)]
            {
                if window.label() != "main" {
                    return;
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            setup_tray(app)?;
            #[cfg(target_os = "android")]
            platform::biometric::init(app.handle().clone());
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|_| ErrorCode::StorageFailed)?;
            std::fs::create_dir_all(&data_dir).map_err(|_| ErrorCode::StorageFailed)?;
            let db_path = data_dir.join("vault.db");
            let device_key = platform::device_key::load_or_create(&data_dir.join("device.key"))?;
            let active_keys = Arc::new(Mutex::new(None));
            let last_activity = Arc::new(Mutex::new(Instant::now()));
            let bridge =
                BridgeServer::new(db_path.clone(), active_keys.clone(), last_activity.clone());
            #[cfg(desktop)]
            let browser_cache = Arc::new(Mutex::new(commands::extension::BrowserCache::default()));
            #[cfg(desktop)]
            commands::extension::refresh_browser_cache(
                browser_cache.clone(),
                commands::extension::resolve_extension_path(&app.handle())
                    .ok()
                    .map(std::path::PathBuf::from),
            );
            app.manage(AppState {
                db_path,
                device_key,
                db_conn: Mutex::new(None),
                active_keys,
                last_activity,
                sync_runtime: Mutex::new(SyncRuntime {
                    last_error: None,
                    last_sync_at: None,
                }),
                bridge: bridge.clone(),
                #[cfg(desktop)]
                browser_cache,
            });
            commands::security::spawn_auto_lock(app.handle());
            tauri::async_runtime::spawn(async move {
                bridge.serve().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::setup::is_initialized,
            commands::setup::setup_master_password,
            commands::transfer::start_device_transfer,
            commands::transfer::pending_device_transfer,
            commands::transfer::cancel_device_transfer,
            commands::transfer::approve_device_transfer,
            commands::transfer::complete_device_transfer,
            commands::transfer::list_devices,
            commands::transfer::revoke_device,
            commands::setup::unlock_vault,
            commands::setup::lock_vault,
            commands::vault::create_item,
            commands::vault::get_item,
            commands::vault::list_items,
            commands::vault::update_item,
            commands::vault::delete_item,
            commands::misc::generate_password,
            commands::misc::compute_totp,
            commands::misc::read_external_asset,
            commands::misc::open_text_file,
            commands::misc::save_text_file,
            commands::vault::preview_csv,
            commands::vault::import_csv,
            commands::vault::export_vault,
            commands::vault::import_vault,
            commands::vault::export_csv,
            commands::setup::change_master_password,
            commands::biometric::biometric_available,
            commands::biometric::is_biometric_enabled,
            commands::biometric::setup_biometric,
            commands::biometric::disable_biometric,
            commands::biometric::unlock_with_biometric,
            commands::sync::sync_status,
            commands::sync::pair_device,
            commands::sync::sync_now,
            #[cfg(desktop)]
            commands::extension::extension_pairing_status,
            #[cfg(desktop)]
            commands::extension::extension_regenerate_code,
            #[cfg(desktop)]
            commands::extension::extension_clear_paired,
            #[cfg(desktop)]
            commands::extension::install_extension,
            #[cfg(desktop)]
            commands::extension::check_browsers,
            #[cfg(desktop)]
            commands::tray::set_tray_labels,
            commands::security::mark_activity,
            commands::security::get_security_settings,
            commands::security::save_security_settings,
            commands::security::copy_to_clipboard,
            #[cfg(desktop)]
            platform::qr_scanner::capture_qr_from_screen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
