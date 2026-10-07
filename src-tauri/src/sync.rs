//! Shares a Sonos system's floorplan, name and Spotify link with everyone on
//! the same network, through a tiny blob store (`sync/` in this repo).
//!
//! Everything is derived from the household ID, which you can only read from
//! the speakers themselves: the document key is a hash of it and the content
//! is AES-256-GCM encrypted with another hash of it. The server never sees
//! which system it stores, or what's in it.

use crate::sonos::Res;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

const SYNC_URL: &str = match option_env!("SPONOS_SYNC_URL") {
    Some(url) => url,
    None => "https://sponos-sync.vercel.app/api/plan",
};

/// What everyone on a system shares. Personal settings (theme, Spotify login) stay local.
#[derive(Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Shared {
    /// floorplan JSON as the frontend stores it (image data URL + pins)
    pub floorplan: Option<String>,
    pub name: Option<String>,
    /// Sonos ↔ Spotify account override (sid, sn)
    pub spotify: Option<(u32, u32)>,
}

impl Shared {
    pub fn is_empty(&self) -> bool {
        *self == Shared::default()
    }
}

pub enum Pulled {
    Unchanged,
    /// nobody has shared this system yet
    Missing,
    Doc { etag: String, shared: Shared },
}

fn digest(label: &str, household: &str) -> [u8; 32] {
    Sha256::digest(format!("sponos-{label}:{household}").as_bytes()).into()
}

fn doc_key(household: &str) -> String {
    digest("doc", household).iter().map(|b| format!("{b:02x}")).collect()
}

fn url(household: &str) -> String {
    format!("{SYNC_URL}?key={}", doc_key(household))
}

fn cipher(household: &str) -> Aes256Gcm {
    Aes256Gcm::new(&digest("key", household).into())
}

fn seal(household: &str, shared: &Shared) -> Res<Vec<u8>> {
    use rand::RngExt;
    let plain = serde_json::to_vec(shared).map_err(|e| e.to_string())?;
    let nonce: [u8; 12] = rand::rng().random();
    let mut out = nonce.to_vec();
    out.extend(cipher(household).encrypt(&Nonce::from(nonce), plain.as_slice()).map_err(|_| "encrypt failed")?);
    Ok(out)
}

fn open(household: &str, data: &[u8]) -> Res<Shared> {
    if data.len() < 12 {
        return Err("sync: short document".into());
    }
    let (nonce, body) = data.split_at(12);
    let nonce: [u8; 12] = nonce.try_into().map_err(|_| "sync: bad nonce")?;
    let plain = cipher(household).decrypt(&Nonce::from(nonce), body).map_err(|_| "sync: can't decrypt")?;
    serde_json::from_slice(&plain).map_err(|e| e.to_string())
}

pub async fn pull(http: &reqwest::Client, household: &str, etag: Option<&str>) -> Res<Pulled> {
    let mut req = http.get(url(household)).timeout(Duration::from_secs(15));
    if let Some(etag) = etag {
        req = req.header("if-none-match", etag);
    }
    let r = req.send().await.map_err(|e| e.to_string())?;
    match r.status().as_u16() {
        304 => Ok(Pulled::Unchanged),
        404 => Ok(Pulled::Missing),
        200 => {
            let etag = r.headers().get("etag").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
            let body = r.bytes().await.map_err(|e| e.to_string())?;
            Ok(Pulled::Doc { etag, shared: open(household, &body)? })
        }
        s => Err(format!("sync: HTTP {s}")),
    }
}

/// Returns the new etag.
pub async fn push(http: &reqwest::Client, household: &str, shared: &Shared) -> Res<String> {
    let r = http
        .put(url(household))
        .body(seal(household, shared)?)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("sync: HTTP {}", r.status()));
    }
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(v["etag"].as_str().unwrap_or_default().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let s = Shared { floorplan: Some("{\"pins\":{}}".into()), name: Some("Office".into()), spotify: Some((9, 34)) };
        let sealed = seal("Sonos_abc", &s).unwrap();
        assert!(open("Sonos_abc", &sealed).unwrap() == s);
        assert!(open("Sonos_other", &sealed).is_err(), "another household can't read it");
        assert_eq!(doc_key("Sonos_abc").len(), 64);
    }

    /// cargo test --lib sync -- --ignored  (talks to the real service)
    #[tokio::test]
    #[ignore]
    async fn live() {
        let http = reqwest::Client::new();
        let hh = format!("test-{}", rand::random::<u64>());
        assert!(matches!(pull(&http, &hh, None).await.unwrap(), Pulled::Missing));
        let s = Shared { name: Some("Test".into()), ..Default::default() };
        let etag = push(&http, &hh, &s).await.unwrap();
        assert!(matches!(pull(&http, &hh, Some(&etag)).await.unwrap(), Pulled::Unchanged));
        match pull(&http, &hh, None).await.unwrap() {
            Pulled::Doc { shared, .. } => assert!(shared == s),
            _ => panic!("expected doc"),
        }
    }
}
