//! Strict CSV preview and transactional import.

use crate::error::{ErrorCode, Result};
use crate::vault;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CsvFormat {
    Bitwarden,
    OnePassword,
    Chrome,
}

impl CsvFormat {
    fn as_str(self) -> &'static str {
        match self {
            Self::Bitwarden => "bitwarden",
            Self::OnePassword => "1password",
            Self::Chrome => "chrome",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub format: String,
    pub rows: usize,
    pub sample: Vec<CsvPreviewRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreviewRow {
    pub title: String,
    pub username: String,
    pub url: String,
    pub has_password: bool,
    pub has_totp: bool,
    pub has_recovery_codes: bool,
    pub has_passkeys: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub errors: usize,
}

#[derive(Debug, Default)]
struct MappedRow {
    title: String,
    username: String,
    password: String,
    url: String,
    totp: String,
    recovery_codes: String,
    passkeys: String,
    notes: String,
    item_type: String,
}

pub fn preview_csv(content: &str) -> Result<CsvPreview> {
    let (format, rows) = parse_rows(content)?;
    let sample = rows
        .iter()
        .take(5)
        .map(|row| CsvPreviewRow {
            title: row.title.clone(),
            username: row.username.clone(),
            url: row.url.clone(),
            has_password: !row.password.is_empty(),
            has_totp: !row.totp.is_empty(),
            has_recovery_codes: !row.recovery_codes.is_empty(),
            has_passkeys: !row.passkeys.is_empty(),
        })
        .collect();
    Ok(CsvPreview {
        format: format.as_str().into(),
        rows: rows.len(),
        sample,
    })
}

pub fn import_csv(conn: &Connection, master_key: &[u8], content: &str) -> Result<ImportSummary> {
    let (_, rows) = parse_rows(content)?;
    let transaction = conn.unchecked_transaction()?;
    let mut imported = 0;
    let mut skipped = 0;

    for row in rows {
        if row.title.is_empty()
            || (row.username.is_empty()
                && row.password.is_empty()
                && row.totp.is_empty()
                && row.recovery_codes.is_empty()
                && row.passkeys.is_empty()
                && row.notes.is_empty())
        {
            skipped += 1;
            continue;
        }
        let item_type = if row.item_type == "note" {
            "note"
        } else {
            "login"
        };
        vault::create_item(&transaction, master_key, item_type, &row.json()?)?;
        imported += 1;
    }

    transaction.commit()?;
    Ok(ImportSummary {
        imported,
        skipped,
        errors: 0,
    })
}

impl MappedRow {
    fn json(&self) -> Result<String> {
        let mut value = serde_json::Map::new();
        value.insert("title".into(), self.title.clone().into());
        for (key, field) in [
            ("username", &self.username),
            ("password", &self.password),
            ("url", &self.url),
            ("totp", &self.totp),
            ("recoveryCodes", &self.recovery_codes),
            ("notes", &self.notes),
        ] {
            if !field.is_empty() {
                value.insert(key.into(), field.clone().into());
            }
        }
        let passkeys = self
            .passkeys
            .split(['\n', '\r'])
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if !passkeys.is_empty() {
            value.insert("passkeys".into(), serde_json::to_value(passkeys)?);
        }
        serde_json::to_string(&value).map_err(ErrorCode::from)
    }
}

fn parse_rows(content: &str) -> Result<(CsvFormat, Vec<MappedRow>)> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(content.as_bytes());
    let headers = reader.headers()?.clone();
    let index: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .map(|(position, name)| (name.trim().to_ascii_lowercase(), position))
        .collect();
    let format = detect_format(&index)?;
    let rows = reader
        .records()
        .map(|record| {
            record
                .map_err(ErrorCode::from)
                .map(|record| map_row(format, &record, &index))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((format, rows))
}

fn detect_format(index: &HashMap<String, usize>) -> Result<CsvFormat> {
    let has = |name: &str| index.contains_key(name);
    if has("login_uri") || has("login_username") || has("login_password") {
        Ok(CsvFormat::Bitwarden)
    } else if has("title") && has("username") && has("password") {
        Ok(CsvFormat::OnePassword)
    } else if has("name") && has("url") && has("username") && has("password") {
        Ok(CsvFormat::Chrome)
    } else {
        Err(ErrorCode::InvalidInput)
    }
}

fn map_row(
    format: CsvFormat,
    record: &csv::StringRecord,
    index: &HashMap<String, usize>,
) -> MappedRow {
    let field = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| index.get(*name).and_then(|position| record.get(*position)))
            .unwrap_or("")
            .trim()
            .to_owned()
    };
    match format {
        CsvFormat::Bitwarden => MappedRow {
            title: field(&["name"]),
            username: field(&["login_username", "username"]),
            password: field(&["login_password", "password"]),
            url: field(&["login_uri", "url"]),
            totp: field(&["login_totp"]),
            recovery_codes: field(&["login_recovery_codes", "recovery_codes", "recoverycodes"]),
            passkeys: field(&["login_passkeys", "passkeys", "passkey"]),
            notes: field(&["notes"]),
            item_type: field(&["type"]).to_ascii_lowercase(),
        },
        CsvFormat::OnePassword => MappedRow {
            title: field(&["title"]),
            username: field(&["username"]),
            password: field(&["password"]),
            url: field(&["url"]),
            totp: field(&["otpauth"]),
            recovery_codes: field(&["recovery_codes", "recoverycodes"]),
            passkeys: field(&["passkeys", "passkey"]),
            notes: field(&["notes"]),
            item_type: field(&["type"]).to_ascii_lowercase(),
        },
        CsvFormat::Chrome => MappedRow {
            title: field(&["name"]),
            username: field(&["username"]),
            password: field(&["password"]),
            url: field(&["url"]),
            recovery_codes: field(&["recovery_codes", "recoverycodes"]),
            passkeys: field(&["passkeys", "passkey"]),
            ..Default::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::keychain;

    const BITWARDEN: &str = "type,name,notes,login_uri,login_username,login_password,login_totp\n\
login,GitHub,work account,github.com,alice@example.com,hunter2,JBSWY3DPEHPK3PXP\n\
login,Empty,,example.com,,,\n";

    fn setup() -> (Connection, [u8; 32]) {
        let directory = tempfile::tempdir().unwrap();
        let conn = vault::storage::open(&directory.path().join("test.db")).unwrap();
        let (_, keys) = keychain::initialize(b"test").unwrap();
        (conn, keys.master_key)
    }

    #[test]
    fn preview_and_import_share_the_same_mapping() {
        let preview = preview_csv(BITWARDEN).unwrap();
        assert_eq!(preview.format, "bitwarden");
        assert_eq!(preview.rows, 2);
        assert!(preview.sample[0].has_password);
        assert!(preview.sample[0].has_totp);

        let (conn, master_key) = setup();
        let summary = import_csv(&conn, &master_key, BITWARDEN).unwrap();
        assert_eq!(summary.imported, 1);
        assert_eq!(summary.skipped, 1);
        let item = vault::list_items(&conn).unwrap().remove(0);
        assert!(
            vault::get_item(&conn, &master_key, &item.id)
                .unwrap()
                .contains("hunter2")
        );
    }

    #[test]
    fn rejects_unknown_or_empty_csv() {
        assert_eq!(
            preview_csv("foo,bar\n1,2\n").unwrap_err(),
            ErrorCode::InvalidInput
        );
        assert!(preview_csv("").is_err());
    }
}
