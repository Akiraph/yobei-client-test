//! Cryptography for the authenticated local bridge session.
//!
//! The bridge authenticates a long-lived extension key and derives an
//! ephemeral AES-GCM session key. The master key is never part of the bridge
//! protocol; the desktop decrypts only the item snapshot it needs to share.

use crate::error::{ErrorCode, Result};
use crate::security::ecdh;
use hkdf::Hkdf;
use sha2::Sha256;

#[cfg(test)]
use p256::SecretKey;

pub const SESSION_INFO: &[u8] = b"yobei-bridge-v1";

#[derive(Debug, Clone)]
pub struct ServerSession {
    pub session_key: [u8; 32],
    pub server_public_sec1: Vec<u8>,
}

pub fn establish_server_session(ext_public_sec1: &[u8]) -> Result<ServerSession> {
    ecdh::parse_public_sec1(ext_public_sec1)?;
    let server_sk = ecdh::generate_secret_key();
    let server_public_sec1 = ecdh::public_key_sec1(&server_sk);
    let shared = ecdh::derive_shared(&server_sk, ext_public_sec1)?;
    let session_key = derive_session_key(&shared, &server_public_sec1, ext_public_sec1)?;
    Ok(ServerSession {
        session_key,
        server_public_sec1,
    })
}

#[cfg(test)]
pub fn establish_client_session(
    ext_sk: &SecretKey,
    server_public_sec1: &[u8],
    ext_public_sec1: &[u8],
) -> Result<[u8; 32]> {
    let shared = ecdh::derive_shared(ext_sk, server_public_sec1)?;
    derive_session_key(&shared, server_public_sec1, ext_public_sec1)
}

fn derive_session_key(
    shared_secret: &[u8],
    server_public_sec1: &[u8],
    ext_public_sec1: &[u8],
) -> Result<[u8; 32]> {
    let mut salt = Vec::with_capacity(server_public_sec1.len() + ext_public_sec1.len());
    salt.extend_from_slice(server_public_sec1);
    salt.extend_from_slice(ext_public_sec1);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared_secret);
    let mut output = [0u8; 32];
    hk.expand(SESSION_INFO, &mut output)
        .map_err(|_| ErrorCode::CryptoFailed)?;
    Ok(output)
}

pub fn public_key_valid(sec1: &[u8]) -> bool {
    ecdh::public_key_valid(sec1)
}

pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in a.iter().zip(b.iter()) {
        difference |= left ^ right;
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::crypto;
    use rand_core::OsRng;

    #[test]
    fn server_and_client_derive_same_session_key() {
        let extension_secret = SecretKey::random(&mut OsRng);
        let extension_public = extension_secret.public_key().to_sec1_bytes().to_vec();
        let server = establish_server_session(&extension_public).unwrap();
        let client = establish_client_session(
            &extension_secret,
            &server.server_public_sec1,
            &extension_public,
        )
        .unwrap();
        assert_eq!(server.session_key, client);
    }

    #[test]
    fn wrong_client_cannot_derive_session_key() {
        let extension_secret = SecretKey::random(&mut OsRng);
        let extension_public = extension_secret.public_key().to_sec1_bytes().to_vec();
        let wrong_secret = SecretKey::random(&mut OsRng);
        let server = establish_server_session(&extension_public).unwrap();
        let wrong =
            establish_client_session(&wrong_secret, &server.server_public_sec1, &extension_public)
                .unwrap();
        assert_ne!(server.session_key, wrong);
    }

    #[test]
    fn session_key_encrypts_only_the_item_snapshot_payload() {
        let extension_secret = SecretKey::random(&mut OsRng);
        let extension_public = extension_secret.public_key().to_sec1_bytes().to_vec();
        let server = establish_server_session(&extension_public).unwrap();
        let payload = br#"[{\"id\":\"item-1\"}]"#;
        let (nonce, ciphertext) = crypto::encrypt(&server.session_key, payload).unwrap();
        let client = establish_client_session(
            &extension_secret,
            &server.server_public_sec1,
            &extension_public,
        )
        .unwrap();
        let recovered = crypto::decrypt(&client, &nonce, &ciphertext).unwrap();
        assert_eq!(recovered, payload);
    }

    #[test]
    fn ct_eq_compares_bytes() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"abcd"));
    }

    #[test]
    fn rejects_invalid_public_key() {
        assert!(establish_server_session(&[0u8; 10]).is_err());
    }
}
