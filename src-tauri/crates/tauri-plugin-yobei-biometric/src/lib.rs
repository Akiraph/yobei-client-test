use tauri::Runtime;

#[cfg(mobile)]
use yobei_core::error::{ErrorCode, Result};

#[cfg(mobile)]
use tauri::{
    AppHandle, Manager,
    plugin::{PluginHandle, mobile::PluginInvokeError},
};

#[cfg(mobile)]
pub struct Biometric<R: Runtime>(pub PluginHandle<R>);

#[cfg(mobile)]
fn plugin<R: Runtime>(app: &AppHandle<R>) -> Result<&PluginHandle<R>> {
    app.try_state::<Biometric<R>>()
        .map(|biometric| &biometric.0)
        .ok_or(ErrorCode::BiometricUnavailable)
}

#[cfg(mobile)]
fn invocation_error(error: PluginInvokeError, fallback: ErrorCode) -> ErrorCode {
    if let PluginInvokeError::InvokeRejected(response) = &error {
        if let Some(code) = response.code.as_deref() {
            if let Ok(code) = serde_json::from_value(serde_json::Value::String(code.to_string())) {
                return code;
            }
        }
    }
    eprintln!("[yobei] Android biometric invocation failed: {error}");
    fallback
}

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("yobei-biometric")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin("com.yobei.biometric", "BiometricPlugin")?;
                _app.manage(Biometric(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(mobile)]
pub fn is_available<R: Runtime>(app: &AppHandle<R>) -> Result<bool> {
    #[derive(serde::Deserialize)]
    struct Output {
        available: bool,
    }

    plugin(app)?
        .run_mobile_plugin::<Output>("isAvailable", ())
        .map(|output| output.available)
        .map_err(|error| invocation_error(error, ErrorCode::BiometricUnavailable))
}

#[cfg(mobile)]
pub fn request<R: Runtime>(app: &AppHandle<R>, message: &str) -> Result<bool> {
    #[derive(serde::Serialize)]
    struct Arguments<'a> {
        message: &'a str,
    }

    #[derive(serde::Deserialize)]
    struct Output {
        ok: bool,
    }

    plugin(app)?
        .run_mobile_plugin::<Output>("request", Arguments { message })
        .map(|output| output.ok)
        .map_err(|error| invocation_error(error, ErrorCode::BiometricUnavailable))
}

#[cfg(mobile)]
pub fn protect_secret<R: Runtime>(app: &AppHandle<R>, plaintext: &[u8]) -> Result<Vec<u8>> {
    use base64::Engine as _;

    #[derive(serde::Serialize)]
    struct Arguments {
        plaintext: String,
    }

    #[derive(serde::Deserialize)]
    struct Output {
        blob: String,
    }

    let output = plugin(app)?
        .run_mobile_plugin::<Output>(
            "protectSecret",
            Arguments {
                plaintext: base64::engine::general_purpose::STANDARD.encode(plaintext),
            },
        )
        .map_err(|error| invocation_error(error, ErrorCode::CryptoFailed))?;

    base64::engine::general_purpose::STANDARD
        .decode(output.blob)
        .map_err(|_| ErrorCode::DataCorrupt)
}

#[cfg(mobile)]
pub fn unprotect_secret<R: Runtime>(app: &AppHandle<R>, blob: &[u8]) -> Result<Vec<u8>> {
    use base64::Engine as _;

    #[derive(serde::Serialize)]
    struct Arguments {
        blob: String,
    }

    #[derive(serde::Deserialize)]
    struct Output {
        plaintext: String,
    }

    let output = plugin(app)?
        .run_mobile_plugin::<Output>(
            "unprotectSecret",
            Arguments {
                blob: base64::engine::general_purpose::STANDARD.encode(blob),
            },
        )
        .map_err(|error| invocation_error(error, ErrorCode::CryptoFailed))?;

    base64::engine::general_purpose::STANDARD
        .decode(output.plaintext)
        .map_err(|_| ErrorCode::DataCorrupt)
}

#[cfg(mobile)]
pub fn delete_secret<R: Runtime>(app: &AppHandle<R>, blob: &[u8]) -> Result<()> {
    use base64::Engine as _;

    #[derive(serde::Serialize)]
    struct Arguments {
        blob: String,
    }

    plugin(app)?
        .run_mobile_plugin::<serde_json::Value>(
            "deleteSecret",
            Arguments {
                blob: base64::engine::general_purpose::STANDARD.encode(blob),
            },
        )
        .map(|_| ())
        .map_err(|error| invocation_error(error, ErrorCode::OperationFailed))
}

#[cfg(mobile)]
pub fn protect_device_secret<R: Runtime>(app: &AppHandle<R>, plaintext: &[u8]) -> Result<Vec<u8>> {
    use base64::Engine as _;

    #[derive(serde::Serialize)]
    struct Arguments {
        plaintext: String,
    }
    #[derive(serde::Deserialize)]
    struct Output {
        blob: String,
    }

    let output = plugin(app)?
        .run_mobile_plugin::<Output>(
            "protectDeviceSecret",
            Arguments {
                plaintext: base64::engine::general_purpose::STANDARD.encode(plaintext),
            },
        )
        .map_err(|error| invocation_error(error, ErrorCode::CryptoFailed))?;
    base64::engine::general_purpose::STANDARD
        .decode(output.blob)
        .map_err(|_| ErrorCode::DataCorrupt)
}

#[cfg(mobile)]
pub fn unprotect_device_secret<R: Runtime>(app: &AppHandle<R>, blob: &[u8]) -> Result<Vec<u8>> {
    use base64::Engine as _;

    #[derive(serde::Serialize)]
    struct Arguments {
        blob: String,
    }
    #[derive(serde::Deserialize)]
    struct Output {
        plaintext: String,
    }

    let output = plugin(app)?
        .run_mobile_plugin::<Output>(
            "unprotectDeviceSecret",
            Arguments {
                blob: base64::engine::general_purpose::STANDARD.encode(blob),
            },
        )
        .map_err(|error| invocation_error(error, ErrorCode::CryptoFailed))?;
    base64::engine::general_purpose::STANDARD
        .decode(output.plaintext)
        .map_err(|_| ErrorCode::DataCorrupt)
}
