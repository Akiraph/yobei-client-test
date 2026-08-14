pub mod biometric;
#[cfg(desktop)]
pub mod extension;
pub mod misc;
pub mod security;
pub mod setup;
pub mod sync;
pub mod transfer;
#[cfg(desktop)]
pub mod tray;
pub mod vault;

use yobei_core::error::{ErrorCode, Result};

pub(crate) async fn blocking<T>(task: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| ErrorCode::OperationFailed)?
}
