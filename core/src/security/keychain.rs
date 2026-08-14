//! Key wrapping and unlock state.

use crate::error::{ErrorCode, Result};
use crate::security::crypto;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroize;

const WRAP_INFO: &[u8] = b"yobei-mk-wrap-v1";

#[derive(Serialize, Deserialize, Clone)]
pub struct KeyStoreData {
    pub secret_key: Vec<u8>,
    pub wrapped_master_key: Vec<u8>,
    pub master_key_nonce: Vec<u8>,
    pub kek_salt: Vec<u8>,
}

impl KeyStoreData {
    pub fn validate(&self) -> Result<()> {
        if self.secret_key.len() != crypto::SECRET_KEY_LEN
            || self.wrapped_master_key.len() != crypto::SECRET_KEY_LEN + crypto::AEAD_TAG_LEN
            || self.master_key_nonce.len() != crypto::NONCE_LEN
            || self.kek_salt.len() != crypto::SALT_LEN
        {
            return Err(ErrorCode::DataCorrupt);
        }
        Ok(())
    }
}

pub struct ActiveKeys {
    pub master_key: [u8; 32],
}

impl Drop for ActiveKeys {
    fn drop(&mut self) {
        self.master_key.zeroize();
    }
}

pub fn initialize(master_password: &[u8]) -> Result<(KeyStoreData, ActiveKeys)> {
    let kek_salt = crypto::random_salt();
    let kek = crypto::derive_kek(master_password, &kek_salt);
    let secret_key = crypto::generate_secret_key();
    let master_key: [u8; 32] = crypto::random_bytes(32).try_into().unwrap();

    let wrap_key = mk_wrap_key(&kek, &secret_key);
    let (nonce, wrapped) = crypto::encrypt(&wrap_key, &master_key)?;

    Ok((
        KeyStoreData {
            secret_key,
            wrapped_master_key: wrapped,
            master_key_nonce: nonce,
            kek_salt,
        },
        ActiveKeys { master_key },
    ))
}

pub fn unlock(master_password: &[u8], store: &KeyStoreData) -> Result<ActiveKeys> {
    store.validate()?;
    let kek = crypto::derive_kek(master_password, &store.kek_salt);
    let wrap_key = mk_wrap_key(&kek, &store.secret_key);
    let mk_bytes = crypto::decrypt(
        &wrap_key,
        &store.master_key_nonce,
        &store.wrapped_master_key,
    )
    .map_err(|_| ErrorCode::InvalidPassword)?;
    let master_key: [u8; 32] = mk_bytes.try_into().map_err(|_| ErrorCode::DataCorrupt)?;
    Ok(ActiveKeys { master_key })
}

pub fn change_master_password(
    store: &KeyStoreData,
    old_password: &[u8],
    new_password: &[u8],
) -> Result<KeyStoreData> {
    store.validate()?;
    let old_kek = crypto::derive_kek(old_password, &store.kek_salt);
    let old_wrap_key = mk_wrap_key(&old_kek, &store.secret_key);
    let mk_bytes = crypto::decrypt(
        &old_wrap_key,
        &store.master_key_nonce,
        &store.wrapped_master_key,
    )
    .map_err(|_| ErrorCode::InvalidPassword)?;

    let new_salt = crypto::random_salt();
    let new_kek = crypto::derive_kek(new_password, &new_salt);
    let new_wrap_key = mk_wrap_key(&new_kek, &store.secret_key);
    let (nonce, wrapped) = crypto::encrypt(&new_wrap_key, &mk_bytes)?;

    Ok(KeyStoreData {
        secret_key: store.secret_key.clone(),
        wrapped_master_key: wrapped,
        master_key_nonce: nonce,
        kek_salt: new_salt,
    })
}

fn mk_wrap_key(kek: &[u8], secret_key: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(secret_key), kek);
    let mut out = [0u8; 32];
    hk.expand(WRAP_INFO, &mut out).expect("hkdf expand ok");
    out
}

/// Opaque biometric credential stored by the platform-protected adapter.
#[derive(Serialize, Deserialize, Clone)]
pub struct BiometricCredential {
    pub bio_key: Vec<u8>,
    pub wrapped_mk: Vec<u8>,
    pub nonce: Vec<u8>,
}

pub fn create_biometric_credential(master_key: &[u8]) -> Result<BiometricCredential> {
    let bio_key = crypto::random_bytes(32);
    let (nonce, wrapped_mk) = crypto::encrypt(&bio_key, master_key)?;
    Ok(BiometricCredential {
        bio_key,
        wrapped_mk,
        nonce,
    })
}

pub fn unlock_with_bio(cred: &BiometricCredential) -> Result<ActiveKeys> {
    let mk_bytes = crypto::decrypt(&cred.bio_key, &cred.nonce, &cred.wrapped_mk)
        .map_err(|_| ErrorCode::BiometricUnavailable)?;
    let master_key: [u8; 32] = mk_bytes.try_into().map_err(|_| ErrorCode::DataCorrupt)?;
    Ok(ActiveKeys { master_key })
}

pub fn bio_confirm_expired(last_confirm_at: i64, confirm_days: u32, now_ms: i64) -> bool {
    if confirm_days == 0 {
        return false;
    }
    let cutoff_ms = i64::from(confirm_days) * 24 * 3600 * 1000;
    last_confirm_at <= 0 || now_ms.saturating_sub(last_confirm_at) > cutoff_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_then_unlock_roundtrip() {
        let (store, _) = initialize(b"correct horse battery staple").unwrap();
        let keys = unlock(b"correct horse battery staple", &store).unwrap();
        let kek = crypto::derive_kek(b"correct horse battery staple", &store.kek_salt);
        let wrap_key = mk_wrap_key(&kek, &store.secret_key);
        let (nonce, wrapped) = crypto::encrypt(&wrap_key, &keys.master_key).unwrap();
        assert_eq!(nonce.len(), 12);
        assert_eq!(wrapped.len(), 32 + 16);
    }

    #[test]
    fn secret_key_is_load_bearing() {
        let (store, _) = initialize(b"correct horse battery staple").unwrap();
        let mut tampered = store.clone();
        tampered.secret_key[0] ^= 0xff;
        assert!(unlock(b"correct horse battery staple", &tampered).is_err());

        let mut blank = store.clone();
        blank.secret_key = vec![0u8; 32];
        assert!(unlock(b"correct horse battery staple", &blank).is_err());
    }

    #[test]
    fn unlock_with_wrong_password_fails() {
        let (store, _) = initialize(b"correct master password").unwrap();
        assert!(unlock(b"wrong password", &store).is_err());
    }

    #[test]
    fn change_master_password_rewraps_same_master_key() {
        let (store, _) = initialize(b"old password").unwrap();
        let new_store = change_master_password(&store, b"old password", b"new password").unwrap();
        let keys = unlock(b"new password", &new_store).unwrap();
        assert!(unlock(b"old password", &new_store).is_err());
        assert_ne!(new_store.kek_salt, store.kek_salt);

        let kek = crypto::derive_kek(b"new password", &new_store.kek_salt);
        let wrap_key = mk_wrap_key(&kek, &new_store.secret_key);
        let (nonce, wrapped) = crypto::encrypt(&wrap_key, &keys.master_key).unwrap();
        assert_eq!(nonce.len(), 12);
        assert_eq!(wrapped.len(), 32 + 16);
    }

    #[test]
    fn change_master_password_rejects_wrong_old() {
        let (store, _) = initialize(b"old password").unwrap();
        assert!(change_master_password(&store, b"nope", b"new").is_err());
    }

    #[test]
    fn bio_credential_unlocks_same_master_key() {
        let (_, keys) = initialize(b"master pw").unwrap();
        let cred = create_biometric_credential(&keys.master_key).unwrap();
        let bio_keys = unlock_with_bio(&cred).unwrap();
        assert_eq!(bio_keys.master_key, keys.master_key);
    }

    #[test]
    fn bio_credential_does_not_store_master_password() {
        let (_, keys) = initialize(b"master pw").unwrap();
        let cred = create_biometric_credential(&keys.master_key).unwrap();
        let json = serde_json::to_vec(&cred).unwrap();
        let needle = b"master pw";
        assert!(!json.windows(needle.len()).any(|w| w == needle));
    }

    #[test]
    fn bio_confirm_expired_respects_days() {
        let now = 1_800_000_000_000_i64;
        let day_ms = 24 * 3600 * 1000_i64;
        assert!(!bio_confirm_expired(now, 14, now + 13 * day_ms));
        assert!(bio_confirm_expired(now, 14, now + 15 * day_ms));
        assert!(!bio_confirm_expired(0, 0, now + 999 * day_ms));
        assert!(bio_confirm_expired(0, 14, now));
    }

    #[test]
    fn bio_credential_unlock_wrong_key_fails() {
        let (_, keys) = initialize(b"master pw").unwrap();
        let mut cred = create_biometric_credential(&keys.master_key).unwrap();
        cred.bio_key[0] ^= 0xff;
        assert!(unlock_with_bio(&cred).is_err());
    }
}
