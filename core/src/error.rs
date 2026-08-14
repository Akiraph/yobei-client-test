use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidInput,
    Cancelled,
    InvalidPassword,
    NotInitialized,
    VaultLocked,
    ItemNotFound,
    InvalidQr,
    InvalidTotp,
    CryptoFailed,
    StorageFailed,
    DataCorrupt,
    FileFailed,
    NetworkFailed,
    SyncConflict,
    SyncFailed,
    PairRejected,
    TransferPending,
    TransferExpired,
    RateLimited,
    DeviceNotFound,
    BridgeUnavailable,
    BiometricUnavailable,
    UnsupportedPlatform,
    UnsupportedBrowser,
    ExtensionUnavailable,
    OperationFailed,
}

pub type Result<T> = std::result::Result<T, ErrorCode>;

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid_input",
            Self::Cancelled => "cancelled",
            Self::InvalidPassword => "invalid_password",
            Self::NotInitialized => "not_initialized",
            Self::VaultLocked => "vault_locked",
            Self::ItemNotFound => "item_not_found",
            Self::InvalidQr => "invalid_qr",
            Self::InvalidTotp => "invalid_totp",
            Self::CryptoFailed => "crypto_failed",
            Self::StorageFailed => "storage_failed",
            Self::DataCorrupt => "data_corrupt",
            Self::FileFailed => "file_failed",
            Self::NetworkFailed => "network_failed",
            Self::SyncConflict => "sync_conflict",
            Self::SyncFailed => "sync_failed",
            Self::PairRejected => "pair_rejected",
            Self::TransferPending => "transfer_pending",
            Self::TransferExpired => "transfer_expired",
            Self::RateLimited => "rate_limited",
            Self::DeviceNotFound => "device_not_found",
            Self::BridgeUnavailable => "bridge_unavailable",
            Self::BiometricUnavailable => "biometric_unavailable",
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::UnsupportedBrowser => "unsupported_browser",
            Self::ExtensionUnavailable => "extension_unavailable",
            Self::OperationFailed => "operation_failed",
        }
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::error::Error for ErrorCode {}

#[cfg(feature = "native")]
impl From<rusqlite::Error> for ErrorCode {
    fn from(_: rusqlite::Error) -> Self {
        Self::StorageFailed
    }
}

impl From<serde_json::Error> for ErrorCode {
    fn from(_: serde_json::Error) -> Self {
        Self::DataCorrupt
    }
}

impl From<csv::Error> for ErrorCode {
    fn from(_: csv::Error) -> Self {
        Self::InvalidInput
    }
}
