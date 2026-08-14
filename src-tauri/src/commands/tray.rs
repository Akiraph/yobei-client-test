use tauri::menu::{Menu, MenuItem};
use yobei_core::error::{ErrorCode, Result};

#[derive(serde::Deserialize)]
pub struct TrayLabels {
    show: String,
    quit: String,
}

#[tauri::command]
pub fn set_tray_labels(app: tauri::AppHandle, labels: TrayLabels) -> Result<()> {
    let show_item = MenuItem::with_id(&app, "show", labels.show, true, None::<&str>)
        .map_err(|_| ErrorCode::OperationFailed)?;
    let quit_item = MenuItem::with_id(&app, "quit", labels.quit, true, None::<&str>)
        .map_err(|_| ErrorCode::OperationFailed)?;
    let menu = Menu::with_items(&app, &[&show_item, &quit_item])
        .map_err(|_| ErrorCode::OperationFailed)?;
    let tray = app.tray_by_id("main").ok_or(ErrorCode::OperationFailed)?;
    tray.set_menu(Some(menu))
        .map_err(|_| ErrorCode::OperationFailed)
}
