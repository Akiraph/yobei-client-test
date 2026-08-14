use crate::integration::http;
use yobei_core::error::{ErrorCode, Result};
use yobei_core::sync::{PullResponse, PushResponse, SyncChange};

pub struct Transport {
    client: reqwest::blocking::Client,
    base_url: String,
    auth_key: String,
}

impl Transport {
    pub fn new(base_url: &str, auth_key: &str) -> Result<Self> {
        if auth_key.is_empty() {
            return Err(ErrorCode::InvalidInput);
        }
        http::endpoint(base_url, "/api/v1/sync/pull")?;
        Ok(Self {
            client: http::client()?,
            base_url: base_url.to_string(),
            auth_key: auth_key.to_string(),
        })
    }

    pub fn push(&self, base_version: i64, changes: &[SyncChange]) -> Result<PushResponse> {
        let response = self
            .client
            .post(http::endpoint(&self.base_url, "/api/v1/sync/push")?)
            .bearer_auth(&self.auth_key)
            .json(&serde_json::json!({ "base_version": base_version, "changes": changes }))
            .send()
            .map_err(http::network)?;
        http::parse(response)
    }

    pub fn pull(&self, since: i64) -> Result<PullResponse> {
        let response = self
            .client
            .get(http::endpoint(&self.base_url, "/api/v1/sync/pull")?)
            .bearer_auth(&self.auth_key)
            .query(&[("since", since)])
            .send()
            .map_err(http::network)?;
        http::parse(response)
    }
}

pub fn setup_device(
    base_url: &str,
    setup_code: &str,
    device_id: &str,
    device_name: &str,
    auth_key: &str,
) -> Result<()> {
    if setup_code.is_empty() || device_name.is_empty() || auth_key.is_empty() {
        return Err(ErrorCode::InvalidInput);
    }
    let response = http::client()?
        .post(http::endpoint(base_url, "/api/v1/setup")?)
        .json(&serde_json::json!({
            "setup_code": setup_code,
            "device_id": device_id,
            "device_name": device_name,
            "auth_key_b64": auth_key,
        }))
        .send()
        .map_err(http::network)?;
    let value: serde_json::Value = http::parse(response)?;
    if value.get("device_id").and_then(serde_json::Value::as_str) != Some(device_id) {
        return Err(ErrorCode::DataCorrupt);
    }
    Ok(())
}
