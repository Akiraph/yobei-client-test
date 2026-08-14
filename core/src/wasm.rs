//! wasm-bindgen exports for browser-local password generation.
//!
//! Vault item encryption and TOTP calculation remain inside the desktop
//! application. The extension never receives the vault master key.
//! This module is compiled only with the `wasm` feature.

use wasm_bindgen::prelude::*;

use crate::error::ErrorCode;
use crate::generator::{self, PassgenOptions};

fn error_value(error: ErrorCode) -> JsValue {
    JsValue::from_str(error.as_str())
}

/// Generate a password. Empty options use the defaults.
#[wasm_bindgen]
pub fn generate_password(mode: &str, opts_json: &str) -> Result<String, JsValue> {
    let opts: PassgenOptions = if opts_json.is_empty() {
        PassgenOptions::default()
    } else {
        serde_json::from_str(opts_json).map_err(|_| error_value(ErrorCode::InvalidInput))?
    };
    generator::generate(mode, &opts).map_err(error_value)
}
