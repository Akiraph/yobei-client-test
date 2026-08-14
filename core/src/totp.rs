//! TOTP parsing and calculation.

use crate::error::{ErrorCode, Result};
use data_encoding::BASE32_NOPAD;
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha1 = Hmac<Sha1>;
type HmacSha256 = Hmac<Sha256>;
type HmacSha512 = Hmac<Sha512>;

#[derive(Debug, Clone)]
pub struct OtpSecret {
    pub key: Vec<u8>,
    pub algorithm: String,
    pub digits: u32,
    pub period: u64,
}

#[derive(Serialize, Clone)]
pub struct TotpCode {
    pub code: String,
    pub period: u64,
    pub digits: u32,
}

pub fn parse_secret(input: &str) -> Result<OtpSecret> {
    let input = input.trim();
    if input.starts_with("otpauth://") {
        parse_otpauth_uri(input)
    } else {
        let cleaned: String = input
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .collect();
        let key = decode_base32(&cleaned)?;
        Ok(OtpSecret {
            key,
            algorithm: "SHA1".into(),
            digits: 6,
            period: 30,
        })
    }
}

fn parse_otpauth_uri(uri: &str) -> Result<OtpSecret> {
    let rest = uri
        .strip_prefix("otpauth://")
        .ok_or(ErrorCode::InvalidTotp)?;
    let query = rest
        .find('?')
        .map(|i| &rest[i + 1..])
        .ok_or(ErrorCode::InvalidTotp)?;

    let mut secret_b32: Option<String> = None;
    let mut algorithm = "SHA1".to_string();
    let mut digits: u32 = 6;
    let mut period: u64 = 30;
    for pair in query.split('&') {
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, percent_decode(v)),
            None => continue,
        };
        match k {
            "secret" => secret_b32 = Some(v),
            "algorithm" => algorithm = v.to_uppercase(),
            "digits" => digits = v.parse().map_err(|_| ErrorCode::InvalidTotp)?,
            "period" => period = v.parse().map_err(|_| ErrorCode::InvalidTotp)?,
            _ => {}
        }
    }
    let b32: String = secret_b32
        .ok_or(ErrorCode::InvalidTotp)?
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let key = decode_base32(&b32)?;
    Ok(OtpSecret {
        key,
        algorithm,
        digits,
        period,
    })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn decode_base32(s: &str) -> Result<Vec<u8>> {
    let no_pad: String = s.chars().filter(|c| *c != '=').collect();
    if no_pad.is_empty() {
        return Err(ErrorCode::InvalidTotp);
    }
    if no_pad.len() % 8 == 1 {
        return Err(ErrorCode::InvalidTotp);
    }
    BASE32_NOPAD
        .decode(no_pad.as_bytes())
        .map_err(|_| ErrorCode::InvalidTotp)
}

pub fn totp_from_key(
    key: &[u8],
    algorithm: &str,
    digits: u32,
    period: u64,
    now: i64,
) -> Result<String> {
    if digits != 6 && digits != 8 {
        return Err(ErrorCode::InvalidTotp);
    }
    let period = if period == 0 { 30 } else { period };
    let counter = (now.max(0) as u64) / period;
    hotp(key, counter, algorithm, digits)
}

fn hotp(key: &[u8], counter: u64, algorithm: &str, digits: u32) -> Result<String> {
    let msg = counter.to_be_bytes();
    let digest: Vec<u8> = match algorithm {
        "SHA1" => hmac_digest::<HmacSha1>(key, &msg)?,
        "SHA256" => hmac_digest::<HmacSha256>(key, &msg)?,
        "SHA512" => hmac_digest::<HmacSha512>(key, &msg)?,
        _ => return Err(ErrorCode::InvalidTotp),
    };
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let binary = ((digest[offset] & 0x7f) as u32) << 24
        | (digest[offset + 1] as u32) << 16
        | (digest[offset + 2] as u32) << 8
        | (digest[offset + 3] as u32);
    let code = binary % 10u32.pow(digits);
    Ok(format!("{code:0width$}", width = digits as usize))
}

fn hmac_digest<M: Mac + KeyInit>(key: &[u8], msg: &[u8]) -> Result<Vec<u8>> {
    let mut mac = <M as Mac>::new_from_slice(key).map_err(|_| ErrorCode::InvalidTotp)?;
    mac.update(msg);
    Ok(mac.finalize().into_bytes().to_vec())
}

pub fn compute(input: &str, now: i64) -> Result<TotpCode> {
    let cfg = parse_secret(input)?;
    let code = totp_from_key(&cfg.key, &cfg.algorithm, cfg.digits, cfg.period, now)?;
    Ok(TotpCode {
        code,
        period: cfg.period,
        digits: cfg.digits,
    })
}

pub fn compute_now(input: &str) -> Result<TotpCode> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    compute(input, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RFC_KEY: &[u8] = b"12345678901234567890";

    #[test]
    fn rfc6238_sha1_vectors() {
        for &(t, expected) in &[
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ] {
            assert_eq!(totp_from_key(RFC_KEY, "SHA1", 8, 30, t).unwrap(), expected);
        }
    }

    #[test]
    fn rfc6238_sha1_6_digits() {
        assert_eq!(totp_from_key(RFC_KEY, "SHA1", 6, 30, 59).unwrap(), "287082");
    }

    #[test]
    fn sha256_vectors_openssl_verified() {
        for &(t, expected) in &[
            (59, "32247374"),
            (1_111_111_109, "34756375"),
            (1_111_111_111, "74584430"),
            (1_234_567_890, "42829826"),
            (2_000_000_000, "78428693"),
            (20_000_000_000, "24142410"),
        ] {
            assert_eq!(
                totp_from_key(RFC_KEY, "SHA256", 8, 30, t).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn sha512_vectors_openssl_verified() {
        for &(t, expected) in &[
            (59, "69342147"),
            (1_111_111_109, "63049338"),
            (1_111_111_111, "54380122"),
            (1_234_567_890, "76671578"),
            (2_000_000_000, "56464532"),
            (20_000_000_000, "69481994"),
        ] {
            assert_eq!(
                totp_from_key(RFC_KEY, "SHA512", 8, 30, t).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn raw_base32_secret_decodes() {
        let cfg = parse_secret("GEZDGNBVGY3TQOJQ").unwrap();
        assert_eq!(cfg.key, b"1234567890");
        assert_eq!(cfg.algorithm, "SHA1");
        assert_eq!(cfg.digits, 6);
        assert_eq!(cfg.period, 30);
    }

    #[test]
    fn known_otpauth_example_secret() {
        let cfg = parse_secret("JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(cfg.key, b"Hello!\xde\xad\xbe\xef");
    }

    #[test]
    fn raw_base32_tolerates_padding() {
        let cfg = parse_secret("GEZDGNBVGY3TQOJQ=").unwrap();
        assert_eq!(cfg.key, b"1234567890");
    }

    #[test]
    fn otpauth_uri_parse() {
        let uri = "otpauth://totp/GitHub:alice?secret=GEZDGNBVGY3TQOJQ&issuer=GitHub&algorithm=SHA1&digits=6&period=30";
        let cfg = parse_secret(uri).unwrap();
        assert_eq!(cfg.key, b"1234567890");
        assert_eq!(cfg.algorithm, "SHA1");
        assert_eq!(cfg.digits, 6);
        assert_eq!(cfg.period, 30);
    }

    #[test]
    fn otpauth_uri_overrides_params() {
        let uri =
            "otpauth://totp/Example?secret=GEZDGNBVGY3TQOJQ&algorithm=SHA256&digits=8&period=60";
        let cfg = parse_secret(uri).unwrap();
        assert_eq!(cfg.algorithm, "SHA256");
        assert_eq!(cfg.digits, 8);
        assert_eq!(cfg.period, 60);
    }

    #[test]
    fn invalid_secret_errors() {
        assert!(parse_secret("!!!not-base32!!!").is_err());
        assert!(parse_secret("otpauth://totp/X?issuer=Y").is_err());
    }

    #[test]
    fn compute_end_to_end() {
        let r = compute("GEZDGNBVGY3TQOJQ", 59).unwrap();
        assert_eq!(r.digits, 6);
        assert_eq!(r.period, 30);
        assert_eq!(r.code, "263420");
    }

    #[test]
    fn compute_via_otpauth_uri() {
        let uri = "otpauth://totp/X?secret=GEZDGNBVGY3TQOJQ&algorithm=SHA256&digits=8&period=60";
        let r = compute(uri, 59).unwrap();
        assert_eq!(r.digits, 8);
        assert_eq!(r.period, 60);
        assert_eq!(r.code.len(), 8);
    }
}
