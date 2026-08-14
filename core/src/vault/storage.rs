//! SQLite persistence for local encrypted state.

use crate::error::{ErrorCode, Result};
use crate::security::crypto;
use crate::security::keychain::KeyStoreData;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::path::Path;
use std::time::Duration;

const SCHEMA_VERSION: i64 = 1;
const PAIRING_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS key_store (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data BLOB NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data BLOB NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            change_id TEXT NOT NULL,
            item_type TEXT NOT NULL,
            version INTEGER NOT NULL,
            deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            encrypted_data BLOB NOT NULL,
            nonce BLOB NOT NULL,
            encrypted_recovery_codes BLOB NOT NULL DEFAULT X'',
            recovery_codes_nonce BLOB NOT NULL DEFAULT X'',
            encrypted_passkeys BLOB NOT NULL DEFAULT X'',
            passkeys_nonce BLOB NOT NULL DEFAULT X'',
            dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
            sync_version INTEGER NOT NULL,
            base_version INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS biometric_secret (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data BLOB NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            server_url TEXT NOT NULL,
            device_id TEXT NOT NULL,
            last_synced_version INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_device_transfer (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data BLOB NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pairing (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            code TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paired_extensions (
            device_id TEXT PRIMARY KEY,
            paired_at INTEGER NOT NULL,
            pubkey TEXT NOT NULL
        );",
    )?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

pub fn seal(device_key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
    let (nonce, ciphertext) = crypto::encrypt(device_key, plaintext)?;
    Ok([nonce, ciphertext].concat())
}

pub fn open_seal(device_key: &[u8], blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < crypto::NONCE_LEN {
        return Err(ErrorCode::DataCorrupt);
    }
    let (nonce, ciphertext) = blob.split_at(crypto::NONCE_LEN);
    crypto::decrypt(device_key, nonce, ciphertext)
}

pub fn save_key_store(conn: &Connection, device_key: &[u8], store: &KeyStoreData) -> Result<()> {
    save_sealed(conn, "key_store", "created_at", device_key, store)
}

pub fn load_key_store(conn: &Connection, device_key: &[u8]) -> Result<Option<KeyStoreData>> {
    load_sealed(conn, "key_store", device_key)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecuritySettings {
    pub auto_lock_min: u32,
    pub confirm_days: u32,
    pub clipboard_sec: u32,
    pub last_password_confirm_at: i64,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            auto_lock_min: 5,
            confirm_days: 14,
            clipboard_sec: 20,
            last_password_confirm_at: 0,
        }
    }
}

pub fn save_security_settings(
    conn: &Connection,
    device_key: &[u8],
    settings: &SecuritySettings,
) -> Result<()> {
    save_sealed(conn, "settings", "updated_at", device_key, settings)
}

pub fn load_security_settings(conn: &Connection, device_key: &[u8]) -> Result<SecuritySettings> {
    Ok(load_sealed(conn, "settings", device_key)?.unwrap_or_default())
}

fn save_sealed<T: Serialize>(
    conn: &Connection,
    table: &str,
    timestamp_column: &str,
    device_key: &[u8],
    value: &T,
) -> Result<()> {
    let data = seal(device_key, &serde_json::to_vec(value)?)?;
    let sql =
        format!("INSERT OR REPLACE INTO {table} (id, data, {timestamp_column}) VALUES (1, ?1, ?2)");
    conn.execute(&sql, params![data, now()])?;
    Ok(())
}

fn load_sealed<T: DeserializeOwned>(
    conn: &Connection,
    table: &str,
    device_key: &[u8],
) -> Result<Option<T>> {
    let sql = format!("SELECT data FROM {table} WHERE id = 1");
    let data = conn
        .query_row(&sql, [], |row| row.get::<_, Vec<u8>>(0))
        .optional()?;
    data.map(|blob| serde_json::from_slice(&open_seal(device_key, &blob)?).map_err(ErrorCode::from))
        .transpose()
}

pub fn save_biometric_secret(conn: &Connection, blob: &[u8]) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO biometric_secret (id, data, created_at) VALUES (1, ?1, ?2)",
        params![blob, now()],
    )?;
    Ok(())
}

pub fn load_biometric_secret(conn: &Connection) -> Result<Option<Vec<u8>>> {
    conn.query_row(
        "SELECT data FROM biometric_secret WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(ErrorCode::from)
}

pub fn delete_biometric_secret(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM biometric_secret WHERE id = 1", [])?;
    Ok(())
}

pub fn save_sync_config(conn: &Connection, server_url: &str, device_id: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO sync_config
         (id, server_url, device_id, last_synced_version, updated_at)
         VALUES (1, ?1, ?2, 0, ?3)",
        params![server_url, device_id, now()],
    )?;
    Ok(())
}

pub fn load_sync_config(conn: &Connection) -> Result<Option<crate::sync::SyncConfig>> {
    conn.query_row(
        "SELECT server_url, device_id, last_synced_version FROM sync_config WHERE id = 1",
        [],
        |row| {
            Ok(crate::sync::SyncConfig {
                server_url: row.get(0)?,
                device_id: row.get(1)?,
                last_synced_version: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(ErrorCode::from)
}

pub fn save_pending_transfer(conn: &Connection, data: &[u8], expires_at: i64) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO pending_device_transfer (id, data, expires_at) VALUES (1, ?1, ?2)",
        params![data, expires_at],
    )?;
    Ok(())
}

pub fn load_pending_transfer(conn: &Connection) -> Result<Option<(Vec<u8>, i64)>> {
    conn.query_row(
        "SELECT data, expires_at FROM pending_device_transfer WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(ErrorCode::from)
}

pub fn clear_pending_transfer(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM pending_device_transfer WHERE id = 1", [])?;
    Ok(())
}

pub fn get_or_create_pairing_code(conn: &Connection) -> Result<String> {
    if let Some(code) = conn
        .query_row("SELECT code FROM pairing WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()?
    {
        return Ok(code);
    }
    regenerate_pairing_code(conn)
}

pub fn regenerate_pairing_code(conn: &Connection) -> Result<String> {
    let bytes = crypto::random_bytes(8);
    let code: String = bytes
        .iter()
        .map(|byte| PAIRING_ALPHABET[*byte as usize % PAIRING_ALPHABET.len()] as char)
        .collect();
    conn.execute(
        "INSERT OR REPLACE INTO pairing (id, code, updated_at) VALUES (1, ?1, ?2)",
        params![code, now()],
    )?;
    Ok(code)
}

pub fn pair_extension(conn: &Connection, device_id: &str, pubkey: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO paired_extensions (device_id, paired_at, pubkey)
         VALUES (?1, ?2, ?3)",
        params![device_id, now(), pubkey],
    )?;
    Ok(())
}

pub fn get_extension_pubkey(conn: &Connection, device_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT pubkey FROM paired_extensions WHERE device_id = ?1",
        [device_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(ErrorCode::from)
}

pub fn list_paired_extensions(conn: &Connection) -> Result<Vec<String>> {
    let mut statement =
        conn.prepare("SELECT device_id FROM paired_extensions ORDER BY paired_at")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(ErrorCode::from)
}

pub fn clear_paired_extensions(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM paired_extensions", [])?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ItemBlob {
    pub id: String,
    pub item_type: String,
    pub version: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub encrypted_data: Vec<u8>,
    pub nonce: Vec<u8>,
}

pub fn list_item_blobs(conn: &Connection) -> Result<Vec<ItemBlob>> {
    let mut statement = conn.prepare(
        "SELECT id, item_type, version, created_at,
                updated_at, encrypted_data, nonce
         FROM items WHERE deleted = FALSE ORDER BY updated_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(ItemBlob {
            id: row.get(0)?,
            item_type: row.get(1)?,
            version: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            encrypted_data: row.get(5)?,
            nonce: row.get(6)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(ErrorCode::from)
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::keychain;

    #[test]
    fn sealed_state_roundtrips_and_rejects_another_device_key() {
        let directory = tempfile::tempdir().unwrap();
        let conn = open(&directory.path().join("vault.db")).unwrap();
        let (store, _) = keychain::initialize(b"master password").unwrap();
        let device_key = [0x42; 32];
        save_key_store(&conn, &device_key, &store).unwrap();
        assert_eq!(
            load_key_store(&conn, &device_key)
                .unwrap()
                .unwrap()
                .secret_key,
            store.secret_key
        );
        assert!(load_key_store(&conn, &[0x24; 32]).is_err());

        let settings = SecuritySettings {
            auto_lock_min: 1,
            confirm_days: 30,
            clipboard_sec: 10,
            last_password_confirm_at: 1234,
        };
        save_security_settings(&conn, &device_key, &settings).unwrap();
        assert_eq!(
            load_security_settings(&conn, &device_key)
                .unwrap()
                .confirm_days,
            30
        );
    }

    #[test]
    fn extension_pairing_has_no_vault_user_identity() {
        let directory = tempfile::tempdir().unwrap();
        let conn = open(&directory.path().join("pairing.db")).unwrap();
        let first_code = get_or_create_pairing_code(&conn).unwrap();
        assert_eq!(get_or_create_pairing_code(&conn).unwrap(), first_code);
        assert_ne!(regenerate_pairing_code(&conn).unwrap(), first_code);

        pair_extension(&conn, "extension-1", "public-key").unwrap();
        assert_eq!(
            get_extension_pubkey(&conn, "extension-1")
                .unwrap()
                .as_deref(),
            Some("public-key")
        );
        clear_paired_extensions(&conn).unwrap();
        assert!(list_paired_extensions(&conn).unwrap().is_empty());
    }
}
