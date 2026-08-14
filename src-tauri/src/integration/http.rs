use reqwest::Url;
use reqwest::blocking::{Client, Response};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::io::Read;
use std::time::Duration;
use yobei_core::error::{ErrorCode, Result};

const MAX_RESPONSE_BYTES: u64 = 12 * 1024 * 1024;

pub fn client() -> Result<Client> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(network)
}

pub fn endpoint(server_url: &str, path: &str) -> Result<Url> {
    let mut url = Url::parse(server_url).map_err(|_| ErrorCode::InvalidInput)?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (url.path() != "/" && !url.path().is_empty())
    {
        return Err(ErrorCode::InvalidInput);
    }
    url.set_path(path);
    Ok(url)
}

pub fn parse<T: DeserializeOwned>(response: Response) -> Result<T> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err(ErrorCode::DataCorrupt);
    }
    let mut body = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|_| ErrorCode::NetworkFailed)?;
    if body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(ErrorCode::DataCorrupt);
    }
    let body = std::str::from_utf8(&body).map_err(|_| ErrorCode::DataCorrupt)?;
    if status.is_success() {
        return serde_json::from_str(body).map_err(|_| ErrorCode::DataCorrupt);
    }
    match serde_json::from_str::<Failure>(body) {
        Ok(failure) => Err(failure.code),
        Err(_) if status.is_server_error() => Err(ErrorCode::SyncFailed),
        Err(_) => Err(ErrorCode::DataCorrupt),
    }
}

pub fn network(error: reqwest::Error) -> ErrorCode {
    eprintln!("[yobei] network request failed: {error}");
    ErrorCode::NetworkFailed
}

#[derive(Deserialize)]
struct Failure {
    code: ErrorCode,
}
