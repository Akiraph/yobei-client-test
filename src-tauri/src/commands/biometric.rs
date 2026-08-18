use crate::AppState;
use crate::commands::setup::{refresh_confirm_clock, validate_pin};
use crate::platform::biometric as plat;
#[cfg(desktop)]
use tauri::{Emitter, Manager};
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

/// Unlock with the platform-protected biometric credential *without* an
/// interactive prompt (desktop only). The OS login already proved the user's
/// identity, so re-prompting Windows Hello on every boot/wake is unnecessary.
/// Returns true when the vault is now unlocked.
///
/// This is called once by the frontend during startup; the session-wake path
/// goes through [`spawn_session_unlock_watcher`] instead, which emits the
/// `vault-unlocked` event the UI listens for.
#[tauri::command]
pub async fn try_silent_unlock(state: tauri::State<'_, AppState>) -> Result<bool> {
    #[cfg(any(desktop, target_os = "android"))]
    {
        Ok(silent_unlock(&state).await)
    }
    #[cfg(not(any(desktop, target_os = "android")))]
    {
        let _ = state;
        Ok(false)
    }
}

/// Decrypt the platform-protected biometric secret without a second prompt and,
/// if that succeeds, install the active keys. Every failure path simply returns
/// false.
#[cfg(any(desktop, target_os = "android"))]
async fn silent_unlock(state: &AppState) -> bool {
    if state.active_keys.lock().unwrap().is_some() {
        return true;
    }
    #[cfg(target_os = "android")]
    if !plat::is_available() {
        return false;
    }
    let Ok(conn) = storage::open(&state.db_path) else {
        return false;
    };
    let Ok(Some(blob)) = storage::load_biometric_secret(&conn) else {
        return false;
    };
    // Desktop periodically requires the master password again. On Android,
    // the phone's existing unlock is the user-authentication boundary, so the
    // app can restore the session without showing a second prompt.
    #[cfg(desktop)]
    {
        let Ok(settings) = storage::load_security_settings(&conn, &state.device_key) else {
            return false;
        };
        if keychain::bio_confirm_expired(
            settings.last_password_confirm_at,
            settings.confirm_days,
            chrono::Utc::now().timestamp_millis(),
        ) {
            return false;
        }
    }
    let Ok(json) = plat::unprotect_secret(&blob) else {
        return false;
    };
    let Ok(cred) = serde_json::from_slice::<keychain::BiometricCredential>(&json) else {
        return false;
    };
    let Ok(keys) = keychain::unlock_with_bio(&cred) else {
        return false;
    };
    let _state_gate = state.bridge.acquire_state_gate().await;
    if state.active_keys.lock().unwrap().is_some() {
        return true;
    }
    *state.db_conn.lock().unwrap() = Some(conn);
    *state.active_keys.lock().unwrap() = Some(keys);
    state.touch();
    state.bridge.broadcast_unlocked();
    true
}

/// Auto-unlock the vault when the Windows session transitions from locked back
/// to unlocked (wake from sleep or Win+L unlock). The desktop has just been
/// re-verified by the OS, so a silent DPAPI unlock is safe here.
#[cfg(desktop)]
pub(crate) fn spawn_session_unlock_watcher(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut was_locked = crate::platform::session::session_locked();
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            ticker.tick().await;
            let locked = crate::platform::session::session_locked();
            let became_unlocked = was_locked && !locked;
            was_locked = locked;
            if !became_unlocked {
                continue;
            }
            let state = app.state::<AppState>();
            if silent_unlock(state.inner()).await {
                let _ = app.emit("vault-unlocked", ());
            }
        }
    });
}
