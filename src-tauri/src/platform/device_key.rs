use std::path::Path;
use yobei_core::error::{ErrorCode, Result};

const DEVICE_KEY_LEN: usize = 32;

pub fn load_or_create(secret_path: &Path) -> Result<[u8; DEVICE_KEY_LEN]> {
    match std::fs::read(secret_path) {
        Ok(blob) => match open(&blob) {
            Ok(key) => Ok(key),
            Err(error) => {
                eprintln!(
                    "[yobei] device secret cannot be recovered ({error}); preserving it and creating a new one"
                );
                quarantine(secret_path)?;
                create(secret_path)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => create(secret_path),
        Err(error) => {
            eprintln!("[yobei] failed to read device secret: {error}");
            Err(ErrorCode::FileFailed)
        }
    }
}

fn quarantine(secret_path: &Path) -> Result<()> {
    for index in 0..100 {
        let suffix = if index == 0 {
            "invalid".to_string()
        } else {
            format!("invalid-{index}")
        };
        let backup_path = secret_path.with_file_name(format!("device.key.{suffix}"));
        match std::fs::rename(secret_path, &backup_path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                eprintln!("[yobei] failed to preserve invalid device secret: {error}");
                return Err(ErrorCode::FileFailed);
            }
        }
    }
    Err(ErrorCode::FileFailed)
}

fn create(secret_path: &Path) -> Result<[u8; DEVICE_KEY_LEN]> {
    let key: [u8; DEVICE_KEY_LEN] = yobei_core::security::crypto::random_bytes(DEVICE_KEY_LEN)
        .try_into()
        .map_err(|_| ErrorCode::CryptoFailed)?;
    let blob = crate::platform::biometric::protect_device_secret(&key)?;
    let temporary_path = secret_path.with_extension("tmp");
    std::fs::write(&temporary_path, blob).map_err(|error| {
        eprintln!("[yobei] failed to write device secret: {error}");
        ErrorCode::FileFailed
    })?;
    std::fs::rename(&temporary_path, secret_path).map_err(|error| {
        eprintln!("[yobei] failed to install device secret: {error}");
        ErrorCode::FileFailed
    })?;
    Ok(key)
}

fn open(blob: &[u8]) -> Result<[u8; DEVICE_KEY_LEN]> {
    crate::platform::biometric::unprotect_device_secret(blob)?
        .try_into()
        .map_err(|_| ErrorCode::DataCorrupt)
}
