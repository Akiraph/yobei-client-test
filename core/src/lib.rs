//! Core domain library for vault security, storage, sync, and generation.

pub mod error;
pub mod generator;
pub mod security;
pub mod totp;

#[cfg(feature = "native")]
pub mod sync;
#[cfg(feature = "native")]
pub mod vault;

#[cfg(feature = "wasm")]
pub mod wasm;
