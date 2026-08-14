use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::generator::{self, PassgenOptions};
use yobei_core::totp;

#[tauri::command]
pub fn generate_password(mode: String, opts: PassgenOptions) -> Result<String> {
    generator::generate(&mode, &opts)
}

#[tauri::command]
pub fn compute_totp(secret: String) -> Result<totp::TotpCode> {
    totp::compute_now(&secret)
}

#[tauri::command]
pub fn read_external_asset(app: tauri::AppHandle, path: String) -> Result<String> {
    if path.is_empty()
        || path.contains("..")
        || path.contains('\\')
        || !(path == "site-icons.json" || (path.starts_with("locales/") && path.ends_with(".json")))
    {
        return Err(ErrorCode::InvalidInput);
    }

    let mut candidates = Vec::<PathBuf>::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join(&path));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(&path));
        candidates.push(resource_dir.join("resources").join(&path));
    }
    if let Ok(data_dir) = app.path().app_data_dir() {
        candidates.push(data_dir.join(&path));
    }

    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.push(if path == "site-icons.json" {
        manifest_dir.join("..").join("public").join(&path)
    } else {
        manifest_dir.join("..").join("src").join(&path)
    });

    candidates
        .into_iter()
        .find_map(|candidate| fs::read_to_string(candidate).ok())
        .ok_or(ErrorCode::FileFailed)
}

#[tauri::command]
pub fn open_text_file(app: tauri::AppHandle) -> Result<Option<String>> {
    let picked = app.dialog().file().blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|_| ErrorCode::FileFailed)?;
    let content = fs::read_to_string(path).map_err(|_| ErrorCode::FileFailed)?;
    Ok(Some(content))
}

#[tauri::command]
pub fn save_text_file(
    app: tauri::AppHandle,
    file_name: String,
    content: String,
) -> Result<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|_| ErrorCode::FileFailed)?;
    fs::write(&path, content).map_err(|_| ErrorCode::FileFailed)?;
    Ok(Some(path.to_string_lossy().to_string()))
}
