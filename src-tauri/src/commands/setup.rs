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
    if state.active_keys.lock().unwrap().is_some() {
        return Ok(());
    }

    let db_path = state.db_path.clone();
    let device_key = state.device_key;
    let (conn, keys) = tauri::async_runtime::spawn_blocking(move || -> Result<_> {
        let conn = storage::open(&db_path)?;
        let store_data =
            storage::load_key_store(&conn, &device_key)?.ok_or(ErrorCode::NotInitialized)?;
        let keys = keychain::unlock(password.as_bytes(), &store_data)?;
        refresh_confirm_clock(&conn, &device_key)?;
        auto_enable_biometric(&conn, &keys.master_key);
        Ok((conn, keys))
    })
    .await
    .map_err(|_| ErrorCode::OperationFailed)??;

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

pub(crate) fn refresh_confirm_clock(conn: &rusqlite::Connection, device_key: &[u8]) -> Result<()> {
    let mut settings = storage::load_security_settings(conn, device_key)?;
    settings.last_password_confirm_at = chrono::Utc::now().timestamp_millis();
    storage::save_security_settings(conn, device_key, &settings)
}

/// Auto-enable biometric unlock on the first PIN unlock when the platform
/// supports it, so the unlock screen "just works" without a Settings opt-in.
/// Best-effort: any failure is ignored and never blocks unlocking.
fn auto_enable_biometric(conn: &rusqlite::Connection, master_key: &[u8; 32]) {
    if !crate::platform::biometric::is_available() {
        return;
    }
    if storage::load_biometric_secret(conn)
        .map(|secret| secret.is_some())
        .unwrap_or(false)
    {
        return;
    }
    let Ok(cred) = keychain::create_biometric_credential(master_key) else {
        return;
    };
    let Ok(json) = serde_json::to_vec(&cred) else {
        return;
    };
    let Ok(blob) = crate::platform::biometric::protect_secret(&json) else {
        return;
    };
    let _ = storage::save_biometric_secret(conn, &blob);
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
