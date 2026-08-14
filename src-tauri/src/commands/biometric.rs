use crate::AppState;
use crate::commands::setup::{refresh_confirm_clock, validate_pin};
use crate::platform::biometric as plat;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::security::keychain;
use yobei_core::vault::storage;

#[tauri::command]
pub fn biometric_available() -> bool {
    plat::is_available()
}

#[tauri::command]
pub fn is_biometric_enabled(state: tauri::State<'_, AppState>) -> Result<bool> {
    let conn = storage::open(&state.db_path)?;
    Ok(storage::load_biometric_secret(&conn)?.is_some())
}

#[tauri::command]
pub fn setup_biometric(password: String, state: tauri::State<'_, AppState>) -> Result<()> {
    validate_pin(&password)?;
    let conn = storage::open(&state.db_path)?;
    let store =
        storage::load_key_store(&conn, &state.device_key)?.ok_or(ErrorCode::NotInitialized)?;
    let keys = keychain::unlock(password.as_bytes(), &store)?;
    let cred = keychain::create_biometric_credential(&keys.master_key)?;
    let json = serde_json::to_vec(&cred).map_err(|_| ErrorCode::DataCorrupt)?;
    let blob = plat::protect_secret(&json)?;
    storage::save_biometric_secret(&conn, &blob)?;
    refresh_confirm_clock(&conn, &state.device_key)
}

#[tauri::command]
pub fn disable_biometric(state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = storage::open(&state.db_path)?;
    if let Some(blob) = storage::load_biometric_secret(&conn)? {
        plat::delete_secret(&blob)?;
    }
    storage::delete_biometric_secret(&conn)
}

#[tauri::command]
pub async fn unlock_with_biometric(
    message: String,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    if state.active_keys.lock().unwrap().is_some() {
        return Ok(());
    }
    if !plat::is_available() {
        return Err(ErrorCode::BiometricUnavailable);
    }
    if !plat::request(&message)? {
        return Err(ErrorCode::InvalidPassword);
    }
    let conn = storage::open(&state.db_path)?;
    let blob = storage::load_biometric_secret(&conn)?.ok_or(ErrorCode::BiometricUnavailable)?;
    let json = plat::unprotect_secret(&blob)?;
    let cred: keychain::BiometricCredential =
        serde_json::from_slice(&json).map_err(|_| ErrorCode::DataCorrupt)?;

    let settings = storage::load_security_settings(&conn, &state.device_key)?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    if keychain::bio_confirm_expired(
        settings.last_password_confirm_at,
        settings.confirm_days,
        now_ms,
    ) {
        return Err(ErrorCode::InvalidPassword);
    }

    let keys = keychain::unlock_with_bio(&cred)?;
    let _state_gate = state.bridge.acquire_state_gate().await;
    if state.active_keys.lock().unwrap().is_some() {
        return Ok(());
    }
    *state.db_conn.lock().unwrap() = Some(conn);
    *state.active_keys.lock().unwrap() = Some(keys);
    state.touch();
    state.bridge.broadcast_unlocked();
    Ok(())
}
