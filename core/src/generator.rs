//! Password, passphrase, and PIN generation.
//!
//! The embedded EFF word list is loaded once and all randomness comes from the OS CSPRNG.

use crate::error::{ErrorCode, Result};
use rand::Rng;
use rand::rngs::OsRng;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const DEFAULT_LENGTH: usize = 20;
pub const DEFAULT_WORDS: usize = 6;
pub const DEFAULT_PIN_LENGTH: usize = 6;

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*-_=+";

/// Password generation options. Missing values use the defaults.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PassgenOptions {
    pub length: Option<usize>,
    pub words: Option<usize>,
    pub separator: Option<String>,
    pub capitalize: Option<bool>,
    pub use_lower: Option<bool>,
    pub use_upper: Option<bool>,
    pub use_digits: Option<bool>,
    pub use_symbols: Option<bool>,
}

impl PassgenOptions {
    pub fn length_or(&self) -> usize {
        self.length.unwrap_or(DEFAULT_LENGTH)
    }
    pub fn words_or(&self) -> usize {
        self.words.unwrap_or(DEFAULT_WORDS)
    }
    pub fn separator_or(&self) -> &str {
        self.separator.as_deref().unwrap_or("-")
    }
    pub fn capitalize_or(&self) -> bool {
        self.capitalize.unwrap_or(false)
    }
}

/// Load the embedded EFF word list once on first use.
fn wordlist() -> &'static Vec<&'static str> {
    static LIST: OnceLock<Vec<&'static str>> = OnceLock::new();
    LIST.get_or_init(|| {
        include_str!("./eff_large_wordlist.txt")
            .lines()
            .filter_map(|line| {
                let mut parts = line.split_whitespace();
                let _index = parts.next()?;
                parts.next()
            })
            .collect()
    })
}

fn random_index(n: usize) -> usize {
    OsRng.gen_range(0..n)
}

pub fn generate_random(opts: &PassgenOptions) -> Result<String> {
    let mut groups: Vec<&str> = Vec::new();
    if opts.use_lower.unwrap_or(true) {
        groups.push(LOWER);
    }
    if opts.use_upper.unwrap_or(true) {
        groups.push(UPPER);
    }
    if opts.use_digits.unwrap_or(true) {
        groups.push(DIGITS);
    }
    if opts.use_symbols.unwrap_or(true) {
        groups.push(SYMBOLS);
    }
    if groups.is_empty() {
        return Err(ErrorCode::InvalidInput);
    }

    let len = opts.length_or().clamp(groups.len(), 64);
    let pool: Vec<char> = groups.concat().chars().collect();
    let mut out: Vec<char> = groups
        .iter()
        .map(|g| {
            let gc: Vec<char> = g.chars().collect();
            gc[random_index(gc.len())]
        })
        .collect();
    while out.len() < len {
        out.push(pool[random_index(pool.len())]);
    }
    out.shuffle(&mut OsRng);
    Ok(out.into_iter().collect())
}

pub fn generate_passphrase(opts: &PassgenOptions) -> Result<String> {
    let words = opts.words_or().clamp(3, 12);
    let sep = opts.separator_or();
    let capitalize = opts.capitalize_or();
    let list = wordlist();
    if list.is_empty() {
        return Err(ErrorCode::OperationFailed);
    }

    let chosen: Vec<String> = (0..words)
        .map(|_| {
            let w = list[random_index(list.len())];
            if capitalize {
                let mut chars = w.chars();
                match chars.next() {
                    Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                    None => w.to_string(),
                }
            } else {
                w.to_string()
            }
        })
        .collect();
    Ok(chosen.join(sep))
}

pub fn generate_pin(opts: &PassgenOptions) -> Result<String> {
    let len = opts.length_or().clamp(4, 12);
    let mut out = String::with_capacity(len);
    for _ in 0..len {
        out.push((b'0' + random_index(10) as u8) as char);
    }
    Ok(out)
}

pub fn generate(mode: &str, opts: &PassgenOptions) -> Result<String> {
    match mode {
        "random" => generate_random(opts),
        "passphrase" => generate_passphrase(opts),
        "pin" => generate_pin(opts),
        _ => Err(ErrorCode::InvalidInput),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wordlist_has_7776_words() {
        assert_eq!(wordlist().len(), 7776);
    }

    #[test]
    fn random_covers_each_selected_group() {
        let opts = PassgenOptions {
            length: Some(16),
            use_lower: Some(true),
            use_upper: Some(true),
            use_digits: Some(true),
            use_symbols: Some(true),
            ..Default::default()
        };
        let s = generate("random", &opts).unwrap();
        assert!(s.chars().any(|c| LOWER.contains(c)));
        assert!(s.chars().any(|c| UPPER.contains(c)));
        assert!(s.chars().any(|c| DIGITS.contains(c)));
        assert!(s.chars().any(|c| SYMBOLS.contains(c)));
    }

    #[test]
    fn random_respects_limited_charset() {
        let opts = PassgenOptions {
            length: Some(10),
            use_lower: Some(true),
            use_upper: Some(false),
            use_digits: Some(false),
            use_symbols: Some(false),
            ..Default::default()
        };
        let s = generate("random", &opts).unwrap();
        assert!(s.chars().all(|c| LOWER.contains(c)));
    }

    #[test]
    fn random_rejects_empty_charset() {
        let opts = PassgenOptions {
            use_lower: Some(false),
            use_upper: Some(false),
            use_digits: Some(false),
            use_symbols: Some(false),
            ..Default::default()
        };
        assert!(generate("random", &opts).is_err());
    }

    #[test]
    fn passphrase_word_count_and_separator() {
        let opts = PassgenOptions {
            words: Some(5),
            separator: Some(" ".into()),
            ..Default::default()
        };
        let s = generate("passphrase", &opts).unwrap();
        let parts: Vec<&str> = s.split(' ').collect();
        assert_eq!(parts.len(), 5);
        let list = wordlist();
        assert!(parts.iter().all(|w| list.contains(w)));
    }

    #[test]
    fn passphrase_capitalize() {
        let opts = PassgenOptions {
            words: Some(4),
            capitalize: Some(true),
            ..Default::default()
        };
        let s = generate("passphrase", &opts).unwrap();
        assert!(
            s.split('-')
                .all(|w| w.chars().next().map_or(false, |c| c.is_uppercase()))
        );
    }

    #[test]
    fn pin_digits_only() {
        let opts = PassgenOptions {
            length: Some(6),
            ..Default::default()
        };
        let s = generate("pin", &opts).unwrap();
        assert_eq!(s.len(), 6);
        assert!(s.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn unknown_mode_errors() {
        assert!(generate("nope", &PassgenOptions::default()).is_err());
    }
}
