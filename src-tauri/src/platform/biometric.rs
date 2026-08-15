//! Platform biometric authentication and secure-secret adapters.

#[cfg(target_os = "windows")]
pub use windows_imp::*;

#[cfg(target_os = "android")]
pub use android_imp::*;

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub use pending_imp::*;

#[cfg(target_os = "android")]
mod android_imp {
    use std::sync::OnceLock;
    use tauri::{AppHandle, Wry};
    use tauri_plugin_biometric::{AuthOptions, BiometricExt};
    use tauri_plugin_yobei_biometric as plugin;
    use yobei_core::error::{ErrorCode, Result};

    static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();

    pub fn init(app: AppHandle<Wry>) {
        let _ = APP.set(app);
    }

    fn app() -> Result<&'static AppHandle<Wry>> {
        APP.get().ok_or(ErrorCode::BiometricUnavailable)
    }

    pub fn is_available() -> bool {
        app()
            .ok()
            .and_then(|app| app.biometric().status().ok())
            .map(|status| status.is_available)
            .unwrap_or(false)
    }

    pub fn request(message: &str) -> Result<bool> {
        let options = AuthOptions {
            allow_device_credential: false,
            cancel_title: None,
            fallback_title: None,
            title: Some("Yobei".to_string()),
            subtitle: Some(message.to_string()),
            confirmation_required: Some(false),
        };
        app()?
            .biometric()
            .authenticate(message.to_string(), options)
            .map(|_| true)
            .map_err(|error| {
                eprintln!("[yobei] biometric authentication failed: {error}");
                ErrorCode::BiometricUnavailable
            })
    }

    pub fn protect_secret(plaintext: &[u8]) -> Result<Vec<u8>> {
        plugin::protect_secret(app()?, plaintext)
    }

    pub fn unprotect_secret(blob: &[u8]) -> Result<Vec<u8>> {
        plugin::unprotect_secret(app()?, blob)
    }

    pub fn delete_secret(blob: &[u8]) -> Result<()> {
        plugin::delete_secret(app()?, blob)
    }

    pub fn protect_device_secret(plaintext: &[u8]) -> Result<Vec<u8>> {
        plugin::protect_device_secret(app()?, plaintext)
    }

    pub fn unprotect_device_secret(blob: &[u8]) -> Result<Vec<u8>> {
        plugin::unprotect_device_secret(app()?, blob)
    }
}

#[cfg(target_os = "windows")]
mod windows_imp {
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    use windows::core::PCWSTR;
    use yobei_core::error::{ErrorCode, Result};

    fn blob_from(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        }
    }

    fn blob_into_vec(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if blob.pbData.is_null() {
            return Vec::new();
        }
        let output =
            unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec() };
        unsafe {
            LocalFree(HLOCAL(blob.pbData as *mut core::ffi::c_void));
        }
        output
    }

    pub fn is_available() -> bool {
        let Ok(operation) = UserConsentVerifier::CheckAvailabilityAsync() else {
            return false;
        };
        operation
            .get()
            .map(|value| value == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    pub fn request(message: &str) -> Result<bool> {
        let message = windows::core::HSTRING::from(message);
        let operation =
            UserConsentVerifier::RequestVerificationAsync(&message).map_err(|error| {
                eprintln!("[yobei] failed to start Windows Hello request: {error}");
                ErrorCode::BiometricUnavailable
            })?;
        let result = operation.get().map_err(|error| {
            eprintln!("[yobei] Windows Hello request failed: {error}");
            ErrorCode::BiometricUnavailable
        })?;
        Ok(result == UserConsentVerificationResult::Verified)
    }

    pub fn protect_secret(plaintext: &[u8]) -> Result<Vec<u8>> {
        let input = blob_from(plaintext);
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|error| {
            eprintln!("[yobei] DPAPI protection failed: {error}");
            ErrorCode::CryptoFailed
        })?;
        Ok(blob_into_vec(output))
    }

    pub fn unprotect_secret(blob: &[u8]) -> Result<Vec<u8>> {
        let input = blob_from(blob);
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|error| {
            eprintln!("[yobei] DPAPI recovery failed: {error}");
            ErrorCode::CryptoFailed
        })?;
        Ok(blob_into_vec(output))
    }

    pub fn delete_secret(_blob: &[u8]) -> Result<()> {
        Ok(())
    }

    pub fn protect_device_secret(plaintext: &[u8]) -> Result<Vec<u8>> {
        protect_secret(plaintext)
    }

    pub fn unprotect_device_secret(blob: &[u8]) -> Result<Vec<u8>> {
        unprotect_secret(blob)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
mod pending_imp {
    use yobei_core::error::{ErrorCode, Result};

    pub fn is_available() -> bool {
        false
    }
    pub fn request(_message: &str) -> Result<bool> {
        Err(ErrorCode::UnsupportedPlatform)
    }
    pub fn protect_secret(_plaintext: &[u8]) -> Result<Vec<u8>> {
        Err(ErrorCode::UnsupportedPlatform)
    }
    pub fn unprotect_secret(_blob: &[u8]) -> Result<Vec<u8>> {
        Err(ErrorCode::UnsupportedPlatform)
    }
    pub fn delete_secret(_blob: &[u8]) -> Result<()> {
        Err(ErrorCode::UnsupportedPlatform)
    }
    pub fn protect_device_secret(_plaintext: &[u8]) -> Result<Vec<u8>> {
        Err(ErrorCode::UnsupportedPlatform)
    }
    pub fn unprotect_device_secret(_blob: &[u8]) -> Result<Vec<u8>> {
        Err(ErrorCode::UnsupportedPlatform)
    }
}
