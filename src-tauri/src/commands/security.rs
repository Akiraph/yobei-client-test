use crate::AppState;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::vault::storage;

#[derive(serde::Serialize)]
pub struct SecuritySettingsDto {
    auto_lock_min: u32,
    confirm_days: u32,
    clipboard_sec: u32,
    last_password_confirm_at: i64,
}

impl From<storage::SecuritySettings> for SecuritySettingsDto {
    fn from(s: storage::SecuritySettings) -> Self {
        Self {
            auto_lock_min: s.auto_lock_min,
            confirm_days: s.confirm_days,
            clipboard_sec: s.clipboard_sec,
            last_password_confirm_at: s.last_password_confirm_at,
        }
    }
}

#[derive(serde::Deserialize, Default)]
pub struct SecuritySettingsPatch {
    auto_lock_min: Option<u32>,
    confirm_days: Option<u32>,
    clipboard_sec: Option<u32>,
}

#[tauri::command]
pub fn mark_activity(state: tauri::State<'_, AppState>) {
    state.touch();
}

#[tauri::command]
pub fn get_security_settings(state: tauri::State<'_, AppState>) -> Result<SecuritySettingsDto> {
    let conn = storage::open(&state.db_path)?;
    let s = storage::load_security_settings(&conn, &state.device_key)?;
    Ok(s.into())
}

#[tauri::command]
pub fn save_security_settings(
    patch: SecuritySettingsPatch,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let conn = storage::open(&state.db_path)?;
    let mut s = storage::load_security_settings(&conn, &state.device_key)?;
    if let Some(v) = patch.auto_lock_min {
        s.auto_lock_min = v;
    }
    if let Some(v) = patch.confirm_days {
        s.confirm_days = v;
    }
    if let Some(v) = patch.clipboard_sec {
        s.clipboard_sec = v;
    }
    storage::save_security_settings(&conn, &state.device_key, &s)
}

#[tauri::command]
pub fn copy_to_clipboard(
    text: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let clipboard_sec = {
        let conn = storage::open(&state.db_path)?;
        storage::load_security_settings(&conn, &state.device_key)?.clipboard_sec
    };
    app.clipboard()
        .write_text(text.clone())
        .map_err(|_| ErrorCode::OperationFailed)?;
    if clipboard_sec > 0 {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(u64::from(clipboard_sec))).await;
            // Do not erase content the user copied after the secret.
            if let Ok(current) = app.clipboard().read_text() {
                if current == text {
                    let _ = app.clipboard().clear();
                }
            }
        });
    }
    Ok(())
}

pub(crate) fn spawn_auto_lock(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(10));
        loop {
            ticker.tick().await;
            let state = app.state::<AppState>();
            if state.active_keys.lock().unwrap().is_none() {
                continue;
            }
            let auto_lock_min = match storage::open(&state.db_path)
                .and_then(|conn| storage::load_security_settings(&conn, &state.device_key))
            {
                Ok(s) => s.auto_lock_min,
                Err(_) => continue,
            };
            if should_auto_lock(state.inner(), auto_lock_min) {
                let _state_gate = state.bridge.acquire_state_gate().await;
                // Every command acquires the connection before the active keys.
                let mut conn = state.db_conn.lock().unwrap();
                let mut keys = state.active_keys.lock().unwrap();
                if keys.is_some() && should_auto_lock(state.inner(), auto_lock_min) {
                    *keys = None;
                    *conn = None;
                    drop(keys);
                    drop(conn);
                    state.bridge.broadcast_locked();
                    let _ = app.emit("vault-locked", ());
                }
            }
        }
    });
}

fn should_auto_lock(state: &AppState, auto_lock_min: u32) -> bool {
    if auto_lock_min == 0 {
        return false;
    }
    // Lock immediately when the workstation locks (Win+L / sleep).
    if crate::platform::session::session_locked() {
        return true;
    }
    // Follow system-wide keyboard/mouse idle time where available; otherwise
    // fall back to the desktop app's own activity clock.
    match crate::platform::session::system_idle_secs() {
        Some(idle_secs) => idle_secs >= u64::from(auto_lock_min) * 60,
        None => state.idle_exceeded(auto_lock_min),
    }
}
