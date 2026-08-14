use crate::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::vault::storage;

#[derive(serde::Serialize)]
pub struct PairingStatus {
    code: String,
    paired: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct BrowserInfo {
    name: String,
    browser_installed: bool,
    extension_installed: bool,
}

#[derive(Default)]
pub struct BrowserCache {
    pub value: Option<Vec<BrowserInfo>>,
    refreshing: bool,
}

#[tauri::command]
pub fn extension_pairing_status(state: tauri::State<'_, AppState>) -> Result<PairingStatus> {
    let conn = storage::open(&state.db_path)?;
    Ok(PairingStatus {
        code: storage::get_or_create_pairing_code(&conn)?,
        paired: storage::list_paired_extensions(&conn)?,
    })
}

#[tauri::command]
pub fn extension_regenerate_code(state: tauri::State<'_, AppState>) -> Result<String> {
    let conn = storage::open(&state.db_path)?;
    storage::regenerate_pairing_code(&conn)
}

#[tauri::command]
pub fn extension_clear_paired(state: tauri::State<'_, AppState>) -> Result<()> {
    let conn = storage::open(&state.db_path)?;
    storage::clear_paired_extensions(&conn)
}

#[tauri::command]
pub fn install_extension(app_handle: tauri::AppHandle, browser: String) -> Result<String> {
    let exe = find_browser(&browser)?;
    let extension_path = resolve_extension_path(&app_handle)?;
    let management_url = match browser.as_str() {
        "chrome" => "chrome://extensions",
        "edge" => "edge://extensions",
        _ => return Err(ErrorCode::UnsupportedBrowser),
    };

    let mut command = Command::new(&exe);
    // Chromium's --load-extension flag is a temporary developer feature, not an install mechanism.
    command.arg(management_url);
    hide_console(&mut command);
    command
        .spawn()
        .map_err(|_| ErrorCode::ExtensionUnavailable)?;

    Ok(extension_path)
}

#[tauri::command]
pub fn check_browsers(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Vec<BrowserInfo> {
    let cached = state
        .browser_cache
        .lock()
        .unwrap()
        .value
        .clone()
        .unwrap_or_default();
    refresh_browser_cache(
        state.browser_cache.clone(),
        resolve_extension_path(&app_handle).ok().map(PathBuf::from),
    );
    cached
}

pub fn refresh_browser_cache(cache: Arc<Mutex<BrowserCache>>, extension_path: Option<PathBuf>) {
    {
        let mut state = cache.lock().unwrap();
        if state.refreshing {
            return;
        }
        state.refreshing = true;
    }

    std::thread::spawn(move || {
        let browsers = detect_browsers(extension_path.as_deref());
        let mut state = cache.lock().unwrap();
        state.value = Some(browsers);
        state.refreshing = false;
    });
}

fn detect_browsers(extension_path: Option<&Path>) -> Vec<BrowserInfo> {
    let browsers = ["chrome", "edge"];
    browsers
        .iter()
        .map(|name| {
            let browser_installed = find_browser(name).is_ok();
            BrowserInfo {
                name: name.to_string(),
                browser_installed,
                extension_installed: browser_installed
                    && extension_path.is_some_and(|path| extension_is_loaded(name, path)),
            }
        })
        .collect()
}

fn extension_is_loaded(browser: &str, extension_path: &Path) -> bool {
    #[cfg(not(windows))]
    {
        let _ = (browser, extension_path);
        return false;
    }

    #[cfg(windows)]
    {
        let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
            return false;
        };
        let root = match browser {
            "chrome" => PathBuf::from(&local_app_data)
                .join("Google")
                .join("Chrome")
                .join("User Data"),
            "edge" => PathBuf::from(&local_app_data)
                .join("Microsoft")
                .join("Edge")
                .join("User Data"),
            _ => return false,
        };
        let target =
            fs::canonicalize(extension_path).unwrap_or_else(|_| extension_path.to_path_buf());
        let Ok(profiles) = fs::read_dir(root) else {
            return false;
        };

        profiles.flatten().any(|profile| {
            let Ok(file_type) = profile.file_type() else {
                return false;
            };
            if !file_type.is_dir() {
                return false;
            }
            let profile_path = profile.path();

            ["Preferences", "Secure Preferences"]
                .iter()
                .any(|file_name| {
                    let preferences = profile_path.join(file_name);
                    let Ok(content) = fs::read_to_string(preferences) else {
                        return false;
                    };
                    let Ok(document) = serde_json::from_str::<serde_json::Value>(&content) else {
                        return false;
                    };
                    let Some(settings) = document
                        .pointer("/extensions/settings")
                        .and_then(serde_json::Value::as_object)
                    else {
                        return false;
                    };

                    settings.values().any(|setting| {
                        let path_matches = setting
                            .get("path")
                            .and_then(serde_json::Value::as_str)
                            .map(PathBuf::from)
                            .map(|path| fs::canonicalize(&path).unwrap_or(path) == target)
                            .unwrap_or(false);
                        path_matches || is_yobei_extension_setting(setting)
                    })
                })
                || extension_directory_contains_yobei(&profile_path)
        })
    }
}

#[cfg(windows)]
fn is_yobei_extension_setting(setting: &serde_json::Value) -> bool {
    let Some(manifest) = setting.get("manifest") else {
        return false;
    };
    let name = manifest
        .get("name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let description = manifest
        .get("description")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    name == "__MSG_extensionName__"
        || description == "__MSG_extensionDescription__"
        || name.to_ascii_lowercase().contains("yobei")
}

#[cfg(windows)]
fn extension_directory_contains_yobei(profile_path: &Path) -> bool {
    let Ok(extension_ids) = fs::read_dir(profile_path.join("Extensions")) else {
        return false;
    };
    extension_ids.flatten().any(|extension_id| {
        let Ok(versions) = fs::read_dir(extension_id.path()) else {
            return false;
        };
        versions.flatten().any(|version| {
            let manifest_path = version.path().join("manifest.json");
            let Ok(content) = fs::read_to_string(manifest_path) else {
                return false;
            };
            let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) else {
                return false;
            };
            is_yobei_extension_setting(&serde_json::json!({ "manifest": manifest }))
        })
    })
}

#[cfg(not(windows))]
fn find_browser(_name: &str) -> Result<String> {
    Err(ErrorCode::UnsupportedPlatform)
}

#[cfg(windows)]
fn find_browser(name: &str) -> Result<String> {
    let key_name = match name {
        "chrome" => "chrome.exe",
        "edge" => "msedge.exe",
        _ => return Err(ErrorCode::UnsupportedBrowser),
    };

    use winreg::RegKey;
    use winreg::enums::*;
    let app_paths = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths";
    for root in &[HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Ok(key) = RegKey::predef(*root).open_subkey(format!("{app_paths}\\{key_name}")) {
            if let Ok(value) = key.get_value::<String, _>("") {
                if Path::new(&value).exists() {
                    return Ok(value);
                }
            }
        }
    }
    let mut command = Command::new("where.exe");
    command.arg(key_name);
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|_| ErrorCode::ExtensionUnavailable)?;
    if output.status.success() {
        if let Some(path) = String::from_utf8_lossy(&output.stdout).lines().next() {
            let path = path.trim();
            if !path.is_empty() {
                return Ok(path.to_string());
            }
        }
    }
    Err(ErrorCode::ExtensionUnavailable)
}

fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    #[cfg(not(windows))]
    let _ = command;
}

pub fn resolve_extension_path(app_handle: &tauri::AppHandle) -> Result<String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("extension").join("dist"));
        candidates.push(
            resource_dir
                .join("resources")
                .join("extension")
                .join("dist"),
        );
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("extension").join("dist"));
        }
    }
    candidates.push({
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.join("..").join("extension").join("dist")
    });

    candidates
        .into_iter()
        .find_map(|candidate| {
            if !candidate.join("manifest.json").is_file() {
                return None;
            }
            candidate.to_str().map(|s| s.to_string())
        })
        .ok_or(ErrorCode::ExtensionUnavailable)
}
