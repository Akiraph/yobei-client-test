//! Encrypted vault records.

pub mod export;
pub mod import;
pub mod storage;

use crate::error::{ErrorCode, Result};
use crate::security::crypto::{self, derive_key};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const MAX_ITEM_JSON_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub change_id: String,
    pub item_type: String,
    pub version: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub encrypted_data: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encrypted_recovery_codes: Vec<u8>,
    pub recovery_codes_nonce: Vec<u8>,
    pub encrypted_passkeys: Vec<u8>,
    pub passkeys_nonce: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct EncryptedItemParts {
    pub encrypted_data: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encrypted_recovery_codes: Vec<u8>,
    pub recovery_codes_nonce: Vec<u8>,
    pub encrypted_passkeys: Vec<u8>,
    pub passkeys_nonce: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemSummary {
    pub id: String,
    pub item_type: String,
    pub version: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn create_item(
    conn: &Connection,
    master_key: &[u8],
    item_type: &str,
    plaintext_json: &str,
) -> Result<String> {
    if !matches!(item_type, "login" | "note") {
        return Err(ErrorCode::InvalidInput);
    }
    let id = Uuid::new_v4().to_string();
    let encrypted = encrypt_item_parts(master_key, &id, plaintext_json)?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO items (
            id, change_id, item_type, version, deleted,
            created_at, updated_at, encrypted_data, nonce,
            encrypted_recovery_codes, recovery_codes_nonce,
            encrypted_passkeys, passkeys_nonce, dirty, sync_version, base_version
         ) VALUES (?1, ?1 || ':1', ?2, 1, FALSE, ?3, ?3,
                   ?4, ?5, ?6, ?7, ?8, ?9, TRUE, 0, 0)",
        params![
            id,
            item_type,
            now,
            encrypted.encrypted_data,
            encrypted.nonce,
            encrypted.encrypted_recovery_codes,
            encrypted.recovery_codes_nonce,
            encrypted.encrypted_passkeys,
            encrypted.passkeys_nonce,
        ],
    )?;
    Ok(id)
}

pub fn get_item(conn: &Connection, master_key: &[u8], item_id: &str) -> Result<String> {
    let (
        encrypted_data,
        nonce,
        encrypted_recovery_codes,
        recovery_codes_nonce,
        encrypted_passkeys,
        passkeys_nonce,
    ) = conn
        .query_row(
            "SELECT encrypted_data, nonce, encrypted_recovery_codes, recovery_codes_nonce,
                    encrypted_passkeys, passkeys_nonce
             FROM items WHERE id = ?1 AND deleted = FALSE",
            params![item_id],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => ErrorCode::ItemNotFound,
            _ => ErrorCode::StorageFailed,
        })?;
    let key = derive_key(master_key, item_id.as_bytes());
    let mut value: Value =
        serde_json::from_slice(&crypto::decrypt(&key, &nonce, &encrypted_data)?)?;
    if let Some(object) = value.as_object_mut() {
        if let Some(recovery_codes) =
            decrypt_optional_field(&key, &encrypted_recovery_codes, &recovery_codes_nonce)?
        {
            object.insert("recoveryCodes".into(), Value::String(recovery_codes));
        }
        if let Some(passkeys_json) =
            decrypt_optional_field(&key, &encrypted_passkeys, &passkeys_nonce)?
        {
            let passkeys: Value =
                serde_json::from_str(&passkeys_json).map_err(|_| ErrorCode::DataCorrupt)?;
            if !passkeys.is_array() {
                return Err(ErrorCode::DataCorrupt);
            }
            object.insert("passkeys".into(), passkeys);
        }
    }
    serde_json::to_string(&value).map_err(ErrorCode::from)
}

pub fn update_item(
    conn: &Connection,
    master_key: &[u8],
    item_id: &str,
    plaintext_json: &str,
) -> Result<()> {
    let encrypted = encrypt_item_parts(master_key, item_id, plaintext_json)?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE items SET
            encrypted_data = ?1, nonce = ?2,
            encrypted_recovery_codes = ?3, recovery_codes_nonce = ?4,
            encrypted_passkeys = ?5, passkeys_nonce = ?6,
            version = version + 1, change_id = id || ':' || (version + 1),
            updated_at = ?7, dirty = TRUE
         WHERE id = ?8 AND deleted = FALSE",
        params![
            encrypted.encrypted_data,
            encrypted.nonce,
            encrypted.encrypted_recovery_codes,
            encrypted.recovery_codes_nonce,
            encrypted.encrypted_passkeys,
            encrypted.passkeys_nonce,
            now,
            item_id,
        ],
    )?;
    changed(conn, ErrorCode::ItemNotFound)
}

pub fn delete_item(conn: &Connection, item_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE items SET
            deleted = TRUE, version = version + 1,
            change_id = id || ':' || (version + 1), updated_at = ?1, dirty = TRUE
         WHERE id = ?2 AND deleted = FALSE",
        params![chrono::Utc::now().timestamp_millis(), item_id],
    )?;
    changed(conn, ErrorCode::ItemNotFound)
}

pub fn list_items(conn: &Connection) -> Result<Vec<ItemSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, item_type, version, created_at, updated_at
         FROM items WHERE deleted = FALSE ORDER BY updated_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(ItemSummary {
            id: row.get(0)?,
            item_type: row.get(1)?,
            version: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(ErrorCode::from)
}

pub fn all_items(conn: &Connection) -> Result<Vec<Item>> {
    let mut statement = conn.prepare(
        "SELECT id, change_id, item_type, version,
                created_at, updated_at, encrypted_data, nonce,
                encrypted_recovery_codes, recovery_codes_nonce,
                encrypted_passkeys, passkeys_nonce
         FROM items WHERE deleted = FALSE",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Item {
            id: row.get(0)?,
            change_id: row.get(1)?,
            item_type: row.get(2)?,
            version: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            encrypted_data: row.get(6)?,
            nonce: row.get(7)?,
            encrypted_recovery_codes: row.get(8)?,
            recovery_codes_nonce: row.get(9)?,
            encrypted_passkeys: row.get(10)?,
            passkeys_nonce: row.get(11)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(ErrorCode::from)
}

pub(crate) fn encrypt_item_parts(
    master_key: &[u8],
    item_id: &str,
    plaintext_json: &str,
) -> Result<EncryptedItemParts> {
    if plaintext_json.is_empty() || plaintext_json.len() > MAX_ITEM_JSON_BYTES {
        return Err(ErrorCode::InvalidInput);
    }
    let mut value: Value =
        serde_json::from_str(plaintext_json).map_err(|_| ErrorCode::InvalidInput)?;
    let (recovery_codes, passkeys) = if let Some(object) = value.as_object_mut() {
        (
            take_optional_string(object, "recoveryCodes"),
            take_optional_passkeys(object, "passkeys")?,
        )
    } else {
        (None, None)
    };
    let base_json = serde_json::to_vec(&value).map_err(ErrorCode::from)?;
    let key = derive_key(master_key, item_id.as_bytes());
    let (nonce, encrypted_data) = crypto::encrypt(&key, &base_json)?;
    let (recovery_codes_nonce, encrypted_recovery_codes) =
        encrypt_optional_field(&key, recovery_codes.as_deref())?;
    let (passkeys_nonce, encrypted_passkeys) = encrypt_optional_field(&key, passkeys.as_deref())?;
    Ok(EncryptedItemParts {
        encrypted_data,
        nonce,
        encrypted_recovery_codes,
        recovery_codes_nonce,
        encrypted_passkeys,
        passkeys_nonce,
    })
}

fn take_optional_string(object: &mut serde_json::Map<String, Value>, key: &str) -> Option<String> {
    object.remove(key).and_then(|value| {
        value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    })
}

fn take_optional_passkeys(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<String>> {
    let Some(value) = object.remove(key) else {
        return Ok(None);
    };
    let Some(values) = value.as_array() else {
        return Err(ErrorCode::InvalidInput);
    };
    let passkeys = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if passkeys.is_empty() {
        Ok(None)
    } else {
        serde_json::to_string(&passkeys)
            .map(Some)
            .map_err(ErrorCode::from)
    }
}

fn encrypt_optional_field(key: &[u8; 32], value: Option<&str>) -> Result<(Vec<u8>, Vec<u8>)> {
    value.map_or_else(
        || Ok((Vec::new(), Vec::new())),
        |value| crypto::encrypt(key, value.as_bytes()),
    )
}

fn decrypt_optional_field(
    key: &[u8; 32],
    encrypted: &[u8],
    nonce: &[u8],
) -> Result<Option<String>> {
    if encrypted.is_empty() && nonce.is_empty() {
        return Ok(None);
    }
    if encrypted.is_empty() || nonce.is_empty() {
        return Err(ErrorCode::DataCorrupt);
    }
    let plaintext = crypto::decrypt(key, nonce, encrypted)?;
    String::from_utf8(plaintext)
        .map(Some)
        .map_err(|_| ErrorCode::DataCorrupt)
}

fn changed(conn: &Connection, not_found: ErrorCode) -> Result<()> {
    if conn.changes() == 0 {
        Err(not_found)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::keychain;

    fn setup() -> (Connection, [u8; 32]) {
        let directory = tempfile::tempdir().unwrap();
        let conn = storage::open(&directory.path().join("test.db")).unwrap();
        let (_, keys) = keychain::initialize(b"test").unwrap();
        (conn, keys.master_key)
    }

    #[test]
    fn item_crud_uses_tombstones() {
        let (conn, master_key) = setup();
        let id = create_item(&conn, &master_key, "login", r#"{"title":"old"}"#).unwrap();
        assert_eq!(
            get_item(&conn, &master_key, &id).unwrap(),
            r#"{"title":"old"}"#
        );

        update_item(&conn, &master_key, &id, r#"{"title":"new"}"#).unwrap();
        assert_eq!(list_items(&conn).unwrap()[0].version, 2);

        delete_item(&conn, &id).unwrap();
        assert!(list_items(&conn).unwrap().is_empty());
        assert_eq!(
            get_item(&conn, &master_key, &id),
            Err(ErrorCode::ItemNotFound)
        );
    }

    #[test]
    fn wrong_key_cannot_decrypt_an_item() {
        let (conn, master_key) = setup();
        let id = create_item(&conn, &master_key, "login", r#"{"value":"secret"}"#).unwrap();
        assert!(get_item(&conn, &[0x55; 32], &id).is_err());
    }
}
