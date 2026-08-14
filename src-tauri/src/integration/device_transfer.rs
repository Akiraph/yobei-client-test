use crate::integration::http;
use serde::{Deserialize, Serialize};
use yobei_core::error::Result;
use yobei_core::security::transfer::{TransferOffer, TransferRequest};

#[derive(Deserialize)]
pub struct CreatedTransfer {
    pub transfer_id: String,
    pub claim_token: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
}

#[derive(Deserialize)]
struct Devices {
    devices: Vec<Device>,
}

#[derive(Deserialize)]
struct RelayOffer {
    transfer_id: String,
    sender_public_key: String,
    nonce: String,
    encrypted_payload: String,
}

pub fn create(
    server_url: &str,
    request_id: &str,
    device_id: &str,
    device_name: &str,
    receiver_public_key: &str,
) -> Result<CreatedTransfer> {
    let response = http::client()?
        .post(http::endpoint(server_url, "/api/v1/device-transfers")?)
        .json(&serde_json::json!({
            "request_id": request_id,
            "device_id": device_id,
            "device_name": device_name,
            "receiver_public_key": receiver_public_key,
        }))
        .send()
        .map_err(http::network)?;
    http::parse(response)
}

pub fn approve(
    request: &TransferRequest,
    offer: &TransferOffer,
    current_auth_key: &str,
    new_auth_key: &str,
) -> Result<()> {
    let response = http::client()?
        .post(http::endpoint(
            &request.server_url,
            &format!("/api/v1/device-transfers/{}/approve", request.transfer_id),
        )?)
        .bearer_auth(current_auth_key)
        .json(&serde_json::json!({
            "claim_token": request.claim_token,
            "sender_public_key": offer.sender_pubkey,
            "nonce": offer.nonce,
            "encrypted_payload": offer.ciphertext,
            "auth_key_b64": new_auth_key,
        }))
        .send()
        .map_err(http::network)?;
    http::parse::<serde_json::Value>(response).map(|_| ())
}

pub fn fetch(request: &TransferRequest) -> Result<TransferOffer> {
    let response = http::client()?
        .get(http::endpoint(
            &request.server_url,
            &format!("/api/v1/device-transfers/{}", request.transfer_id),
        )?)
        .query(&[("token", &request.claim_token)])
        .send()
        .map_err(http::network)?;
    let relay: RelayOffer = http::parse(response)?;
    Ok(TransferOffer {
        version: request.version,
        context: request.context.clone(),
        transfer_id: relay.transfer_id,
        claim_token: request.claim_token.clone(),
        sender_pubkey: relay.sender_public_key,
        nonce: relay.nonce,
        ciphertext: relay.encrypted_payload,
    })
}

pub fn acknowledge(request: &TransferRequest, auth_key: &str) -> Result<()> {
    let response = http::client()?
        .delete(http::endpoint(
            &request.server_url,
            &format!("/api/v1/device-transfers/{}/ack", request.transfer_id),
        )?)
        .bearer_auth(auth_key)
        .send()
        .map_err(http::network)?;
    http::parse::<serde_json::Value>(response).map(|_| ())
}

pub fn devices(server_url: &str, auth_key: &str) -> Result<Vec<Device>> {
    let response = http::client()?
        .get(http::endpoint(server_url, "/api/v1/devices")?)
        .bearer_auth(auth_key)
        .send()
        .map_err(http::network)?;
    Ok(http::parse::<Devices>(response)?.devices)
}

pub fn revoke(server_url: &str, device_id: &str, auth_key: &str) -> Result<()> {
    let response = http::client()?
        .delete(http::endpoint(
            server_url,
            &format!("/api/v1/devices/{device_id}"),
        )?)
        .bearer_auth(auth_key)
        .send()
        .map_err(http::network)?;
    http::parse::<serde_json::Value>(response).map(|_| ())
}
