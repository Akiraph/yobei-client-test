//! Loopback bridge between the desktop vault and the browser extension.
//!
//! The bridge uses an ephemeral ECDH session for every connection. Index
//! responses contain only display metadata. Credential fields are requested
//! one item at a time; captures awaiting user confirmation are encrypted in
//! extension-local storage until they are saved or discarded.

use std::path::PathBuf;
use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicU64, Ordering},
};
use std::time::Instant;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::security::bridge as bridge_crypto;
use yobei_core::security::crypto;
use yobei_core::security::keychain::ActiveKeys;
use yobei_core::totp;
use yobei_core::vault;
use yobei_core::vault::storage;

pub const BRIDGE_PORT: u16 = 42610;
const BRIDGE_PROTOCOL: u8 = 1;
const MAX_CLIENTS: usize = 8;
const MAX_REQUEST_ID_LENGTH: usize = 64;
const MAX_ITEM_ID_LENGTH: usize = 128;
const MAX_DEVICE_ID_LENGTH: usize = 128;
const MAX_CAPTURE_BYTES: usize = 16 * 1024;
const MAX_CAPTURE_PAYLOAD_BYTES: usize = MAX_CAPTURE_BYTES + 4096;
const MAX_CAPTURE_CANDIDATES: usize = 4;

#[derive(Default)]
struct ConnectionState {
    authenticated: bool,
    session_key: Option<[u8; 32]>,
    generation: u64,
}

pub struct BridgeServer {
    db_path: PathBuf,
    active_keys: Arc<StdMutex<Option<ActiveKeys>>>,
    last_activity: Arc<StdMutex<Instant>>,
    index_cache: StdMutex<Option<Vec<u8>>>,
    cache_generation: AtomicU64,
    vault_generation: AtomicU64,
    state_gate: tokio::sync::Mutex<()>,
    clients: StdMutex<Vec<mpsc::Sender<Message>>>,
}

impl BridgeServer {
    pub fn new(
        db_path: PathBuf,
        active_keys: Arc<StdMutex<Option<ActiveKeys>>>,
        last_activity: Arc<StdMutex<Instant>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            db_path,
            active_keys,
            last_activity,
            index_cache: StdMutex::new(None),
            cache_generation: AtomicU64::new(0),
            vault_generation: AtomicU64::new(0),
            state_gate: tokio::sync::Mutex::new(()),
            clients: StdMutex::new(Vec::new()),
        })
    }

    fn clear_index_cache(&self) {
        self.cache_generation.fetch_add(1, Ordering::AcqRel);
        *self.index_cache.lock().unwrap() = None;
    }

    pub async fn acquire_state_gate(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.state_gate.lock().await
    }

    pub fn broadcast(&self, text: &str) {
        let message = Message::Text(text.into());
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|sender| sender.try_send(message.clone()).is_ok());
    }

    fn invalidate_connections(&self, message: Message) {
        let mut clients = self.clients.lock().unwrap();
        for sender in clients.iter() {
            let _ = sender.try_send(message.clone());
            let _ = sender.try_send(Message::Close(None));
        }
        clients.clear();
    }

    pub fn broadcast_locked(&self) {
        self.clear_index_cache();
        self.vault_generation.fetch_add(1, Ordering::AcqRel);
        self.invalidate_connections(Message::Text(r#"{"type":"locked"}"#.into()));
    }

    pub fn broadcast_unlocked(&self) {
        self.clear_index_cache();
        self.vault_generation.fetch_add(1, Ordering::AcqRel);
        self.broadcast(r#"{"type":"unlocked"}"#);
    }

    pub fn broadcast_items_changed(&self) {
        self.clear_index_cache();
        self.broadcast(r#"{"type":"items_changed"}"#);
    }

    fn current_master_key(&self) -> Option<[u8; 32]> {
        self.active_keys
            .lock()
            .unwrap()
            .as_ref()
            .map(|keys| keys.master_key)
    }

    pub async fn serve(self: Arc<Self>) {
        let listener = match TcpListener::bind(("127.0.0.1", BRIDGE_PORT)).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("[yobei] bridge bind failed: {error}");
                return;
            }
        };
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                continue;
            };
            let server = self.clone();
            tauri::async_runtime::spawn(async move {
                let _ = server.handle_connection(tcp).await;
            });
        }
    }

    async fn handle_connection(self: Arc<Self>, tcp: TcpStream) -> Result<()> {
        let websocket = tokio_tungstenite::accept_async(tcp)
            .await
            .map_err(|error| {
                eprintln!("[yobei] bridge WebSocket handshake failed: {error}");
                ErrorCode::BridgeUnavailable
            })?;
        let (mut output, mut input) = websocket.split();
        let (sender, mut receiver) = mpsc::channel::<Message>(64);

        if self.clients.lock().unwrap().len() >= MAX_CLIENTS {
            output
                .send(Message::Text(
                    json!({ "type": "error", "code": ErrorCode::BridgeUnavailable })
                        .to_string()
                        .into(),
                ))
                .await
                .map_err(|error| {
                    eprintln!("[yobei] failed to send bridge capacity response: {error:?}");
                    ErrorCode::BridgeUnavailable
                })?;
            return Ok(());
        }
        self.clients.lock().unwrap().push(sender);

        output
            .send(Message::Text(
                json!({ "type": "hello", "protocol": BRIDGE_PROTOCOL, "app": "yobei" })
                    .to_string()
                    .into(),
            ))
            .await
            .map_err(|error| {
                eprintln!("[yobei] failed to send bridge hello: {error}");
                ErrorCode::BridgeUnavailable
            })?;

        let mut state = ConnectionState::default();
        loop {
            tokio::select! {
                message = receiver.recv() => {
                    let Some(message) = message else { break };
                    if output.send(message).await.is_err() { break; }
                }
                incoming = input.next() => {
                    match incoming {
                        Some(Ok(Message::Text(text))) => {
                            if let Err(error) = self.handle_message(&mut output, &text, &mut state).await {
                                eprintln!("[yobei] bridge request failed: {error:?}");
                                self.send_request_code(&mut output, "error", error, request_id_from_text(&text)).await;
                            }
                        }
                        Some(Ok(_)) => {}
                        Some(Err(error)) => {
                            eprintln!("[yobei] bridge connection failed: {error}");
                            break;
                        }
                        None => break,
                    }
                }
            }
        }

        drop(receiver);
        self.clients
            .lock()
            .unwrap()
            .retain(|client| !client.is_closed());
        Ok(())
    }

    async fn handle_message<S>(
        &self,
        output: &mut S,
        text: &str,
        state: &mut ConnectionState,
    ) -> Result<()>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        // Extension requests count as vault activity: filling or saving from the
        // browser keeps the desktop unlocked instead of letting its idle timer
        // lock the vault out from under the extension.
        *self.last_activity.lock().unwrap() = Instant::now();
        let message: Value = match serde_json::from_str(text) {
            Ok(message) => message,
            Err(_) => {
                self.send_code(output, "error", ErrorCode::InvalidInput)
                    .await;
                return Ok(());
            }
        };
        let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");

        match message_type {
            "pair" => {
                let code = message
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let device_id = message
                    .get("device_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let public_key = message
                    .get("pubkey")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if device_id.is_empty()
                    || device_id.len() > MAX_DEVICE_ID_LENGTH
                    || public_key.is_empty()
                {
                    self.send_code(output, "error", ErrorCode::InvalidInput)
                        .await;
                    return Ok(());
                }
                let public_key_bytes = STANDARD
                    .decode(&public_key)
                    .map_err(|_| ErrorCode::InvalidInput)?;
                if !bridge_crypto::public_key_valid(&public_key_bytes) {
                    self.send_code(output, "rejected", ErrorCode::PairRejected)
                        .await;
                    return Ok(());
                }
                let db_path = self.db_path.clone();
                let code_valid = tauri::async_runtime::spawn_blocking(move || {
                    let connection = storage::open(&db_path).map_err(|error| {
                        eprintln!("[yobei] failed to open vault for pairing validation: {error}");
                        ErrorCode::StorageFailed
                    })?;
                    let stored =
                        storage::get_or_create_pairing_code(&connection).map_err(|error| {
                            eprintln!("[yobei] failed to load pairing code: {error}");
                            ErrorCode::StorageFailed
                        })?;
                    Ok::<bool, ErrorCode>(bridge_crypto::ct_eq(stored.as_bytes(), code.as_bytes()))
                })
                .await
                .map_err(|error| {
                    eprintln!("[yobei] pairing validation task failed: {error}");
                    ErrorCode::OperationFailed
                })??;
                if !code_valid {
                    self.send_code(output, "rejected", ErrorCode::PairRejected)
                        .await;
                    return Ok(());
                }
                if self.current_master_key().is_none() {
                    self.send(output, json!({ "type": "locked" })).await;
                    return Ok(());
                }
                self.record_pairing(&device_id, &public_key).await?;
                self.send_session(output, &public_key, state).await
            }
            "resume" => {
                let device_id = message
                    .get("device_id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let presented_key = message.get("pubkey").and_then(Value::as_str).unwrap_or("");
                if device_id.is_empty()
                    || device_id.len() > MAX_DEVICE_ID_LENGTH
                    || presented_key.is_empty()
                {
                    self.send_code(output, "rejected", ErrorCode::PairRejected)
                        .await;
                    return Ok(());
                }
                let db_path = self.db_path.clone();
                let device_id = device_id.to_string();
                let stored_key = tauri::async_runtime::spawn_blocking(move || {
                    let connection = storage::open(&db_path).map_err(|error| {
                        eprintln!("[yobei] failed to open vault for extension validation: {error}");
                        ErrorCode::StorageFailed
                    })?;
                    storage::get_extension_pubkey(&connection, &device_id).map_err(|error| {
                        eprintln!("[yobei] failed to load paired extension: {error}");
                        ErrorCode::StorageFailed
                    })
                })
                .await
                .map_err(|error| {
                    eprintln!("[yobei] extension validation task failed: {error}");
                    ErrorCode::OperationFailed
                })??;
                let Some(stored_key) = stored_key else {
                    self.send_code(output, "rejected", ErrorCode::PairRejected)
                        .await;
                    return Ok(());
                };
                if !bridge_crypto::ct_eq(stored_key.as_bytes(), presented_key.as_bytes()) {
                    self.send_code(output, "rejected", ErrorCode::PairRejected)
                        .await;
                    return Ok(());
                }
                self.send_session(output, &stored_key, state).await
            }
            "index" if state.authenticated => {
                let session_key = state.session_key.ok_or(ErrorCode::BridgeUnavailable)?;
                let request_id = request_id(&message).ok_or(ErrorCode::InvalidInput)?;
                self.send_index(output, session_key, state.generation, request_id)
                    .await
            }
            "secret" if state.authenticated => {
                let session_key = state.session_key.ok_or(ErrorCode::BridgeUnavailable)?;
                self.send_secret(output, session_key, state.generation, &message)
                    .await
            }
            "capture" if state.authenticated => {
                let session_key = state.session_key.ok_or(ErrorCode::BridgeUnavailable)?;
                self.capture_recovery(output, session_key, state.generation, &message)
                    .await
            }
            "index" | "secret" | "capture" => {
                self.send_code(output, "rejected", ErrorCode::PairRejected)
                    .await;
                Ok(())
            }
            _ => {
                self.send_code(output, "error", ErrorCode::InvalidInput)
                    .await;
                Ok(())
            }
        }
    }

    async fn record_pairing(&self, device_id: &str, public_key: &str) -> Result<()> {
        let db_path = self.db_path.clone();
        let device_id = device_id.to_string();
        let public_key = public_key.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let connection = storage::open(&db_path).map_err(|error| {
                eprintln!(
                    "[yobei] failed to open vault while recording extension pairing: {error}"
                );
                ErrorCode::StorageFailed
            })?;
            storage::pair_extension(&connection, &device_id, &public_key).map_err(|error| {
                eprintln!("[yobei] failed to persist extension pairing: {error}");
                ErrorCode::StorageFailed
            })?;
            storage::regenerate_pairing_code(&connection).map_err(|error| {
                eprintln!("[yobei] failed to rotate extension pairing code: {error}");
                ErrorCode::StorageFailed
            })?;
            Ok::<(), ErrorCode>(())
        })
        .await
        .map_err(|error| {
            eprintln!("[yobei] pairing persistence task failed: {error}");
            ErrorCode::OperationFailed
        })?
    }

    async fn send_session<S>(
        &self,
        output: &mut S,
        extension_public_key: &str,
        state: &mut ConnectionState,
    ) -> Result<()>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        let _state_gate = self.state_gate.lock().await;
        if self.current_master_key().is_none() {
            state.authenticated = false;
            state.session_key = None;
            self.send(output, json!({ "type": "locked" })).await;
            return Ok(());
        }
        let extension_bytes = STANDARD
            .decode(extension_public_key)
            .map_err(|_| ErrorCode::InvalidInput)?;
        let session =
            bridge_crypto::establish_server_session(&extension_bytes).map_err(|error| {
                eprintln!("[yobei] failed to establish bridge session: {error}");
                ErrorCode::CryptoFailed
            })?;
        state.authenticated = true;
        state.session_key = Some(session.session_key);
        state.generation = self.vault_generation.load(Ordering::Acquire);
        self.send(
            output,
            json!({ "type": "paired", "server_pub": STANDARD.encode(&session.server_public_sec1) }),
        )
        .await;
        Ok(())
    }

    async fn send_index<S>(
        &self,
        output: &mut S,
        session_key: [u8; 32],
        vault_generation: u64,
        request_id: String,
    ) -> Result<()>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        loop {
            let Some(master_key) = self.current_master_key() else {
                self.send(output, json!({ "type": "locked" })).await;
                return Ok(());
            };
            let cache_generation = self.cache_generation.load(Ordering::Acquire);
            let cached_payload = { self.index_cache.lock().unwrap().clone() };
            let payload = if let Some(cached) = cached_payload {
                cached
            } else {
                let db_path = self.db_path.clone();
                let payload = tauri::async_runtime::spawn_blocking(move || {
                    let connection = storage::open(&db_path).map_err(|error| {
                        eprintln!("[yobei] failed to open vault for bridge index: {error}");
                        ErrorCode::StorageFailed
                    })?;
                    let blobs = storage::list_item_blobs(&connection).map_err(|error| {
                        eprintln!("[yobei] failed to list bridge items: {error}");
                        ErrorCode::StorageFailed
                    })?;
                    let mut index = Vec::with_capacity(blobs.len());
                    for blob in blobs {
                        let plaintext = vault::get_item(&connection, &master_key, &blob.id).map_err(|error| {
                            eprintln!("[yobei] failed to decrypt bridge index item: {error}");
                            ErrorCode::CryptoFailed
                        })?;
                        let data = serde_json::from_str::<Value>(&plaintext).unwrap_or(Value::Null);
                        index.push(json!({
                            "id": blob.id,
                            "item_type": blob.item_type,
                            "title": string_field(&data, "title").unwrap_or_else(|| blob.id.clone()),
                            "username": string_field(&data, "username"),
                            "url": string_field(&data, "url"),
                            "has_password": has_nonempty_string(&data, "password"),
                            "has_totp": has_nonempty_string(&data, "totp"),
                            "has_recovery_codes": has_nonempty_string(&data, "recoveryCodes"),
                            "has_passkeys": data.get("passkeys").and_then(Value::as_array).is_some_and(|items| !items.is_empty()),
                        }));
                    }
                    serde_json::to_vec(&index).map_err(|error| {
                        eprintln!("[yobei] failed to encode bridge index: {error}");
                        ErrorCode::DataCorrupt
                    })
                })
                .await
                .map_err(|error| {
                    eprintln!("[yobei] bridge index task failed: {error}");
                    ErrorCode::OperationFailed
                })??;
                let mut cache = self.index_cache.lock().unwrap();
                if self.cache_generation.load(Ordering::Acquire) == cache_generation {
                    *cache = Some(payload.clone());
                }
                payload
            };
            if self.cache_generation.load(Ordering::Acquire) != cache_generation {
                continue;
            }
            return self
                .send_encrypted(
                    output,
                    session_key,
                    vault_generation,
                    "index",
                    Some(request_id),
                    payload,
                )
                .await;
        }
    }

    async fn send_secret<S>(
        &self,
        output: &mut S,
        session_key: [u8; 32],
        vault_generation: u64,
        request: &Value,
    ) -> Result<()>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        let request_id = request_id(request).ok_or(ErrorCode::InvalidInput)?;
        let item_id = request
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= MAX_ITEM_ID_LENGTH)
            .ok_or(ErrorCode::InvalidInput)?
            .to_string();
        let fields = request
            .get("fields")
            .and_then(Value::as_array)
            .ok_or(ErrorCode::InvalidInput)?;
        if fields.is_empty() || fields.len() > 5 {
            return Err(ErrorCode::InvalidInput);
        }
        let fields: Vec<String> = fields
            .iter()
            .map(|field| field.as_str().unwrap_or("").to_string())
            .collect();
        let unique_fields = fields.iter().collect::<std::collections::HashSet<_>>();
        if unique_fields.len() != fields.len()
            || fields.iter().any(|field| {
                !matches!(
                    field.as_str(),
                    "username" | "password" | "totp_code" | "recovery_codes" | "passkeys"
                )
            })
        {
            return Err(ErrorCode::InvalidInput);
        }

        let Some(master_key) = self.current_master_key() else {
            self.send(output, json!({ "type": "locked" })).await;
            return Ok(());
        };
        let db_path = self.db_path.clone();
        let payload = tauri::async_runtime::spawn_blocking(move || {
            let connection = storage::open(&db_path).map_err(|error| {
                eprintln!("[yobei] failed to open vault for bridge secret: {error}");
                ErrorCode::StorageFailed
            })?;
            let plaintext =
                vault::get_item(&connection, &master_key, &item_id).map_err(|error| {
                    eprintln!("[yobei] failed to decrypt bridge secret item: {error}");
                    ErrorCode::ItemNotFound
                })?;
            let data = serde_json::from_str::<Value>(&plaintext).map_err(|error| {
                eprintln!("[yobei] bridge item plaintext is invalid: {error}");
                ErrorCode::DataCorrupt
            })?;
            let mut result = json!({ "id": item_id });
            for field in fields {
                match field.as_str() {
                    "username" | "password" => {
                        if let Some(value) = string_field(&data, &field) {
                            result[&field] = Value::String(value);
                        }
                    }
                    "totp_code" => {
                        if let Some(secret) = string_field(&data, "totp") {
                            if let Ok(code) = totp::compute_now(&secret) {
                                result["totp_code"] = Value::String(code.code);
                            }
                        }
                    }
                    "recovery_codes" => {
                        if let Some(codes) = string_field(&data, "recoveryCodes") {
                            result["recovery_codes"] = Value::String(codes);
                        }
                    }
                    "passkeys" => {
                        if let Some(passkeys) = data.get("passkeys").and_then(Value::as_array) {
                            result["passkeys"] = Value::Array(passkeys.clone());
                        }
                    }
                    _ => unreachable!(),
                }
            }
            serde_json::to_vec(&result).map_err(|error| {
                eprintln!("[yobei] failed to encode bridge secret response: {error}");
                ErrorCode::DataCorrupt
            })
        })
        .await
        .map_err(|error| {
            eprintln!("[yobei] bridge secret task failed: {error}");
            ErrorCode::OperationFailed
        })??;
        self.send_encrypted(
            output,
            session_key,
            vault_generation,
            "secret",
            Some(request_id),
            payload,
        )
        .await
    }

    async fn capture_recovery<S>(
        &self,
        output: &mut S,
        session_key: [u8; 32],
        vault_generation: u64,
        request: &Value,
    ) -> Result<()>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        let request_id = request_id(request).ok_or(ErrorCode::InvalidInput)?;
        let nonce = decode_request_bytes(request, "nonce")?;
        let ciphertext = decode_request_bytes(request, "ciphertext")?;
        if ciphertext.len() > MAX_CAPTURE_PAYLOAD_BYTES + crypto::AEAD_TAG_LEN {
            return Err(ErrorCode::InvalidInput);
        }
        let payload = crypto::decrypt(&session_key, &nonce, &ciphertext)?;
        if payload.len() > MAX_CAPTURE_PAYLOAD_BYTES {
            return Err(ErrorCode::InvalidInput);
        }
        let capture: Value =
            serde_json::from_slice(&payload).map_err(|_| ErrorCode::InvalidInput)?;
        let recovery_codes = capture
            .get("recovery_codes")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let password = capture
            .get("password")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        if recovery_codes.is_some() == password.is_some()
            || recovery_codes
                .or(password)
                .is_some_and(|value| value.len() > MAX_CAPTURE_BYTES)
        {
            return Err(ErrorCode::InvalidInput);
        }
        let (field, value) = if let Some(value) = recovery_codes {
            ("recoveryCodes", value.to_string())
        } else {
            (
                "password",
                password.ok_or(ErrorCode::InvalidInput)?.to_string(),
            )
        };
        let field = field.to_string();
        let username = capture
            .get("username")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let url = capture
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let item_id = capture
            .get("item_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if item_id
            .as_ref()
            .is_some_and(|value| value.len() > MAX_ITEM_ID_LENGTH)
        {
            return Err(ErrorCode::InvalidInput);
        }
        let create = capture
            .get("create")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let title = capture
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("")
            .to_string();
        if title.len() > 512 || (create && item_id.is_some()) {
            return Err(ErrorCode::InvalidInput);
        }
        if url.len() > 2048 || username.len() > 512 {
            return Err(ErrorCode::InvalidInput);
        }
        let Some(master_key) = self.current_master_key() else {
            self.send(output, json!({ "type": "locked" })).await;
            return Ok(());
        };
        let db_path = self.db_path.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            capture_login_field(
                &db_path,
                &master_key,
                &url,
                &username,
                &field,
                &value,
                item_id.as_deref(),
                create,
                &title,
            )
        })
        .await
        .map_err(|_| ErrorCode::OperationFailed)??;
        if result.get("matched").and_then(Value::as_bool) == Some(true) {
            self.broadcast_items_changed();
        }
        let payload = serde_json::to_vec(&result).map_err(|_| ErrorCode::DataCorrupt)?;
        self.send_encrypted(
            output,
            session_key,
            vault_generation,
            "capture",
            Some(request_id),
            payload,
        )
        .await
    }

    async fn send_encrypted<S>(
        &self,
        output: &mut S,
        session_key: [u8; 32],
        vault_generation: u64,
        message_type: &str,
        request_id: Option<String>,
        payload: Vec<u8>,
    ) -> Result<()>
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        let _state_gate = self.state_gate.lock().await;
        if self.current_master_key().is_none() {
            self.send(output, json!({ "type": "locked" })).await;
            return Ok(());
        }
        if self.vault_generation.load(Ordering::Acquire) != vault_generation {
            return Err(ErrorCode::BridgeUnavailable);
        }
        let (nonce, ciphertext) = crypto::encrypt(&session_key, &payload).map_err(|error| {
            eprintln!("[yobei] bridge response encryption failed: {error}");
            ErrorCode::CryptoFailed
        })?;
        let mut message = json!({
            "type": message_type,
            "nonce": STANDARD.encode(nonce),
            "ciphertext": STANDARD.encode(ciphertext),
        });
        if let Some(request_id) = request_id {
            message["request_id"] = Value::String(request_id);
        }
        self.send(output, message).await;
        Ok(())
    }

    async fn send<S, T>(&self, output: &mut S, value: T) -> bool
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
        T: serde::Serialize,
    {
        let Ok(text) = serde_json::to_string(&value) else {
            return false;
        };
        output.send(Message::Text(text.into())).await.is_ok()
    }

    async fn send_code<S>(&self, output: &mut S, message_type: &str, code: ErrorCode) -> bool
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        self.send(output, json!({ "type": message_type, "code": code }))
            .await
    }

    async fn send_request_code<S>(
        &self,
        output: &mut S,
        message_type: &str,
        code: ErrorCode,
        request_id: Option<String>,
    ) -> bool
    where
        S: SinkExt<Message> + Unpin,
        S::Error: std::fmt::Debug,
    {
        let mut message = json!({ "type": message_type, "code": code });
        if let Some(request_id) = request_id {
            message["request_id"] = Value::String(request_id);
        }
        self.send(output, message).await
    }
}

fn request_id_from_text(text: &str) -> Option<String> {
    serde_json::from_str::<Value>(text)
        .ok()
        .as_ref()
        .and_then(request_id)
}

fn request_id(message: &Value) -> Option<String> {
    message
        .get("request_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= MAX_REQUEST_ID_LENGTH)
        .map(String::from)
}

fn decode_request_bytes(message: &Value, field: &str) -> Result<Vec<u8>> {
    let value = message
        .get(field)
        .and_then(Value::as_str)
        .ok_or(ErrorCode::InvalidInput)?;
    STANDARD.decode(value).map_err(|_| ErrorCode::InvalidInput)
}

fn normalized_host(value: &str) -> String {
    let value = value.trim().to_ascii_lowercase();
    let value = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .unwrap_or(&value);
    value
        .strip_prefix("www.")
        .unwrap_or(value)
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

fn hosts_match(left: &str, right: &str) -> bool {
    !left.is_empty()
        && !right.is_empty()
        && (left == right
            || left.ends_with(&format!(".{right}"))
            || right.ends_with(&format!(".{left}")))
}

fn capture_login_field(
    db_path: &std::path::Path,
    master_key: &[u8; 32],
    url: &str,
    username: &str,
    field: &str,
    value: &str,
    item_id: Option<&str>,
    create: bool,
    title: &str,
) -> Result<Value> {
    let connection = storage::open(db_path)?;
    if create {
        let title = if title.is_empty() {
            normalized_host(url)
        } else {
            title.to_string()
        };
        if title.is_empty() {
            return Err(ErrorCode::InvalidInput);
        }
        let mut data = serde_json::Map::new();
        data.insert("title".to_string(), Value::String(title));
        data.insert(
            "username".to_string(),
            if username.is_empty() {
                Value::Null
            } else {
                Value::String(username.to_string())
            },
        );
        data.insert(
            "url".to_string(),
            if url.is_empty() {
                Value::Null
            } else {
                Value::String(url.to_string())
            },
        );
        data.insert(field.to_string(), Value::String(value.to_string()));
        let data = Value::Object(data);
        let plaintext = serde_json::to_string(&data).map_err(|_| ErrorCode::DataCorrupt)?;
        let id = vault::create_item(&connection, master_key, "login", &plaintext)?;
        return Ok(json!({ "matched": true, "id": id }));
    }
    let target_host = normalized_host(url);
    let target_user = username.to_ascii_lowercase();
    let mut matches = Vec::new();
    for item in storage::list_item_blobs(&connection)? {
        if item.item_type != "login" {
            continue;
        }
        if let Some(selected_id) = item_id {
            if item.id != selected_id {
                continue;
            }
        }
        let plaintext = vault::get_item(&connection, master_key, &item.id)?;
        let data: Value = serde_json::from_str(&plaintext).map_err(|_| ErrorCode::DataCorrupt)?;
        let item_host = normalized_host(string_field(&data, "url").as_deref().unwrap_or(""));
        let item_user = string_field(&data, "username")
            .unwrap_or_default()
            .to_ascii_lowercase();
        if item_id.is_some()
            || (hosts_match(&item_host, &target_host)
                && (target_user.is_empty() || item_user == target_user))
        {
            matches.push((item, data));
        }
    }
    if matches.len() != 1 {
        return Ok(json!({
            "matched": false,
            "candidates": matches.into_iter().take(MAX_CAPTURE_CANDIDATES).map(|(item, data)| json!({
                "id": item.id,
                "title": string_field(&data, "title"),
                "username": string_field(&data, "username"),
                "url": string_field(&data, "url"),
            })).collect::<Vec<_>>(),
        }));
    }
    let (item, mut data) = matches.pop().ok_or(ErrorCode::ItemNotFound)?;
    let object = data.as_object_mut().ok_or(ErrorCode::DataCorrupt)?;
    if !username.is_empty()
        && object
            .get("username")
            .and_then(Value::as_str)
            .map_or(true, str::is_empty)
    {
        object.insert("username".to_string(), Value::String(username.to_string()));
    }
    if !url.is_empty()
        && object
            .get("url")
            .and_then(Value::as_str)
            .map_or(true, str::is_empty)
    {
        object.insert("url".to_string(), Value::String(url.to_string()));
    }
    object.insert(field.to_string(), Value::String(value.to_string()));
    let json = serde_json::to_string(&data).map_err(|_| ErrorCode::DataCorrupt)?;
    vault::update_item(&connection, master_key, &item.id, &json)?;
    Ok(json!({ "matched": true, "id": item.id }))
}

fn string_field(data: &Value, field: &str) -> Option<String> {
    data.get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

fn has_nonempty_string(data: &Value, field: &str) -> bool {
    string_field(data, field).is_some()
}
