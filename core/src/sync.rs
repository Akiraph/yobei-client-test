//! Local encrypted synchronization state.

use crate::error::{ErrorCode, Result};
use crate::security::crypto;
use crate::vault;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

const MAX_PUSH_CHANGES: usize = 500;
const ITEM_ENVELOPE_VERSION: u16 = 1;
const ITEM_ENVELOPE_CONTEXT: &[u8] = b"yobei-sync-item-v1";
const MAX_ITEM_ENVELOPE_BYTES: usize = 72 * 1024;
const MAX_ITEM_CIPHERTEXT_BYTES: usize = MAX_ITEM_ENVELOPE_BYTES + crypto::AEAD_TAG_LEN;
const MAX_ID_BYTES: usize = 128;

#[derive(Debug, Clone)]
pub struct SyncConfig {
    pub server_url: String,
    pub device_id: String,
    pub last_synced_version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SyncChange {
    pub id: String,
    pub change_id: String,
    pub encrypted_data: String,
    pub nonce: String,
    pub version: i32,
    pub created_at: i64,
    pub deleted: bool,
    pub expected_version: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PushResponse {
    pub current_version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullResponse {
    pub current_version: i64,
    pub next_since: i64,
    pub has_more: bool,
    pub changes: Vec<RemoteChange>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteChange {
    pub id: String,
    pub change_id: String,
    pub encrypted_data: String,
    pub nonce: String,
    pub version: i32,
    pub deleted: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub sync_version: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ItemSyncEnvelope {
    version: u16,
    context: String,
    item_type: String,
    plaintext: serde_json::Value,
}

impl ItemSyncEnvelope {
    fn new(item_type: String, plaintext_json: String) -> Result<Self> {
        let plaintext =
            serde_json::from_str(&plaintext_json).map_err(|_| ErrorCode::DataCorrupt)?;
        let envelope = Self {
            version: ITEM_ENVELOPE_VERSION,
            context: String::from_utf8_lossy(ITEM_ENVELOPE_CONTEXT).into_owned(),
            item_type,
            plaintext,
        };
        envelope.validate()?;
        Ok(envelope)
    }

    fn validate(&self) -> Result<()> {
        if self.version != ITEM_ENVELOPE_VERSION
            || self.context.as_bytes() != ITEM_ENVELOPE_CONTEXT
            || !matches!(self.item_type.as_str(), "login" | "note")
        {
            return Err(ErrorCode::DataCorrupt);
        }
        Ok(())
    }
}

pub fn auth_key_b64(master_key: &[u8], device_id: &str) -> String {
    STANDARD.encode(crypto::derive_auth_key(master_key, device_id.as_bytes()))
}

pub fn count_pending(conn: &Connection) -> Result<usize> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM items WHERE dirty = TRUE", [], |row| {
            row.get(0)
        })
        .map_err(|_| ErrorCode::StorageFailed)?;
    usize::try_from(count).map_err(|_| ErrorCode::DataCorrupt)
}

pub fn pending(conn: &Connection, master_key: &[u8]) -> Result<Vec<SyncChange>> {
    if count_pending(conn)? > MAX_PUSH_CHANGES {
        return Err(ErrorCode::SyncFailed);
    }
    read_pending_items(conn, master_key, MAX_PUSH_CHANGES)
}

fn read_pending_items(
    conn: &Connection,
    master_key: &[u8],
    limit: usize,
) -> Result<Vec<SyncChange>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut statement = conn
        .prepare(
            "SELECT id, change_id, item_type, version, created_at,
                    deleted, base_version
             FROM items WHERE dirty = TRUE ORDER BY updated_at, id LIMIT ?1",
        )
        .map_err(|_| ErrorCode::StorageFailed)?;
    let rows = statement
        .query_map([limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, i32>(6)?,
            ))
        })
        .map_err(|_| ErrorCode::StorageFailed)?;
    let pending = rows
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| ErrorCode::StorageFailed)?;
    drop(statement);
    let mut changes = Vec::new();
    for row in pending {
        let (id, change_id, item_type, version, created_at, deleted, expected_version) = row;
        if deleted {
            if expected_version == 0 {
                conn.execute("DELETE FROM items WHERE id = ?1", params![id])
                    .map_err(|_| ErrorCode::StorageFailed)?;
                continue;
            }
            changes.push(SyncChange {
                id,
                change_id,
                encrypted_data: String::new(),
                nonce: String::new(),
                version,
                created_at,
                deleted: true,
                expected_version,
            });
            continue;
        }

        let plaintext_json = vault::get_item(conn, master_key, &id)?;
        let envelope = ItemSyncEnvelope::new(item_type, plaintext_json)?;
        let mut envelope_bytes =
            serde_json::to_vec(&envelope).map_err(|_| ErrorCode::OperationFailed)?;
        if envelope_bytes.len() > MAX_ITEM_ENVELOPE_BYTES {
            envelope_bytes.zeroize();
            return Err(ErrorCode::InvalidInput);
        }
        let encrypted = crypto::encrypt(&sync_item_key(master_key, &id), &envelope_bytes);
        envelope_bytes.zeroize();
        let (sync_nonce, sync_ciphertext) = encrypted?;
        changes.push(SyncChange {
            id,
            change_id,
            encrypted_data: STANDARD.encode(sync_ciphertext),
            nonce: STANDARD.encode(sync_nonce),
            version,
            created_at,
            deleted: false,
            expected_version,
        });
    }
    Ok(changes)
}

pub fn apply(conn: &mut Connection, master_key: &[u8], response: &PullResponse) -> Result<()> {
    validate_pull(response)?;
    let transaction = conn.transaction().map_err(|_| ErrorCode::StorageFailed)?;
    for change in &response.changes {
        apply_change(&transaction, master_key, change)?;
    }
    transaction
        .execute(
            "UPDATE sync_config SET last_synced_version = MAX(last_synced_version, ?1) WHERE id = 1",
            params![response.next_since],
        )
        .map_err(|_| ErrorCode::StorageFailed)?;
    transaction.commit().map_err(|_| ErrorCode::StorageFailed)
}

fn validate_pull(response: &PullResponse) -> Result<()> {
    if response.current_version < 0
        || response.next_since < 0
        || response.next_since > response.current_version
        || response.changes.len() > 100
    {
        return Err(ErrorCode::DataCorrupt);
    }
    let mut previous = 0;
    for change in &response.changes {
        validate_id(&change.id)?;
        validate_id(&change.change_id)?;
        if change.version < 1
            || change.sync_version <= previous
            || change.sync_version > response.next_since
            || change.created_at < 0
            || change.updated_at < 0
            || (change.deleted && (!change.encrypted_data.is_empty() || !change.nonce.is_empty()))
        {
            return Err(ErrorCode::DataCorrupt);
        }
        previous = change.sync_version;
    }
    if response.has_more && response.changes.is_empty() {
        return Err(ErrorCode::DataCorrupt);
    }
    Ok(())
}

fn apply_change(tx: &Transaction<'_>, master_key: &[u8], change: &RemoteChange) -> Result<()> {
    let local = tx
        .query_row(
            "SELECT dirty, version, sync_version, change_id FROM items WHERE id = ?1",
            params![change.id],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .ok();
    if let Some((dirty, local_version, local_sync_version, local_change_id)) = local {
        if change.sync_version <= local_sync_version {
            return Ok(());
        }
        if dirty && local_change_id == change.change_id {
            tx.execute(
                "UPDATE items SET dirty = FALSE, base_version = ?2, sync_version = ?3 WHERE id = ?1",
                params![change.id, change.version, change.sync_version],
            )
            .map_err(|_| ErrorCode::StorageFailed)?;
            return Ok(());
        }
        if dirty && local_change_id != change.change_id {
            if change.version >= local_version {
                let next_version = change
                    .version
                    .checked_add(1)
                    .ok_or(ErrorCode::DataCorrupt)?;
                tx.execute(
                    "UPDATE items SET version = ?2, change_id = ?3, base_version = ?4,
                     sync_version = ?5 WHERE id = ?1",
                    params![
                        change.id,
                        next_version,
                        format!("{}:{}", change.id, next_version),
                        change.version,
                        change.sync_version
                    ],
                )
                .map_err(|_| ErrorCode::StorageFailed)?;
            } else {
                tx.execute(
                    "UPDATE items SET base_version = ?2, sync_version = ?3 WHERE id = ?1",
                    params![change.id, change.version, change.sync_version],
                )
                .map_err(|_| ErrorCode::StorageFailed)?;
            }
            return Ok(());
        }
    } else if change.deleted {
        return Ok(());
    }

    apply_item(tx, master_key, change)
}

fn apply_item(tx: &Transaction<'_>, master_key: &[u8], change: &RemoteChange) -> Result<()> {
    if change.deleted {
        tx.execute(
            "UPDATE items SET change_id = ?2, version = ?3, deleted = TRUE,
             updated_at = ?4, dirty = FALSE, sync_version = ?5, base_version = ?3,
             encrypted_data = X'', nonce = X'',
             encrypted_recovery_codes = X'', recovery_codes_nonce = X'',
             encrypted_passkeys = X'', passkeys_nonce = X'' WHERE id = ?1",
            params![
                change.id,
                change.change_id,
                change.version,
                change.updated_at,
                change.sync_version
            ],
        )
        .map_err(|_| ErrorCode::StorageFailed)?;
        return Ok(());
    }

    let (item_type, encrypted) = decode_item_envelope(master_key, &change.id, change)?;
    tx.execute(
        "INSERT INTO items (
            id, change_id, item_type, version, base_version, deleted,
            created_at, updated_at, encrypted_data, nonce,
            encrypted_recovery_codes, recovery_codes_nonce,
            encrypted_passkeys, passkeys_nonce, dirty, sync_version
         ) VALUES (?1,?2,?3,?4,?4,FALSE,?5,?6,?7,?8,?9,?10,?11,?12,FALSE,?13)
          ON CONFLICT(id) DO UPDATE SET
            change_id=excluded.change_id, item_type=excluded.item_type,
            version=excluded.version, base_version=excluded.base_version,
            deleted=FALSE, created_at=excluded.created_at, updated_at=excluded.updated_at,
            encrypted_data=excluded.encrypted_data, nonce=excluded.nonce,
            encrypted_recovery_codes=excluded.encrypted_recovery_codes,
            recovery_codes_nonce=excluded.recovery_codes_nonce,
            encrypted_passkeys=excluded.encrypted_passkeys,
            passkeys_nonce=excluded.passkeys_nonce, dirty=FALSE,
            sync_version=excluded.sync_version",
        params![
            change.id,
            change.change_id,
            item_type,
            change.version,
            change.created_at,
            change.updated_at,
            encrypted.encrypted_data,
            encrypted.nonce,
            encrypted.encrypted_recovery_codes,
            encrypted.recovery_codes_nonce,
            encrypted.encrypted_passkeys,
            encrypted.passkeys_nonce,
            change.sync_version,
        ],
    )
    .map_err(|_| ErrorCode::StorageFailed)?;
    Ok(())
}

fn decode_item_envelope(
    master_key: &[u8],
    item_id: &str,
    change: &RemoteChange,
) -> Result<(String, vault::EncryptedItemParts)> {
    let ciphertext = decode_canonical(&change.encrypted_data)?;
    let nonce = decode_canonical(&change.nonce)?;
    if ciphertext.len() < crypto::AEAD_TAG_LEN
        || ciphertext.len() > MAX_ITEM_CIPHERTEXT_BYTES
        || nonce.len() != crypto::NONCE_LEN
    {
        return Err(ErrorCode::DataCorrupt);
    }
    let mut envelope_bytes =
        crypto::decrypt(&sync_item_key(master_key, item_id), &nonce, &ciphertext)?;
    if envelope_bytes.len() > MAX_ITEM_ENVELOPE_BYTES {
        envelope_bytes.zeroize();
        return Err(ErrorCode::DataCorrupt);
    }
    let envelope: ItemSyncEnvelope = match serde_json::from_slice(&envelope_bytes) {
        Ok(envelope) => envelope,
        Err(_) => {
            envelope_bytes.zeroize();
            return Err(ErrorCode::DataCorrupt);
        }
    };
    envelope_bytes.zeroize();
    envelope.validate()?;
    let plaintext = serde_json::to_string(&envelope.plaintext)?;
    let encrypted = vault::encrypt_item_parts(master_key, item_id, &plaintext)?;
    Ok((envelope.item_type, encrypted))
}

fn sync_item_key(master_key: &[u8], item_id: &str) -> [u8; 32] {
    let mut context = Vec::with_capacity(ITEM_ENVELOPE_CONTEXT.len() + 4 + item_id.len());
    context.extend_from_slice(ITEM_ENVELOPE_CONTEXT);
    context.extend_from_slice(&(item_id.len() as u32).to_be_bytes());
    context.extend_from_slice(item_id.as_bytes());
    crypto::derive_key(master_key, &context)
}

fn decode_canonical(value: &str) -> Result<Vec<u8>> {
    let bytes = STANDARD.decode(value).map_err(|_| ErrorCode::DataCorrupt)?;
    if STANDARD.encode(&bytes) != value {
        return Err(ErrorCode::DataCorrupt);
    }
    Ok(bytes)
}

fn validate_id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || !value.is_ascii()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(ErrorCode::DataCorrupt);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault;
    use crate::vault::storage;

    #[test]
    fn item_wire_has_no_plaintext_metadata_fields() {
        let change = SyncChange {
            id: "item-1".to_string(),
            change_id: "item-1:1".to_string(),
            encrypted_data: STANDARD.encode([1u8; 32]),
            nonce: STANDARD.encode([2u8; 12]),
            version: 1,
            created_at: 1,
            deleted: false,
            expected_version: 0,
        };
        let value = serde_json::to_value(&change).unwrap();
        let object = value.as_object().unwrap();
        assert!(!object.contains_key("item_type"));
    }

    #[test]
    fn pending_encrypts_item_envelope_and_apply_roundtrips_plaintext() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = storage::open(&source_directory.path().join("source.db")).unwrap();
        let master_key = [7u8; 32];
        let item_id =
            vault::create_item(&source, &master_key, "login", r#"{"title":"private"}"#).unwrap();
        let changes = pending(&source, &master_key).unwrap();
        assert_eq!(changes.len(), 1);
        let change = &changes[0];
        let serialized = serde_json::to_string(change).unwrap();
        assert!(!serialized.contains("item_type"));
        assert!(!serialized.contains("private"));

        let target_directory = tempfile::tempdir().unwrap();
        let mut target = storage::open(&target_directory.path().join("target.db")).unwrap();
        storage::save_sync_config(&target, "https://sync.example.test", "device-2").unwrap();
        apply(
            &mut target,
            &master_key,
            &PullResponse {
                current_version: 1,
                next_since: 1,
                has_more: false,
                changes: vec![RemoteChange {
                    id: change.id.clone(),
                    change_id: change.change_id.clone(),
                    encrypted_data: change.encrypted_data.clone(),
                    nonce: change.nonce.clone(),
                    version: change.version,
                    deleted: false,
                    created_at: change.created_at,
                    updated_at: change.created_at,
                    sync_version: 1,
                }],
            },
        )
        .unwrap();

        assert_eq!(
            vault::get_item(&target, &master_key, &item_id).unwrap(),
            r#"{"title":"private"}"#
        );
        let item = vault::list_items(&target).unwrap().remove(0);
        assert_eq!(item.item_type, "login");
    }

    #[test]
    fn remote_newer_dirty_change_advances_local_version_without_overwriting_ciphertext() {
        let directory = tempfile::tempdir().unwrap();
        let mut conn = storage::open(&directory.path().join("sync.db")).unwrap();
        storage::save_sync_config(&conn, "https://sync.example.test", "device-1").unwrap();

        let master_key = [7u8; 32];
        let (local_nonce, local_ciphertext) = crypto::encrypt(&master_key, b"local").unwrap();
        let (remote_nonce, remote_ciphertext) = crypto::encrypt(&master_key, b"remote").unwrap();
        conn.execute(
            "INSERT INTO items (id, change_id, item_type, version, deleted,
             created_at, updated_at, encrypted_data, nonce, dirty, sync_version, base_version)
             VALUES (?1, ?2, 'login', 3, FALSE, 1, 2, ?3, ?4, TRUE, 1, 1)",
            params!["item-1", "item-1:3", local_ciphertext, local_nonce],
        )
        .unwrap();

        apply(
            &mut conn,
            &master_key,
            &PullResponse {
                current_version: 8,
                next_since: 8,
                has_more: false,
                changes: vec![RemoteChange {
                    id: "item-1".to_string(),
                    change_id: "item-1:5".to_string(),
                    encrypted_data: STANDARD.encode(remote_ciphertext),
                    nonce: STANDARD.encode(remote_nonce),
                    version: 5,
                    deleted: false,
                    created_at: 1,
                    updated_at: 3,
                    sync_version: 2,
                }],
            },
        )
        .unwrap();

        let row = conn
            .query_row(
                "SELECT dirty, version, change_id, base_version, sync_version, encrypted_data
                 FROM items WHERE id = 'item-1'",
                [],
                |row| {
                    Ok((
                        row.get::<_, bool>(0)?,
                        row.get::<_, i32>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i32>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, Vec<u8>>(5)?,
                    ))
                },
            )
            .unwrap();

        assert!(row.0);
        assert_eq!(row.1, 6);
        assert_eq!(row.2, "item-1:6");
        assert_eq!(row.3, 5);
        assert_eq!(row.4, 2);
        assert_eq!(row.5, local_ciphertext);
    }
}
