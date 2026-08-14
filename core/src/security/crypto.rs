//! Cryptographic primitives for key derivation and authenticated encryption.

use crate::error::{ErrorCode, Result};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use rand::RngCore;
use rand::rngs::OsRng;
use sha2::Sha256;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const AEAD_TAG_LEN: usize = 16;
pub const SALT_LEN: usize = 16;
pub const SECRET_KEY_LEN: usize = 32;

// These parameters deliberately make unlock expensive. They must be calibrated
// on the slowest supported Android device before release.
const ARGON2_M_COST: u32 = 64 * 1024;
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 4;

pub fn derive_kek(master_password: &[u8], salt: &[u8]) -> [u8; 32] {
    let params = Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, Some(KEY_LEN))
        .expect("valid argon2 params");
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut kek = [0u8; 32];
    argon
        .hash_password_into(master_password, salt, &mut kek)
        .expect("argon2 hash should succeed");
    kek
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    OsRng.fill_bytes(&mut buf);
    buf
}

pub fn random_salt() -> Vec<u8> {
    random_bytes(SALT_LEN)
}

pub fn generate_secret_key() -> Vec<u8> {
    random_bytes(SECRET_KEY_LEN)
}

pub fn encrypt(key: &[u8], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    encrypt_with_aad(key, plaintext, &[])
}

pub fn encrypt_with_aad(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    let key_arr: [u8; 32] = key.try_into().map_err(|_| ErrorCode::InvalidInput)?;
    let cipher = Aes256Gcm::new(&key_arr.into());
    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| ErrorCode::CryptoFailed)?;
    Ok((nonce_bytes, ct))
}

pub fn decrypt(key: &[u8], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    decrypt_with_aad(key, nonce, ciphertext, &[])
}

pub fn decrypt_with_aad(
    key: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>> {
    let key_arr: [u8; 32] = key.try_into().map_err(|_| ErrorCode::InvalidInput)?;
    if nonce.len() != NONCE_LEN {
        return Err(ErrorCode::DataCorrupt);
    }
    let cipher = Aes256Gcm::new(&key_arr.into());
    let n = Nonce::from_slice(nonce);
    cipher
        .decrypt(
            n,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| ErrorCode::CryptoFailed)
}

pub fn derive_key(master_key: &[u8], context: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, master_key);
    let mut out = [0u8; 32];
    hk.expand(context, &mut out).expect("hkdf expand ok");
    out
}

pub fn derive_auth_key(master_key: &[u8], device_id: &[u8]) -> Vec<u8> {
    let mut info = Vec::with_capacity(32 + device_id.len());
    info.extend_from_slice(b"yobei-auth-v1:");
    info.extend_from_slice(device_id);
    derive_key(master_key, &info).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kek_derivation_is_deterministic() {
        let salt = random_salt();
        let a = derive_kek(b"correct horse battery staple", &salt);
        let b = derive_kek(b"correct horse battery staple", &salt);
        assert_eq!(a, b);
    }

    #[test]
    fn kek_differs_with_salt() {
        let a = derive_kek(b"pass", &random_salt());
        let b = derive_kek(b"pass", &random_salt());
        assert_ne!(a, b);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = [0u8; 32];
        let plaintext = b"my secret password";
        let (nonce, ct) = encrypt(&key, plaintext).unwrap();
        assert_ne!(&ct, plaintext);
        let dec = decrypt(&key, &nonce, &ct).unwrap();
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn decrypt_wrong_key_fails() {
        let key_a: [u8; 32] = [1u8; 32];
        let key_b: [u8; 32] = [2u8; 32];
        let (nonce, ct) = encrypt(&key_a, b"data").unwrap();
        assert!(decrypt(&key_b, &nonce, &ct).is_err());
    }

    #[test]
    fn item_key_differs_per_context() {
        let mk = [0u8; 32];
        assert_ne!(derive_key(&mk, b"item-1"), derive_key(&mk, b"item-2"));
    }

    #[test]
    fn random_bytes_are_unique() {
        assert_ne!(random_bytes(32), random_bytes(32));
    }
}
