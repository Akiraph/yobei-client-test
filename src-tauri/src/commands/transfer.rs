use crate::AppState;
use crate::commands::blocking;
use crate::integration::device_transfer;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::security::keychain;
use yobei_core::security::transfer::{self, TransferReceiver, TransferRequest};
use yobei_core::sync as core_sync;
use yobei_core::vault::storage;
use zeroize::Zeroize;

#[derive(serde::Serialize)]
pub struct StartedDeviceTransfer {
    qr: String,
    expires_at: i64,
    approved: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum PendingTransfer {
    Receiver {
        sealed_receiver: Vec<u8>,
    },
    Enrollment {
        request: TransferRequest,
        payload: transfer::TransferPayload,
    },
}

fn save_pending_transfer(
    conn: &rusqlite::Connection,
    device_key: &[u8],
    transfer: &PendingTransfer,
    expires_at: i64,
) -> Result<()> {
    let mut encoded = serde_json::to_vec(transfer)?;
    let sealed = storage::seal(device_key, &encoded);
    encoded.zeroize();
    storage::save_pending_transfer(conn, &sealed?, expires_at)
}

fn load_pending_transfer(
    conn: &rusqlite::Connection,
    device_key: &[u8],
) -> Result<Option<(PendingTransfer, i64)>> {
    storage::load_pending_transfer(conn)?
        .map(|(sealed, expires_at)| {
            let encoded = storage::open_seal(device_key, &sealed)?;
            let transfer = serde_json::from_slice(&encoded)?;
            Ok((transfer, expires_at))
        })
        .transpose()
}

#[tauri::command]
pub fn pending_device_transfer(
    state: tauri::State<'_, AppState>,
) -> Result<Option<StartedDeviceTransfer>> {
    let conn = storage::open(&state.db_path)?;
    let Some((pending, expires_at)) = load_pending_transfer(&conn, &state.device_key)? else {
        return Ok(None);
    };
    let (request, approved) = match pending {
        PendingTransfer::Receiver { sealed_receiver } => {
            if expires_at <= chrono::Utc::now().timestamp_millis() {
                storage::clear_pending_transfer(&conn)?;
                return Ok(None);
            }
            (
                TransferReceiver::open(&state.device_key, &sealed_receiver)?
                    .request()?
                    .clone(),
                false,
            )
        }
        PendingTransfer::Enrollment { request, .. } => (request, true),
    };
    Ok(Some(StartedDeviceTransfer {
        qr: request.encode()?,
        expires_at,
        approved,
    }))
}

#[tauri::command]
pub fn cancel_device_transfer(state: tauri::State<'_, AppState>) -> Result<()> {
    storage::clear_pending_transfer(&storage::open(&state.db_path)?)
}

#[tauri::command]
pub async fn start_device_transfer(
    server_url: String,
    device_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<StartedDeviceTransfer> {
    let db_path = state.db_path.clone();
    let device_key = state.device_key;
    blocking(move || {
        let conn = storage::open(&db_path)?;
        if storage::load_key_store(&conn, &device_key)?.is_some() {
            return Err(ErrorCode::InvalidInput);
        }
        let device_name = device_name.trim();
        if device_name.is_empty() {
            return Err(ErrorCode::InvalidInput);
        }
        let device_id = uuid::Uuid::new_v4().to_string();
        let request_id = uuid::Uuid::new_v4().to_string();
        let mut receiver = TransferReceiver::new(server_url.trim_end_matches('/'), &device_id)?;
        let created = device_transfer::create(
            &server_url,
            &request_id,
            &device_id,
            device_name,
            &receiver.public_key_b64(),
        )?;
        let request = receiver.bind_transfer(&created.transfer_id, &created.claim_token)?;
        save_pending_transfer(
            &conn,
            &device_key,
            &PendingTransfer::Receiver {
                sealed_receiver: receiver.seal(&device_key)?,
            },
            created.expires_at,
        )?;
        Ok(StartedDeviceTransfer {
            qr: request.encode()?,
            expires_at: created.expires_at,
            approved: false,
        })
    })
    .await
}

#[tauri::command]
pub async fn approve_device_transfer(qr: String, state: tauri::State<'_, AppState>) -> Result<()> {
    let (master_key, config) = state.sync_identity()?;
    let db_path = state.db_path.clone();
    let device_key = state.device_key;
    blocking(move || {
        let request = TransferRequest::decode(&qr)?;
        if request.server_url.trim_end_matches('/') != config.server_url.trim_end_matches('/') {
            return Err(ErrorCode::InvalidInput);
        }
        let conn = storage::open(&db_path)?;
        let keystore =
            storage::load_key_store(&conn, &device_key)?.ok_or(ErrorCode::NotInitialized)?;
        let offer = transfer::create_offer(&request, &keystore)?;
        device_transfer::approve(
            &request,
            &offer,
            &core_sync::auth_key_b64(&master_key, &config.device_id),
            &core_sync::auth_key_b64(&master_key, &request.device_id),
        )
    })
    .await
}

#[tauri::command]
pub async fn complete_device_transfer(
    password: String,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    crate::commands::setup::validate_pin(&password)?;
    let db_path = state.db_path.clone();
    let device_key = state.device_key;
    blocking(move || {
        let conn = storage::open(&db_path)?;
        if storage::load_key_store(&conn, &device_key)?.is_some() {
            return Err(ErrorCode::InvalidInput);
        }
        let (pending, expires_at) =
            load_pending_transfer(&conn, &device_key)?.ok_or(ErrorCode::NotInitialized)?;
        if matches!(&pending, PendingTransfer::Receiver { .. })
            && expires_at <= chrono::Utc::now().timestamp_millis()
        {
            storage::clear_pending_transfer(&conn)?;
            return Err(ErrorCode::TransferExpired);
        }
        let (request, payload) = match pending {
            PendingTransfer::Receiver { sealed_receiver } => {
                let receiver = TransferReceiver::open(&device_key, &sealed_receiver)?;
                let request = receiver.request()?.clone();
                let offer = device_transfer::fetch(&request)?;
                let payload = receiver.accept_offer(&offer, password.as_bytes())?;
                keychain::unlock(password.as_bytes(), &payload.keystore)?;
                save_pending_transfer(
                    &conn,
                    &device_key,
                    &PendingTransfer::Enrollment {
                        request: request.clone(),
                        payload: payload.clone(),
                    },
                    expires_at,
                )?;
                (request, payload)
            }
            PendingTransfer::Enrollment { request, payload } => (request, payload),
        };
        let keys = keychain::unlock(password.as_bytes(), &payload.keystore)?;
        let auth_key = core_sync::auth_key_b64(&keys.master_key, &payload.device_id);
        if let Err(error) = device_transfer::acknowledge(&request, &auth_key) {
            if error == ErrorCode::TransferExpired {
                storage::clear_pending_transfer(&conn)?;
            }
            return Err(error);
        }
        let transaction = conn.unchecked_transaction()?;
        storage::save_key_store(&transaction, &device_key, &payload.keystore)?;
        storage::save_sync_config(&transaction, &payload.server_url, &payload.device_id)?;
        storage::clear_pending_transfer(&transaction)?;
        transaction.commit()?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_devices(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<device_transfer::Device>> {
    let (master_key, config) = state.sync_identity()?;
    blocking(move || {
        device_transfer::devices(
            &config.server_url,
            &core_sync::auth_key_b64(&master_key, &config.device_id),
        )
    })
    .await
}

#[tauri::command]
pub async fn revoke_device(device_id: String, state: tauri::State<'_, AppState>) -> Result<()> {
    let (master_key, config) = state.sync_identity()?;
    if device_id == config.device_id {
        return Err(ErrorCode::InvalidInput);
    }
    blocking(move || {
        device_transfer::revoke(
            &config.server_url,
            &device_id,
            &core_sync::auth_key_b64(&master_key, &config.device_id),
        )
    })
    .await
}
