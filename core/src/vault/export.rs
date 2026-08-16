//! Current-format encrypted backup restore and plaintext CSV export.

use crate::error::{ErrorCode, Result};
use crate::security::crypto;
use crate::security::keychain::{self, KeyStoreData};
use crate::vault;
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const FORMAT: &str = "yobei-vault";
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct VaultExport {
    format: String,
    version: u32,
    keystore: ExportKeyStore,
    items: Vec<ExportItem>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportKeyStore {
    secret_key: String,
    wrapped_master_key: String,
    master_key_nonce: String,
    kek_salt: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportItem {
    id: String,
    item_type: String,
    encrypted_data: String,
    nonce: String,
    encrypted_recovery_codes: String,
    recovery_codes_nonce: String,
    encrypted_passkeys: String,
    passkeys_nonce: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub items: usize,
}

pub fn export_vault_json(conn: &Connection, device_key: &[u8]) -> Result<String> {
    let store =
        vault::storage::load_key_store(conn, device_key)?.ok_or(ErrorCode::NotInitialized)?;
    let export = VaultExport {
        format: FORMAT.into(),
        version: VERSION,
        keystore: ExportKeyStore::from(store),
        items: vault::all_items(conn)?
            .into_iter()
            .map(|item| ExportItem {
                id: item.id,
                item_type: item.item_type,
                encrypted_data: B64.encode(item.encrypted_data),
                nonce: B64.encode(item.nonce),
                encrypted_recovery_codes: B64.encode(item.encrypted_recovery_codes),
                recovery_codes_nonce: B64.encode(item.recovery_codes_nonce),
                encrypted_passkeys: B64.encode(item.encrypted_passkeys),
                passkeys_nonce: B64.encode(item.passkeys_nonce),
            })
            .collect(),
    };
    serde_json::to_string_pretty(&export).map_err(ErrorCode::from)
}

pub fn import_vault_json(
    conn: &Connection,
    current_master_key: &[u8],
    content: &str,
    source_password: &str,
) -> Result<RestoreSummary> {
    let export: VaultExport = serde_json::from_str(content)?;
    if export.format != FORMAT || export.version != VERSION {
        return Err(ErrorCode::InvalidInput);
    }
    let source_keys = keychain::unlock(source_password.as_bytes(), &export.keystore.try_into()?)?;
    let transaction = conn.unchecked_transaction()?;
    for item in &export.items {
        let mut value: serde_json::Value = serde_json::from_str(&decrypt_text(
            &source_keys.master_key,
            &item.id,
            &item.nonce,
            &item.encrypted_data,
        )?)?;
        merge_optional_fields(&source_keys.master_key, item, &mut value)?;
        let plaintext = serde_json::to_string(&value)?;
        vault::create_item(
            &transaction,
            current_master_key,
            &item.item_type,
            &plaintext,
        )?;
    }

    let summary = RestoreSummary {
        items: export.items.len(),
    };
    transaction.commit()?;
    Ok(summary)
}

pub fn export_csv(conn: &Connection, master_key: &[u8]) -> Result<String> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record([
        "type",
        "name",
        "notes",
        "login_uri",
        "login_username",
        "login_password",
        "login_totp",
        "login_recovery_codes",
        "login_passkeys",
    ])?;

    for item in vault::all_items(conn)? {
        let value: serde_json::Value =
            serde_json::from_str(&vault::get_item(conn, master_key, &item.id)?)?;
        let text = |key: &str| {
            value
                .get(key)
                .and_then(|entry| entry.as_str())
                .unwrap_or("")
                .to_owned()
        };
        let passkeys = value
            .get("passkeys")
            .and_then(|entry| entry.as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        writer.write_record([
            if item.item_type == "note" {
                "note".into()
            } else {
                "login".into()
            },
            text("title"),
            text("notes"),
            text("url"),
            text("username"),
            text("password"),
            text("totp"),
            text("recoveryCodes"),
            passkeys,
        ])?;
    }

    let bytes = writer.into_inner().map_err(|_| ErrorCode::FileFailed)?;
    String::from_utf8(bytes).map_err(|_| ErrorCode::DataCorrupt)
}

fn decrypt_text(master_key: &[u8], id: &str, nonce: &str, encrypted_data: &str) -> Result<String> {
    let plaintext = crypto::decrypt(
        &crypto::derive_key(master_key, id.as_bytes()),
        &decode(nonce)?,
        &decode(encrypted_data)?,
    )?;
    String::from_utf8(plaintext).map_err(|_| ErrorCode::DataCorrupt)
}

fn merge_optional_fields(
    master_key: &[u8],
    item: &ExportItem,
    value: &mut serde_json::Value,
) -> Result<()> {
    let object = value.as_object_mut().ok_or(ErrorCode::DataCorrupt)?;
    if let Some(recovery_codes) = decrypt_optional_text(
        master_key,
        &item.id,
        &item.recovery_codes_nonce,
        &item.encrypted_recovery_codes,
    )? {
        object.insert("recoveryCodes".into(), recovery_codes.into());
    }
    if let Some(passkeys) = decrypt_optional_text(
        master_key,
        &item.id,
        &item.passkeys_nonce,
        &item.encrypted_passkeys,
    )? {
        let passkeys: serde_json::Value =
            serde_json::from_str(&passkeys).map_err(|_| ErrorCode::DataCorrupt)?;
        if !passkeys.is_array() {
            return Err(ErrorCode::DataCorrupt);
        }
        object.insert("passkeys".into(), passkeys);
    }
    Ok(())
}

fn decrypt_optional_text(
    master_key: &[u8],
    id: &str,
    nonce: &str,
    encrypted_data: &str,
) -> Result<Option<String>> {
    if nonce.is_empty() && encrypted_data.is_empty() {
        return Ok(None);
    }
    if nonce.is_empty() || encrypted_data.is_empty() {
        return Err(ErrorCode::DataCorrupt);
    }
    decrypt_text(master_key, id, nonce, encrypted_data).map(Some)
}

fn decode(value: &str) -> Result<Vec<u8>> {
    B64.decode(value).map_err(|_| ErrorCode::DataCorrupt)
}

impl From<KeyStoreData> for ExportKeyStore {
    fn from(store: KeyStoreData) -> Self {
        Self {
            secret_key: B64.encode(store.secret_key),
            wrapped_master_key: B64.encode(store.wrapped_master_key),
            master_key_nonce: B64.encode(store.master_key_nonce),
            kek_salt: B64.encode(store.kek_salt),
        }
    }
}

impl TryFrom<ExportKeyStore> for KeyStoreData {
    type Error = ErrorCode;

    fn try_from(store: ExportKeyStore) -> Result<Self> {
        Ok(Self {
            secret_key: decode(&store.secret_key)?,
            wrapped_master_key: decode(&store.wrapped_master_key)?,
            master_key_nonce: decode(&store.master_key_nonce)?,
            kek_salt: decode(&store.kek_salt)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Connection, [u8; 32], [u8; 32]) {
        let directory = tempfile::tempdir().unwrap();
        let conn = vault::storage::open(&directory.path().join("test.db")).unwrap();
        let (store, keys) = keychain::initialize(b"source password").unwrap();
        let device_key = [0x42; 32];
        vault::storage::save_key_store(&conn, &device_key, &store).unwrap();
        (conn, keys.master_key, device_key)
    }

    #[test]
    fn encrypted_backup_does_not_expose_vault_content() {
        let (conn, master_key, device_key) = setup();
        vault::create_item(
            &conn,
            &master_key,
            "login",
            r#"{"title":"Bank","password":"secret"}"#,
        )
        .unwrap();

        let backup = export_vault_json(&conn, &device_key).unwrap();
        // Assert the *values* never leak. A bare `contains("secret")` would
        // match the `"secret_key"` field name, so quote the values as JSON.
        assert!(!backup.contains("\"Bank\""));
        assert!(!backup.contains("\"secret\""));
    }

    #[test]
    fn restore_rekeys_current_format_atomically() {
        let (source, source_master_key, device_key) = setup();
        vault::create_item(
            &source,
            &source_master_key,
            "login",
            r#"{"title":"GitHub","password":"secret"}"#,
        )
        .unwrap();
        let backup = export_vault_json(&source, &device_key).unwrap();

        let directory = tempfile::tempdir().unwrap();
        let target = vault::storage::open(&directory.path().join("target.db")).unwrap();
        let (_, target_keys) = keychain::initialize(b"target password").unwrap();
        let summary =
            import_vault_json(&target, &target_keys.master_key, &backup, "source password")
                .unwrap();

        assert_eq!(summary.items, 1);
        let item = vault::list_items(&target).unwrap().remove(0);
        assert!(
            vault::get_item(&target, &target_keys.master_key, &item.id)
                .unwrap()
                .contains("secret")
        );
    }

    #[test]
    fn restore_rejects_other_versions() {
        let (conn, _, device_key) = setup();
        let backup = export_vault_json(&conn, &device_key)
            .unwrap()
            .replace("\"version\": 1", "\"version\": 2");
        assert_eq!(
            import_vault_json(&conn, &[0; 32], &backup, "source password").unwrap_err(),
            ErrorCode::InvalidInput
        );
    }
}
