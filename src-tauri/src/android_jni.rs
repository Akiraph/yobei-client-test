use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::jbyteArray;
use rusqlite::Connection;
use serde_json::{Value, json};
use yobei_core::error::{ErrorCode, Result};
use yobei_core::security::keychain;
use yobei_core::vault;
use yobei_core::vault::storage;

use crate::AppState;

struct Runtime {
    db_path: PathBuf,
    device_key: [u8; 32],
    db_conn: Arc<Mutex<Option<Connection>>>,
    active_keys: Arc<Mutex<Option<keychain::ActiveKeys>>>,
    last_activity: Arc<Mutex<std::time::Instant>>,
    bridge: Arc<crate::integration::bridge::BridgeServer>,
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

pub(crate) fn register_runtime(state: &AppState) {
    let _ = RUNTIME.set(Runtime {
        db_path: state.db_path.clone(),
        device_key: state.device_key,
        db_conn: state.db_conn.clone(),
        active_keys: state.active_keys.clone(),
        last_activity: state.last_activity.clone(),
        bridge: state.bridge.clone(),
    });
}

fn runtime() -> Result<&'static Runtime> {
    RUNTIME.get().ok_or(ErrorCode::OperationFailed)
}

fn response(value: Value) -> Vec<u8> {
    serde_json::to_vec(&value).unwrap_or_else(|_| br#"{"code":"data_corrupt"}"#.to_vec())
}

fn error_response(code: ErrorCode) -> Vec<u8> {
    response(json!({ "code": code.as_str() }))
}

fn with_unlocked<T>(action: impl FnOnce(&Connection, &[u8; 32]) -> Result<T>) -> Result<T> {
    let runtime = runtime()?;
    let connection = runtime.db_conn.lock().unwrap();
    let connection = connection.as_ref().ok_or(ErrorCode::VaultLocked)?;
    let keys = runtime.active_keys.lock().unwrap();
    let master_key = &keys.as_ref().ok_or(ErrorCode::VaultLocked)?.master_key;
    *runtime.last_activity.lock().unwrap() = std::time::Instant::now();
    action(connection, master_key)
}

fn list_logins() -> Result<Value> {
    with_unlocked(|connection, master_key| {
        let mut entries = Vec::new();
        for blob in storage::list_item_blobs(connection)? {
            if blob.item_type != "login" {
                continue;
            }
            let plaintext = vault::get_item(connection, master_key, &blob.id)?;
            let value: Value = serde_json::from_str(&plaintext)?;
            let object = value.as_object().ok_or(ErrorCode::DataCorrupt)?;
            let title = object
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Yobei login");
            let username = object.get("username").and_then(Value::as_str).unwrap_or("");
            let url = object.get("url").and_then(Value::as_str).unwrap_or("");
            let password = object.get("password").and_then(Value::as_str).unwrap_or("");
            if password.is_empty() {
                continue;
            }
            entries.push(json!({
                "id": blob.id,
                "title": title,
                "username": username,
                "url": url,
            }));
        }
        Ok(Value::Array(entries))
    })
}

fn get_login(item_id: &str) -> Result<Value> {
    if item_id.is_empty() || item_id.len() > 128 {
        return Err(ErrorCode::InvalidInput);
    }
    with_unlocked(|connection, master_key| {
        let plaintext = vault::get_item(connection, master_key, item_id)?;
        let mut value: Value = serde_json::from_str(&plaintext)?;
        let object = value.as_object_mut().ok_or(ErrorCode::DataCorrupt)?;
        object.insert("id".into(), Value::String(item_id.to_string()));
        Ok(value)
    })
}

fn unlock(pin: &str) -> Result<()> {
    if pin.len() != 6 || !pin.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(ErrorCode::InvalidInput);
    }
    let runtime = runtime()?;
    if runtime.active_keys.lock().unwrap().is_some() {
        return Ok(());
    }
    let connection = storage::open(&runtime.db_path)?;
    let store = storage::load_key_store(&connection, &runtime.device_key)?
        .ok_or(ErrorCode::NotInitialized)?;
    let keys = keychain::unlock(pin.as_bytes(), &store)?;
    *runtime.db_conn.lock().unwrap() = Some(connection);
    *runtime.active_keys.lock().unwrap() = Some(keys);
    *runtime.last_activity.lock().unwrap() = std::time::Instant::now();
    runtime.bridge.broadcast_unlocked();
    Ok(())
}

fn lock() -> Result<()> {
    let runtime = runtime()?;
    *runtime.db_conn.lock().unwrap() = None;
    *runtime.active_keys.lock().unwrap() = None;
    runtime.bridge.broadcast_locked();
    Ok(())
}

fn jstring_value(env: &mut JNIEnv<'_>, value: JString<'_>) -> Option<String> {
    env.get_string(&value).ok().map(|value| value.into())
}

fn bytes(env: &mut JNIEnv<'_>, value: Vec<u8>) -> jbyteArray {
    env.byte_array_from_slice(&value)
        .map(|array| array.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_akiraph_yobei_autofill_NativeBindings_nativeState(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jbyteArray {
    let value = match runtime() {
        Ok(runtime) if runtime.active_keys.lock().unwrap().is_some() => {
            json!({ "phase": "unlocked" })
        }
        Ok(_) => json!({ "phase": "locked" }),
        Err(code) => json!({ "code": code.as_str() }),
    };
    bytes(&mut env, response(value))
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_akiraph_yobei_autofill_NativeBindings_nativeListLogins(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    _origin: JString<'_>,
) -> jbyteArray {
    bytes(
        &mut env,
        list_logins().map_or_else(error_response, response),
    )
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_akiraph_yobei_autofill_NativeBindings_nativeGetLogin(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    item_id: JString<'_>,
) -> jbyteArray {
    let result = jstring_value(&mut env, item_id)
        .ok_or(ErrorCode::InvalidInput)
        .and_then(|item_id| get_login(&item_id));
    bytes(&mut env, result.map_or_else(error_response, response))
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_akiraph_yobei_autofill_NativeBindings_nativeUnlock(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    pin: JString<'_>,
) -> jbyteArray {
    let result = jstring_value(&mut env, pin)
        .ok_or(ErrorCode::InvalidInput)
        .and_then(|pin| unlock(&pin));
    bytes(
        &mut env,
        result.map_or_else(error_response, |_| response(json!({ "ok": true }))),
    )
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_akiraph_yobei_autofill_NativeBindings_nativeLock(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jbyteArray {
    bytes(
        &mut env,
        lock().map_or_else(error_response, |_| response(json!({ "ok": true }))),
    )
}
