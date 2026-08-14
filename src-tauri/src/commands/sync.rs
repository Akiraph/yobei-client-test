use crate::AppState;
use crate::commands::blocking;
use crate::integration::sync as integration_sync;
use std::path::PathBuf;
use std::time::Duration;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::sync::{self as core_sync, SyncConfig};
use yobei_core::vault::storage;

#[derive(serde::Serialize)]
pub struct SyncStatus {
    configured: bool,
    server_url: Option<String>,
    device_id: Option<String>,
    pending: usize,
    last_synced: i64,
    last_error: Option<ErrorCode>,
    last_sync_at: Option<i64>,
}

#[derive(serde::Serialize)]
pub struct SyncSummary {
    pushed: usize,
    pulled: usize,
    current_version: i64,
}

#[tauri::command]
pub fn sync_status(state: tauri::State<'_, AppState>) -> Result<SyncStatus> {
    let (last_error, last_sync_at) = {
        let runtime = state.sync_runtime.lock().unwrap();
        (runtime.last_error.clone(), runtime.last_sync_at)
    };
    let (configured, server_url, device_id, pending, last_synced) = state.with_db(|conn| {
        let Some(config) = storage::load_sync_config(conn)? else {
            return Ok((false, None, None, 0, 0));
        };
        Ok((
            true,
            Some(config.server_url),
            Some(config.device_id),
            core_sync::count_pending(conn)?,
            config.last_synced_version,
        ))
    })?;
    Ok(SyncStatus {
        configured,
        server_url,
        device_id,
        pending,
        last_synced,
        last_error,
        last_sync_at,
    })
}

#[tauri::command]
pub async fn pair_device(
    server_url: String,
    setup_code: String,
    device_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    let master_key = state.master_key()?;
    let db_path = state.db_path.clone();
    blocking(move || {
        let device_id = uuid::Uuid::new_v4().to_string();
        let auth = core_sync::auth_key_b64(&master_key, &device_id);
        integration_sync::setup_device(&server_url, &setup_code, &device_id, &device_name, &auth)?;
        let conn = storage::open(&db_path)?;
        storage::save_sync_config(&conn, &server_url, &device_id)?;
        conn.execute("UPDATE items SET dirty = TRUE", [])
            .map_err(|_| ErrorCode::StorageFailed)?;
        Ok(device_id)
    })
    .await
}

#[tauri::command]
pub async fn sync_now(state: tauri::State<'_, AppState>) -> Result<SyncSummary> {
    let (master_key, config) = state.with_vault(|conn, master_key| {
        let cfg = storage::load_sync_config(conn)?.ok_or(ErrorCode::NotInitialized)?;
        Ok((*master_key, cfg))
    })?;
    let db_path = state.db_path.clone();

    let auth_key_b64 = core_sync::auth_key_b64(&master_key, &config.device_id);
    let result = blocking(move || run_sync(&db_path, master_key, &config, &auth_key_b64)).await;

    {
        let mut rt = state.sync_runtime.lock().unwrap();
        rt.last_sync_at = Some(chrono::Utc::now().timestamp_millis());
        match &result {
            Ok(_) => rt.last_error = None,
            Err(e) => rt.last_error = Some(e.clone()),
        }
    }
    result
}

fn pull_all(
    conn: &mut rusqlite::Connection,
    master_key: &[u8; 32],
    transport: &integration_sync::Transport,
    mut cursor: i64,
) -> Result<(usize, i64, i64)> {
    let mut pulled = 0usize;
    loop {
        let response = transport.pull(cursor)?;
        pulled += response.changes.len();
        let current_version = response.current_version;
        cursor = response.next_since;
        let has_more = response.has_more;
        core_sync::apply(conn, master_key, &response)?;
        if !has_more {
            return Ok((pulled, cursor, current_version));
        }
    }
}

fn run_sync(
    db_path: &PathBuf,
    master_key: [u8; 32],
    cfg: &SyncConfig,
    auth_key_b64: &str,
) -> Result<SyncSummary> {
    let mut conn = storage::open(db_path)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| ErrorCode::StorageFailed)?;
    let transport = integration_sync::Transport::new(&cfg.server_url, auth_key_b64)?;

    let mut pulled_total = 0usize;
    let mut pushed_total = 0usize;
    let mut last_version = cfg.last_synced_version;

    for _ in 0..2 {
        let (pulled, cursor, server_version) =
            pull_all(&mut conn, &master_key, &transport, last_version)?;
        pulled_total += pulled;
        last_version = cursor;

        let payload = core_sync::pending(&conn, &master_key)?;
        if payload.is_empty() {
            return Ok(SyncSummary {
                pushed: pushed_total,
                pulled: pulled_total,
                current_version: last_version,
            });
        }
        match transport.push(last_version, &payload) {
            Ok(resp) => {
                pushed_total += payload.len();
                let (pulled, _, reconciled_version) =
                    pull_all(&mut conn, &master_key, &transport, last_version)?;
                pulled_total += pulled;
                return Ok(SyncSummary {
                    pushed: pushed_total,
                    pulled: pulled_total,
                    current_version: server_version
                        .max(reconciled_version)
                        .max(resp.current_version),
                });
            }
            Err(ErrorCode::SyncConflict) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(ErrorCode::SyncConflict)
}
