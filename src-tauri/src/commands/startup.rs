use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use yobei_core::error::{ErrorCode, Result};

const PREFS_FILE: &str = "app_prefs.json";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "Yobei";

/// Desktop launch preferences that must be readable before the vault is
/// unlocked (so they live in a plain JSON file, not the encrypted store).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefs {
    /// Launch the vault when the user signs in to Windows.
    pub autostart: bool,
    /// When auto-started, start hidden to the tray instead of showing the window.
    pub silent_start: bool,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefsPatch {
    autostart: Option<bool>,
    silent_start: Option<bool>,
}

fn prefs_path(data_dir: &Path) -> PathBuf {
    data_dir.join(PREFS_FILE)
}

pub fn load_prefs(data_dir: &Path) -> AppPrefs {
    std::fs::read(prefs_path(data_dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_prefs(data_dir: &Path, prefs: &AppPrefs) -> Result<()> {
    let json = serde_json::to_vec_pretty(prefs).map_err(|_| ErrorCode::DataCorrupt)?;
    std::fs::write(prefs_path(data_dir), json).map_err(|_| ErrorCode::FileFailed)
}

/// Whether the process was launched with the hidden-start flag (added to the
/// autostart command line when silent start is enabled).
pub fn launched_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden" || arg == "--silent")
}

#[tauri::command]
pub fn get_app_prefs(app: AppHandle) -> Result<AppPrefs> {
    let data_dir = app.path().app_data_dir().map_err(|_| ErrorCode::StorageFailed)?;
    Ok(load_prefs(&data_dir))
}

#[tauri::command]
pub fn set_app_prefs(app: AppHandle, patch: AppPrefsPatch) -> Result<AppPrefs> {
    let data_dir = app.path().app_data_dir().map_err(|_| ErrorCode::StorageFailed)?;
    let mut prefs = load_prefs(&data_dir);
    if let Some(value) = patch.autostart {
        prefs.autostart = value;
    }
    if let Some(value) = patch.silent_start {
        prefs.silent_start = value;
    }
    save_prefs(&data_dir, &prefs)?;
    apply_autostart(&prefs)?;
    Ok(prefs)
}

#[cfg(windows)]
fn apply_autostart(prefs: &AppPrefs) -> Result<()> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    let run = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_READ | KEY_SET_VALUE)
        .map_err(|_| ErrorCode::OperationFailed)?;

    if !prefs.autostart {
        // Missing value is fine; removing an already-absent entry is a no-op.
        let _ = run.delete_value(RUN_VALUE);
        return Ok(());
    }

    let exe = std::env::current_exe()
        .map_err(|_| ErrorCode::OperationFailed)?
        .to_string_lossy()
        .to_string();
    let mut command = format!("\"{exe}\"");
    if prefs.silent_start {
        command.push_str(" --hidden");
    }
    run.set_value(RUN_VALUE, &command)
        .map_err(|_| ErrorCode::OperationFailed)
}

#[cfg(not(windows))]
fn apply_autostart(_prefs: &AppPrefs) -> Result<()> {
    Ok(())
}
