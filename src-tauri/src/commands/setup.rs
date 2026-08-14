use crate::AppState;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::security::keychain;
use yobei_core::vault::storage;

pub(crate) fn validate_pin(password: &str) -> Result<()> {
    if password.len() == 6 && password.bytes().all(|byte| byte.is_ascii_digit()) {
        Ok(())
    } else {
        Err(ErrorCode::InvalidInput)
    }
}

#[tauri::command]
pub fn is_initialized(state: tauri::State<'_, AppState>) -> Result<bool> {
    let conn = storage::open(&state.db_path)?;
    Ok(storage::load_key_store(&conn, &state.device_key)?.is_some())
}

#[tauri::command]
pub fn setup_master_password(password: String, state: tauri::State<'_, AppState>) -> Result<()> {
    validate_pin(&password)?;
    let conn = storage::open(&state.db_path)?;
    let (store_data, _) = keychain::initialize(password.as_bytes())?;
    storage::save_key_store(&conn, &state.device_key, &store_data)?;
    Ok(())
}

#[tauri::command]
pub async fn unlock_vault(password: String, state: tauri::State<'_, AppState>) -> Result<()> {
    validate_pin(&password)?;
    let conn = storage::open(&state.db_path)?;
    let store_data =
        storage::load_key_store(&conn, &state.device_key)?.ok_or(ErrorCode::NotInitialized)?;
    let keys = keychain::unlock(password.as_bytes(), &store_data)?;
    refresh_confirm_clock(&conn, &state.device_key)?;
    let _state_gate = state.bridge.acquire_state_gate().await;
    *state.db_conn.lock().unwrap() = Some(conn);
    *state.active_keys.lock().unwrap() = Some(keys);
    state.touch();
    state.bridge.broadcast_unlocked();
    Ok(())
}

pub(crate) fn refresh_confirm_clock(conn: &rusqlite::Connection, device_key: &[u8]) -> Result<()> {
    let mut settings = storage::load_security_settings(conn, device_key)?;
    settings.last_password_confirm_at = chrono::Utc::now().timestamp_millis();
    storage::save_security_settings(conn, device_key, &settings)
}

#[tauri::command]
pub async fn lock_vault(state: tauri::State<'_, AppState>) -> Result<()> {
    let _state_gate = state.bridge.acquire_state_gate().await;
    *state.db_conn.lock().unwrap() = None;
    *state.active_keys.lock().unwrap() = None;
    state.bridge.broadcast_locked();
    Ok(())
}

#[tauri::command]
pub fn change_master_password(
    old_password: String,
    new_password: String,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    validate_pin(&old_password)?;
    validate_pin(&new_password)?;
    state.with_db(|conn| {
        let store =
            storage::load_key_store(conn, &state.device_key)?.ok_or(ErrorCode::NotInitialized)?;
        let new_store = keychain::change_master_password(
            &store,
            old_password.as_bytes(),
            new_password.as_bytes(),
        )?;
        storage::save_key_store(conn, &state.device_key, &new_store)?;
        refresh_confirm_clock(conn, &state.device_key)
    })
}
