//! Zero-knowledge single-user, multi-device transfer.
//!
//! The relay may see request metadata and the two ephemeral public keys, but
//! the encrypted payload contains only a validated KeyStoreData and server URL.

use crate::error::{ErrorCode, Result};
use crate::security::keychain::{self, KeyStoreData};
use crate::security::{crypto, ecdh};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use hkdf::Hkdf;
use p256::SecretKey;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::Sha256;
use zeroize::Zeroize;

pub const PROTOCOL_VERSION: u16 = 1;
pub const CONTEXT: &str = "yobei-device-transfer-v1";

const MAX_JSON_BYTES: usize = 64 * 1024;
const MAX_TRANSFER_ID_BYTES: usize = 128;
const MAX_DEVICE_ID_BYTES: usize = 128;
const CLAIM_TOKEN_BYTES: usize = 32;
const MAX_SERVER_URL_BYTES: usize = 2 * 1024;
const MAX_CIPHERTEXT_BYTES: usize = 16 * 1024;
const RECEIVER_STATE_CONTEXT: &[u8] = b"yobei-device-transfer-state-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferRequest {
    pub version: u16,
    pub context: String,
    pub server_url: String,
    pub device_id: String,
    pub transfer_id: String,
    pub claim_token: String,
    pub receiver_pubkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferOffer {
    pub version: u16,
    pub context: String,
    pub transfer_id: String,
    pub claim_token: String,
    pub sender_pubkey: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferPayload {
    pub server_url: String,
    pub device_id: String,
    pub keystore: KeyStoreData,
}

pub struct TransferReceiver {
    secret_key: SecretKey,
    receiver_pubkey: Vec<u8>,
    request: Option<TransferRequest>,
    server_url: String,
    device_id: String,
}

impl TransferRequest {
    pub fn decode(json: &str) -> Result<Self> {
        let request: Self = parse_json(json)?;
        request.validate()?;
        Ok(request)
    }

    pub fn encode(&self) -> Result<String> {
        self.validate()?;
        serde_json::to_string(self).map_err(|_| ErrorCode::OperationFailed)
    }

    fn validate(&self) -> Result<Vec<u8>> {
        validate_request_header(
            self.version,
            &self.context,
            &self.server_url,
            &self.device_id,
            &self.transfer_id,
            &self.claim_token,
        )?;
        let receiver_pubkey = decode_public_key(&self.receiver_pubkey)?;
        Ok(receiver_pubkey)
    }
}

impl TransferOffer {
    pub fn decode(json: &str) -> Result<Self> {
        let offer: Self = parse_json(json)?;
        offer.validate()?;
        Ok(offer)
    }

    pub fn encode(&self) -> Result<String> {
        self.validate()?;
        serde_json::to_string(self).map_err(|_| ErrorCode::OperationFailed)
    }

    fn validate(&self) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
        validate_protocol(
            self.version,
            &self.context,
            &self.transfer_id,
            &self.claim_token,
        )?;
        let sender_pubkey = decode_public_key(&self.sender_pubkey)?;
        let nonce = decode_exact(&self.nonce, crypto::NONCE_LEN)?;
        let ciphertext =
            decode_range(&self.ciphertext, crypto::AEAD_TAG_LEN, MAX_CIPHERTEXT_BYTES)?;
        Ok((sender_pubkey, nonce, ciphertext))
    }
}

impl TransferReceiver {
    pub fn new(server_url: &str, device_id: &str) -> Result<Self> {
        validate_server_url(server_url)?;
        validate_token(device_id, MAX_DEVICE_ID_BYTES)?;
        let secret_key = ecdh::generate_secret_key();
        let receiver_pubkey = ecdh::public_key_sec1(&secret_key);
        Ok(Self {
            secret_key,
            receiver_pubkey,
            request: None,
            server_url: server_url.to_string(),
            device_id: device_id.to_string(),
        })
    }

    pub fn public_key_b64(&self) -> String {
        encode(&self.receiver_pubkey)
    }

    pub fn request(&self) -> Result<&TransferRequest> {
        self.request.as_ref().ok_or(ErrorCode::InvalidInput)
    }

    pub fn bind_transfer(
        &mut self,
        transfer_id: &str,
        claim_token: &str,
    ) -> Result<TransferRequest> {
        if self.request.is_some() {
            return Err(ErrorCode::InvalidInput);
        }
        validate_token(transfer_id, MAX_TRANSFER_ID_BYTES)?;
        decode_exact(claim_token, CLAIM_TOKEN_BYTES)?;
        let request = TransferRequest {
            version: PROTOCOL_VERSION,
            context: CONTEXT.to_string(),
            server_url: self.server_url.clone(),
            device_id: self.device_id.clone(),
            transfer_id: transfer_id.to_string(),
            claim_token: claim_token.to_string(),
            receiver_pubkey: encode(&self.receiver_pubkey),
        };
        request.validate()?;
        self.request = Some(request.clone());
        Ok(request)
    }

    pub fn accept_offer(
        &self,
        offer: &TransferOffer,
        master_password: &[u8],
    ) -> Result<TransferPayload> {
        let request = self.request.as_ref().ok_or(ErrorCode::InvalidInput)?;
        let receiver_pubkey = request.validate()?;
        let (sender_pubkey, nonce, ciphertext) = offer.validate()?;
        if offer.transfer_id != request.transfer_id || offer.claim_token != request.claim_token {
            return Err(ErrorCode::InvalidInput);
        }

        let shared = ecdh::derive_shared(&self.secret_key, &sender_pubkey)?;
        let key = derive_transfer_key(
            &shared,
            &sender_pubkey,
            &receiver_pubkey,
            &request.server_url,
            &request.device_id,
            &offer.transfer_id,
            &offer.claim_token,
        )?;
        let aad = binding(
            offer.version,
            &offer.context,
            &request.server_url,
            &request.device_id,
            &offer.transfer_id,
            &offer.claim_token,
            &sender_pubkey,
            &receiver_pubkey,
        )?;
        let mut plaintext = crypto::decrypt_with_aad(&key, &nonce, &ciphertext, &aad)?;
        let payload: PayloadWire = match serde_json::from_slice(&plaintext) {
            Ok(payload) => payload,
            Err(_) => {
                plaintext.zeroize();
                return Err(ErrorCode::DataCorrupt);
            }
        };
        plaintext.zeroize();
        payload.into_payload(master_password, &request.server_url, &request.device_id)
    }

    pub fn seal(&self, device_key: &[u8]) -> Result<Vec<u8>> {
        if device_key.len() != crypto::KEY_LEN {
            return Err(ErrorCode::InvalidInput);
        }
        self.validate_state()?;
        let state = ReceiverStateWire {
            version: PROTOCOL_VERSION,
            context: CONTEXT.to_string(),
            server_url: self.server_url.clone(),
            device_id: self.device_id.clone(),
            secret_key: encode(self.secret_key.to_bytes().as_slice()),
            request: self.request.clone(),
        };
        let mut plaintext = serde_json::to_vec(&state).map_err(|_| ErrorCode::OperationFailed)?;
        if plaintext.len() > MAX_JSON_BYTES {
            plaintext.zeroize();
            return Err(ErrorCode::InvalidInput);
        }
        let (nonce, ciphertext) =
            crypto::encrypt_with_aad(device_key, &plaintext, RECEIVER_STATE_CONTEXT)?;
        plaintext.zeroize();
        let mut sealed = nonce;
        sealed.extend_from_slice(&ciphertext);
        Ok(sealed)
    }

    pub fn open(device_key: &[u8], sealed: &[u8]) -> Result<Self> {
        if device_key.len() != crypto::KEY_LEN
            || sealed.len() < crypto::NONCE_LEN + crypto::AEAD_TAG_LEN
            || sealed.len() > crypto::NONCE_LEN + MAX_JSON_BYTES + crypto::AEAD_TAG_LEN
        {
            return Err(ErrorCode::InvalidInput);
        }
        let (nonce, ciphertext) = sealed.split_at(crypto::NONCE_LEN);
        let mut plaintext =
            crypto::decrypt_with_aad(device_key, nonce, ciphertext, RECEIVER_STATE_CONTEXT)
                .map_err(|_| ErrorCode::DataCorrupt)?;
        if plaintext.len() > MAX_JSON_BYTES {
            plaintext.zeroize();
            return Err(ErrorCode::DataCorrupt);
        }
        let state: ReceiverStateWire = match serde_json::from_slice(&plaintext) {
            Ok(state) => state,
            Err(_) => {
                plaintext.zeroize();
                return Err(ErrorCode::DataCorrupt);
            }
        };
        plaintext.zeroize();
        state.into_receiver()
    }

    fn validate_state(&self) -> Result<()> {
        validate_server_url(&self.server_url)?;
        validate_token(&self.device_id, MAX_DEVICE_ID_BYTES)?;
        let derived_public = ecdh::public_key_sec1(&self.secret_key);
        if derived_public != self.receiver_pubkey {
            return Err(ErrorCode::DataCorrupt);
        }
        if let Some(request) = &self.request {
            let request_public = request.validate()?;
            if request.server_url != self.server_url
                || request.device_id != self.device_id
                || request_public != self.receiver_pubkey
            {
                return Err(ErrorCode::DataCorrupt);
            }
        }
        Ok(())
    }
}

pub fn create_offer(request: &TransferRequest, keystore: &KeyStoreData) -> Result<TransferOffer> {
    let receiver_pubkey = request.validate()?;
    keystore.validate()?;

    let sender_secret = ecdh::generate_secret_key();
    let sender_pubkey = ecdh::public_key_sec1(&sender_secret);
    let shared = ecdh::derive_shared(&sender_secret, &receiver_pubkey)?;
    let key = derive_transfer_key(
        &shared,
        &sender_pubkey,
        &receiver_pubkey,
        &request.server_url,
        &request.device_id,
        &request.transfer_id,
        &request.claim_token,
    )?;
    let payload = PayloadWire::from_payload(&request.server_url, keystore)?;
    let mut plaintext = serde_json::to_vec(&payload).map_err(|_| ErrorCode::OperationFailed)?;
    if plaintext.len() > MAX_JSON_BYTES {
        plaintext.zeroize();
        return Err(ErrorCode::InvalidInput);
    }
    let aad = binding(
        request.version,
        &request.context,
        &request.server_url,
        &request.device_id,
        &request.transfer_id,
        &request.claim_token,
        &sender_pubkey,
        &receiver_pubkey,
    )?;
    let (nonce, ciphertext) = crypto::encrypt_with_aad(&key, &plaintext, &aad)?;
    plaintext.zeroize();
    Ok(TransferOffer {
        version: request.version,
        context: request.context.clone(),
        transfer_id: request.transfer_id.clone(),
        claim_token: request.claim_token.clone(),
        sender_pubkey: encode(&sender_pubkey),
        nonce: encode(&nonce),
        ciphertext: encode(&ciphertext),
    })
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PayloadWire {
    version: u16,
    context: String,
    server_url: String,
    keystore: KeyStoreWire,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyStoreWire {
    secret_key: String,
    wrapped_master_key: String,
    master_key_nonce: String,
    kek_salt: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReceiverStateWire {
    version: u16,
    context: String,
    server_url: String,
    device_id: String,
    secret_key: String,
    request: Option<TransferRequest>,
}

impl ReceiverStateWire {
    fn into_receiver(self) -> Result<TransferReceiver> {
        if self.version != PROTOCOL_VERSION || self.context != CONTEXT {
            return Err(ErrorCode::DataCorrupt);
        }
        validate_server_url(&self.server_url).map_err(|_| ErrorCode::DataCorrupt)?;
        validate_token(&self.device_id, MAX_DEVICE_ID_BYTES).map_err(|_| ErrorCode::DataCorrupt)?;
        let secret_bytes =
            decode_exact(&self.secret_key, 32).map_err(|_| ErrorCode::DataCorrupt)?;
        let secret_key =
            SecretKey::from_slice(&secret_bytes).map_err(|_| ErrorCode::DataCorrupt)?;
        let receiver_pubkey = ecdh::public_key_sec1(&secret_key);
        let receiver = TransferReceiver {
            secret_key,
            receiver_pubkey,
            request: self.request,
            server_url: self.server_url,
            device_id: self.device_id,
        };
        receiver.validate_state()?;
        Ok(receiver)
    }
}

impl PayloadWire {
    fn from_payload(server_url: &str, keystore: &KeyStoreData) -> Result<Self> {
        validate_server_url(server_url)?;
        keystore.validate()?;
        Ok(Self {
            version: PROTOCOL_VERSION,
            context: CONTEXT.to_string(),
            server_url: server_url.to_string(),
            keystore: KeyStoreWire {
                secret_key: encode(&keystore.secret_key),
                wrapped_master_key: encode(&keystore.wrapped_master_key),
                master_key_nonce: encode(&keystore.master_key_nonce),
                kek_salt: encode(&keystore.kek_salt),
            },
        })
    }

    fn into_payload(
        self,
        master_password: &[u8],
        expected_server_url: &str,
        expected_device_id: &str,
    ) -> Result<TransferPayload> {
        if self.version != PROTOCOL_VERSION || self.context != CONTEXT {
            return Err(ErrorCode::DataCorrupt);
        }
        validate_server_url(&self.server_url).map_err(|_| ErrorCode::DataCorrupt)?;
        if self.server_url != expected_server_url {
            return Err(ErrorCode::DataCorrupt);
        }
        let keystore = KeyStoreData {
            secret_key: decode_exact(&self.keystore.secret_key, crypto::SECRET_KEY_LEN)
                .map_err(|_| ErrorCode::DataCorrupt)?,
            wrapped_master_key: decode_exact(
                &self.keystore.wrapped_master_key,
                crypto::SECRET_KEY_LEN + crypto::AEAD_TAG_LEN,
            )
            .map_err(|_| ErrorCode::DataCorrupt)?,
            master_key_nonce: decode_exact(&self.keystore.master_key_nonce, crypto::NONCE_LEN)
                .map_err(|_| ErrorCode::DataCorrupt)?,
            kek_salt: decode_exact(&self.keystore.kek_salt, crypto::SALT_LEN)
                .map_err(|_| ErrorCode::DataCorrupt)?,
        };
        keystore.validate()?;
        keychain::unlock(master_password, &keystore).map_err(|error| match error {
            ErrorCode::InvalidPassword => ErrorCode::InvalidPassword,
            ErrorCode::DataCorrupt => ErrorCode::DataCorrupt,
            _ => ErrorCode::CryptoFailed,
        })?;
        Ok(TransferPayload {
            server_url: self.server_url,
            device_id: expected_device_id.to_string(),
            keystore,
        })
    }
}

fn parse_json<T: DeserializeOwned>(json: &str) -> Result<T> {
    if json.is_empty()
        || json.len() > MAX_JSON_BYTES
        || json
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_whitespace())
        || json
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_whitespace())
    {
        return Err(ErrorCode::InvalidInput);
    }
    serde_json::from_str(json).map_err(|_| ErrorCode::InvalidInput)
}

fn validate_protocol(
    version: u16,
    context: &str,
    transfer_id: &str,
    claim_token: &str,
) -> Result<()> {
    if version != PROTOCOL_VERSION || context != CONTEXT {
        return Err(ErrorCode::InvalidInput);
    }
    validate_token(transfer_id, MAX_TRANSFER_ID_BYTES)?;
    decode_exact(claim_token, CLAIM_TOKEN_BYTES).map(|_| ())
}

fn validate_request_header(
    version: u16,
    context: &str,
    server_url: &str,
    device_id: &str,
    transfer_id: &str,
    claim_token: &str,
) -> Result<()> {
    validate_protocol(version, context, transfer_id, claim_token)?;
    validate_server_url(server_url)?;
    validate_token(device_id, MAX_DEVICE_ID_BYTES)
}

fn validate_token(value: &str, max_bytes: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max_bytes
        || !value.is_ascii()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
    {
        return Err(ErrorCode::InvalidInput);
    }
    Ok(())
}

fn validate_server_url(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > MAX_SERVER_URL_BYTES
        || !value.is_ascii()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        || (!value.starts_with("https://") && !value.starts_with("http://"))
    {
        return Err(ErrorCode::InvalidInput);
    }
    Ok(())
}

fn encode(value: &[u8]) -> String {
    STANDARD.encode(value)
}

fn decode_exact(value: &str, expected_len: usize) -> Result<Vec<u8>> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| ErrorCode::InvalidInput)?;
    if bytes.len() != expected_len || STANDARD.encode(&bytes) != value {
        return Err(ErrorCode::InvalidInput);
    }
    Ok(bytes)
}

fn decode_range(value: &str, min_len: usize, max_len: usize) -> Result<Vec<u8>> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| ErrorCode::InvalidInput)?;
    if bytes.len() < min_len || bytes.len() > max_len || STANDARD.encode(&bytes) != value {
        return Err(ErrorCode::InvalidInput);
    }
    Ok(bytes)
}

fn decode_public_key(value: &str) -> Result<Vec<u8>> {
    let bytes = decode_exact(value, ecdh::PUBLIC_KEY_LEN)?;
    ecdh::parse_public_sec1(&bytes)?;
    Ok(bytes)
}

fn derive_transfer_key(
    shared: &[u8; 32],
    sender_pubkey: &[u8],
    receiver_pubkey: &[u8],
    server_url: &str,
    device_id: &str,
    transfer_id: &str,
    claim_token: &str,
) -> Result<[u8; 32]> {
    let mut salt = Vec::with_capacity(sender_pubkey.len() + receiver_pubkey.len());
    salt.extend_from_slice(sender_pubkey);
    salt.extend_from_slice(receiver_pubkey);
    let info = binding(
        PROTOCOL_VERSION,
        CONTEXT,
        server_url,
        device_id,
        transfer_id,
        claim_token,
        sender_pubkey,
        receiver_pubkey,
    )?;
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut key = [0u8; 32];
    hk.expand(&info, &mut key)
        .map_err(|_| ErrorCode::CryptoFailed)?;
    Ok(key)
}

fn binding(
    version: u16,
    context: &str,
    server_url: &str,
    device_id: &str,
    transfer_id: &str,
    claim_token: &str,
    sender_pubkey: &[u8],
    receiver_pubkey: &[u8],
) -> Result<Vec<u8>> {
    validate_request_header(
        version,
        context,
        server_url,
        device_id,
        transfer_id,
        claim_token,
    )?;
    let mut out = Vec::with_capacity(256);
    out.extend_from_slice(CONTEXT.as_bytes());
    out.extend_from_slice(&version.to_be_bytes());
    append_part(&mut out, server_url.as_bytes());
    append_part(&mut out, device_id.as_bytes());
    append_part(&mut out, transfer_id.as_bytes());
    append_part(&mut out, claim_token.as_bytes());
    append_part(&mut out, sender_pubkey);
    append_part(&mut out, receiver_pubkey);
    Ok(out)
}

fn append_part(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(&(value.len() as u32).to_be_bytes());
    output.extend_from_slice(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAIM_TOKEN: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

    fn store() -> KeyStoreData {
        keychain::initialize(b"correct password").unwrap().0
    }

    #[test]
    fn roundtrip_contains_only_wrapped_key_material() {
        let keystore = store();
        let mut receiver = TransferReceiver::new("https://sync.example.test", "device-1").unwrap();
        assert!(receiver.public_key_b64().len() > 0);
        let request = receiver.bind_transfer("transfer-1", CLAIM_TOKEN).unwrap();
        let request_json = request.encode().unwrap();
        let request = TransferRequest::decode(&request_json).unwrap();
        let offer = create_offer(&request, &keystore).unwrap();
        let offer_json = offer.encode().unwrap();
        let payload = receiver
            .accept_offer(
                &TransferOffer::decode(&offer_json).unwrap(),
                b"correct password",
            )
            .unwrap();
        assert_eq!(payload.server_url, "https://sync.example.test");
        assert_eq!(payload.device_id, "device-1");
        assert_eq!(payload.keystore.secret_key, keystore.secret_key);
        assert!(!offer_json.contains("correct password"));
        assert!(!offer_json.contains("master_password"));
    }

    #[test]
    fn receiver_state_roundtrip_is_sealed_and_bound() {
        let mut receiver = TransferReceiver::new("https://sync.example.test", "device-1").unwrap();
        receiver.bind_transfer("transfer-1", CLAIM_TOKEN).unwrap();
        let device_key = [9u8; crypto::KEY_LEN];
        let sealed = receiver.seal(&device_key).unwrap();

        assert!(sealed.len() >= crypto::NONCE_LEN + crypto::AEAD_TAG_LEN);
        assert!(
            !sealed
                .windows(b"device-1".len())
                .any(|window| window == b"device-1")
        );

        let restored = TransferReceiver::open(&device_key, &sealed).unwrap();
        assert_eq!(restored.public_key_b64(), receiver.public_key_b64());
        assert_eq!(restored.request().unwrap().device_id, "device-1");
        assert_eq!(
            restored.request().unwrap().transfer_id,
            receiver.request().unwrap().transfer_id
        );
        assert_eq!(
            TransferReceiver::open(&[8u8; crypto::KEY_LEN], &sealed).err(),
            Some(ErrorCode::DataCorrupt)
        );
    }

    #[test]
    fn wrong_password_and_request_are_rejected() {
        let keystore = store();
        let mut receiver = TransferReceiver::new("https://sync.example.test", "device-1").unwrap();
        let request = receiver.bind_transfer("transfer-1", CLAIM_TOKEN).unwrap();
        let offer = create_offer(&request, &keystore).unwrap();
        assert_eq!(
            receiver.accept_offer(&offer, b"wrong").err(),
            Some(ErrorCode::InvalidPassword)
        );

        let mut other = TransferReceiver::new("https://sync.example.test", "device-1").unwrap();
        other.bind_transfer("transfer-2", CLAIM_TOKEN).unwrap();
        assert_eq!(
            other.accept_offer(&offer, b"correct password").err(),
            Some(ErrorCode::InvalidInput)
        );
    }

    #[test]
    fn malformed_base64_and_tampering_are_rejected() {
        let keystore = store();
        let mut receiver = TransferReceiver::new("https://sync.example.test", "device-1").unwrap();
        let request = receiver.bind_transfer("transfer-1", CLAIM_TOKEN).unwrap();
        let mut offer = create_offer(&request, &keystore).unwrap();
        offer.nonce.push(' ');
        assert_eq!(offer.validate().unwrap_err(), ErrorCode::InvalidInput);

        let mut offer = create_offer(&request, &keystore).unwrap();
        let mut ciphertext = STANDARD.decode(&offer.ciphertext).unwrap();
        ciphertext[0] ^= 1;
        offer.ciphertext = STANDARD.encode(ciphertext);
        assert_eq!(
            receiver.accept_offer(&offer, b"correct password").err(),
            Some(ErrorCode::CryptoFailed)
        );
    }

    #[test]
    fn request_wire_rejects_unknown_fields_and_noncanonical_base64() {
        let mut receiver = TransferReceiver::new("https://sync.example.test", "device-1").unwrap();
        let request = receiver.bind_transfer("transfer-1", CLAIM_TOKEN).unwrap();
        let mut json = request.encode().unwrap();
        json.push(' ');
        assert!(TransferRequest::decode(&json).is_err());
        assert!(TransferRequest::decode(&json.replace("}", ",\"extra\":1}")).is_err());
    }
}
