//! Strict P-256 ephemeral ECDH primitives shared by authenticated protocols.

use crate::error::{ErrorCode, Result};
use p256::ecdh::diffie_hellman;
use p256::{PublicKey, SecretKey};
use rand_core::OsRng;

pub const PUBLIC_KEY_LEN: usize = 65;

pub fn generate_secret_key() -> SecretKey {
    SecretKey::random(&mut OsRng)
}

pub fn public_key_sec1(secret_key: &SecretKey) -> Vec<u8> {
    secret_key.public_key().to_sec1_bytes().to_vec()
}

pub fn parse_public_sec1(sec1: &[u8]) -> Result<PublicKey> {
    if sec1.len() != PUBLIC_KEY_LEN || sec1.first() != Some(&0x04) {
        return Err(ErrorCode::InvalidInput);
    }
    PublicKey::from_sec1_bytes(sec1).map_err(|_| ErrorCode::InvalidInput)
}

pub fn derive_shared(secret_key: &SecretKey, peer_public_sec1: &[u8]) -> Result<[u8; 32]> {
    let peer_public = parse_public_sec1(peer_public_sec1)?;
    let shared = diffie_hellman(secret_key.to_nonzero_scalar(), *peer_public.as_affine());
    let mut output = [0u8; 32];
    output.copy_from_slice(shared.raw_secret_bytes().as_slice());
    Ok(output)
}

pub fn public_key_valid(sec1: &[u8]) -> bool {
    parse_public_sec1(sec1).is_ok()
}
