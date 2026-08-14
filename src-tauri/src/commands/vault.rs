use crate::AppState;
use crate::commands::blocking;
use yobei_core::error::Result;
use yobei_core::vault;
use yobei_core::vault::export::{self as vault_export, RestoreSummary};
use yobei_core::vault::import::{self as vault_import, CsvPreview, ImportSummary};
use yobei_core::vault::storage;

#[tauri::command]
pub fn create_item(
    item_type: String,
    plaintext_json: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let result = state.with_vault(|conn, master_key| {
        vault::create_item(conn, master_key, &item_type, &plaintext_json)
    });
    state.notify_items_changed(result)
}

#[tauri::command]
pub fn get_item(item_id: String, state: tauri::State<'_, AppState>) -> Result<String> {
    state.with_vault(|conn, master_key| vault::get_item(conn, master_key, &item_id))
}

#[tauri::command]
pub fn list_items(state: tauri::State<'_, AppState>) -> Result<Vec<vault::ItemSummary>> {
    state.with_db(vault::list_items)
}

#[tauri::command]
pub fn update_item(
    item_id: String,
    plaintext_json: String,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let result = state.with_vault(|conn, master_key| {
        vault::update_item(conn, master_key, &item_id, &plaintext_json)
    });
    state.notify_items_changed(result)
}

#[tauri::command]
pub fn delete_item(item_id: String, state: tauri::State<'_, AppState>) -> Result<()> {
    let result = state.with_db(|conn| vault::delete_item(conn, &item_id));
    state.notify_items_changed(result)
}

#[tauri::command]
pub fn preview_csv(content: String) -> Result<CsvPreview> {
    vault_import::preview_csv(&content)
}

#[tauri::command]
pub async fn import_csv(
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<ImportSummary> {
    let db_path = state.db_path.clone();
    let bridge = state.bridge.clone();
    let master_key = state.master_key()?;
    let result = blocking(move || {
        let conn = storage::open(&db_path)?;
        vault_import::import_csv(&conn, &master_key, &content)
    })
    .await?;
    bridge.broadcast_items_changed();
    Ok(result)
}

#[tauri::command]
pub async fn export_vault(state: tauri::State<'_, AppState>) -> Result<String> {
    let db_path = state.db_path.clone();
    let device_key = state.device_key;
    blocking(move || {
        let conn = storage::open(&db_path)?;
        vault_export::export_vault_json(&conn, &device_key)
    })
    .await
}

#[tauri::command]
pub async fn import_vault(
    content: String,
    source_password: String,
    state: tauri::State<'_, AppState>,
) -> Result<RestoreSummary> {
    let db_path = state.db_path.clone();
    let bridge = state.bridge.clone();
    let master_key = state.master_key()?;
    let result = blocking(move || {
        let conn = storage::open(&db_path)?;
        vault_export::import_vault_json(&conn, &master_key, &content, &source_password)
    })
    .await?;
    bridge.broadcast_items_changed();
    Ok(result)
}

#[tauri::command]
pub async fn export_csv(state: tauri::State<'_, AppState>) -> Result<String> {
    let db_path = state.db_path.clone();
    let master_key = state.master_key()?;
    blocking(move || {
        let conn = storage::open(&db_path)?;
        vault_export::export_csv(&conn, &master_key)
    })
    .await
}
