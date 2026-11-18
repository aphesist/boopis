use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::Result;
use chrono::Utc;
use hypotaxis_contracts::{CascadeTier, EventKind, LedgerEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::KernelError;

/// Canonical SHA-256 genesis hash (64 hex zeros) used as `prev_hash` for `seq = 1`.
pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Frontier uncached pricing baseline (USD per 1M tokens) for counterfactual comparison.
const FRONTIER_INPUT_PER_M: f64 = 15.00;
const FRONTIER_OUTPUT_PER_M: f64 = 75.00;
const FRONTIER_CACHE_READ_PER_M: f64 = 1.50;

const BALANCED_INPUT_PER_M: f64 = 3.00;
const BALANCED_OUTPUT_PER_M: f64 = 15.00;
const BALANCED_CACHE_READ_PER_M: f64 = 0.30;

const FAST_INPUT_PER_M: f64 = 0.80;
const FAST_OUTPUT_PER_M: f64 = 4.00;
const FAST_CACHE_READ_PER_M: f64 = 0.08;

/// Typed payload schema accepted by `Ledger::append_usage` and parsed by `project_usage_cost`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UsageRecordInput {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub tier: Option<CascadeTier>,
    #[serde(default)]
    pub subscription_covered: bool,
}

/// Aggregated cost & subscription-quota projection computed from `UsageRecorded` ledger events.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsageCostProjection {
    pub total_events: usize,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub raw_api_equivalent_usd: f64,
    pub cascade_actual_usd: f64,
    pub billed_api_usd: f64,
    pub cost_saved_usd: f64,
    pub savings_pct: f64,
    pub subscription_quota_saved_pct: f64,
    pub subscription_covered_tokens: u64,
    pub cache_hit_rate: f64,
}

/// Append-only SHA-256 hash-chained JSONL ledger.
#[derive(Debug, Clone)]
pub struct Ledger {
    path: PathBuf,
    next_seq: u64,
    last_hash: String,
}

impl Ledger {
    /// Open or initialize an append-only JSONL ledger at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }

        if !path.exists() {
            OpenOptions::new().create(true).append(true).open(&path)?;
            return Ok(Self {
                path,
                next_seq: 1,
                last_hash: GENESIS_HASH.to_string(),
            });
        }

        let content = fs::read_to_string(&path)?;
        let mut next_seq = 1u64;
        let mut last_hash = GENESIS_HASH.to_string();

        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<LedgerEvent>(line) {
                next_seq = event.seq.saturating_add(1);
                last_hash = event.hash;
            } else {
                // Keep opening leniently so `verify_chain()` can explicitly diagnose corruption.
                next_seq = next_seq.saturating_add(1);
            }
        }

        Ok(Self {
            path,
            next_seq,
            last_hash,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn head_hash(&self) -> &str {
        &self.last_hash
    }

    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    /// Append a new hash-chained event to the JSONL ledger and flush it to disk.
    pub fn append(&mut self, kind: EventKind, payload: Value) -> Result<LedgerEvent> {
        let seq = self.next_seq;
        let timestamp = Utc::now().to_rfc3339();
        let prev_hash = self.last_hash.clone();
        let hash = compute_event_hash(seq, &timestamp, kind, &prev_hash, &payload)?;

        let event = LedgerEvent {
            seq,
            timestamp,
            kind,
            prev_hash,
            hash,
            payload,
        };

        let encoded = serde_json::to_string(&event)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{encoded}")?;
        file.flush()?;

        self.next_seq = seq.saturating_add(1);
        self.last_hash = event.hash.clone();

        Ok(event)
    }

    /// Convenience helper to append a typed `UsageRecorded` event.
    pub fn append_usage(&mut self, usage: UsageRecordInput) -> Result<LedgerEvent> {
        let payload = serde_json::to_value(usage)?;
        self.append(EventKind::UsageRecorded, payload)
    }

    /// Verify every record's sequence number, `prev_hash` linkage, and SHA-256 digest on disk.
    /// Returns the number of verified events.
    pub fn verify_chain(&self) -> Result<usize> {
        let content = fs::read_to_string(&self.path)?;
        if content.is_empty() {
            return Ok(0);
        }

        let mut expected_seq = 1u64;
        let mut expected_prev = GENESIS_HASH.to_string();
        let mut count = 0usize;

        for (idx, line) in content.lines().enumerate() {
            if line.trim().is_empty() {
                return Err(KernelError::InvalidChain {
                    seq: (idx + 1) as u64,
                    reason: "unexpected blank line inside ledger".to_string(),
                }
                .into());
            }

            let event: LedgerEvent =
                serde_json::from_str(line).map_err(|err| KernelError::InvalidChain {
                    seq: (idx + 1) as u64,
                    reason: format!("malformed JSON record: {err}"),
                })?;

            if event.seq != expected_seq {
                return Err(KernelError::InvalidChain {
                    seq: event.seq,
                    reason: format!("expected seq {expected_seq}, found {}", event.seq),
                }
                .into());
            }

            if event.prev_hash != expected_prev {
                return Err(KernelError::InvalidChain {
                    seq: event.seq,
                    reason: format!(
                        "prev_hash mismatch: expected {expected_prev}, found {}",
                        event.prev_hash
                    ),
                }
                .into());
            }

            let recomputed = compute_event_hash(
                event.seq,
                &event.timestamp,
                event.kind,
                &event.prev_hash,
                &event.payload,
            )?;

            if event.hash != recomputed {
                return Err(KernelError::InvalidChain {
                    seq: event.seq,
                    reason: format!(
                        "hash mismatch: expected {recomputed}, found {}",
                        event.hash
                    ),
                }
                .into());
            }

            expected_seq = expected_seq.saturating_add(1);
            expected_prev = event.hash;
            count += 1;
        }

        Ok(count)
    }

    /// Read and parse all events from the ledger file.
    pub fn events(&self) -> Result<Vec<LedgerEvent>> {
        let content = fs::read_to_string(&self.path)?;
        let mut out = Vec::new();
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            out.push(serde_json::from_str::<LedgerEvent>(line)?);
        }
        Ok(out)
    }

    /// Project raw token counts across all `UsageRecorded` events into USD cost and subscription quota savings.
    pub fn project_usage_cost(&self) -> Result<UsageCostProjection> {
        let events = self.events()?;
        let mut total_events = 0usize;
        let mut total_input_tokens = 0u64;
        let mut total_output_tokens = 0u64;
        let mut total_cache_read_tokens = 0u64;
        let mut raw_api_equivalent_usd = 0.0f64;
        let mut cascade_actual_usd = 0.0f64;
        let mut billed_api_usd = 0.0f64;
        let mut subscription_covered_tokens = 0u64;

        for event in events {
            if event.kind != EventKind::UsageRecorded {
                continue;
            }
            total_events += 1;

            let input = extract_u64(&event.payload, &["input_tokens", "prompt_tokens"]);
            let output = extract_u64(&event.payload, &["output_tokens", "completion_tokens"]);
            let cache_read = extract_u64(
                &event.payload,
                &["cache_read_tokens", "cache_read_input_tokens", "cached_tokens"],
            );
            let tier = extract_tier(&event.payload).unwrap_or(CascadeTier::Tier1Fast);
            let subscription_covered =
                extract_bool(&event.payload, &["subscription_covered", "zero_api_cost"]);

            let (raw_usd, actual_usd, billed_usd) =
                project_tokens_cost(input, output, cache_read, tier, subscription_covered);

            total_input_tokens = total_input_tokens.saturating_add(input);
            total_output_tokens = total_output_tokens.saturating_add(output);
            total_cache_read_tokens = total_cache_read_tokens.saturating_add(cache_read);
            raw_api_equivalent_usd += raw_usd;
            cascade_actual_usd += actual_usd;
            billed_api_usd += billed_usd;

            if subscription_covered {
                subscription_covered_tokens = subscription_covered_tokens
                    .saturating_add(input)
                    .saturating_add(output)
                    .saturating_add(cache_read);
            }
        }

        let cost_saved_usd = (raw_api_equivalent_usd - billed_api_usd).max(0.0);
        let savings_pct = if raw_api_equivalent_usd > 0.0 {
            ((cost_saved_usd / raw_api_equivalent_usd) * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        let subscription_quota_saved_pct = if raw_api_equivalent_usd > 0.0 {
            (((raw_api_equivalent_usd - cascade_actual_usd) / raw_api_equivalent_usd) * 100.0)
                .clamp(0.0, 100.0)
        } else {
            0.0
        };
        let total_prompt_tokens = total_input_tokens.saturating_add(total_cache_read_tokens);
        let cache_hit_rate = if total_prompt_tokens > 0 {
            (total_cache_read_tokens as f64 / total_prompt_tokens as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };

        Ok(UsageCostProjection {
            total_events,
            total_input_tokens,
            total_output_tokens,
            total_cache_read_tokens,
            raw_api_equivalent_usd,
            cascade_actual_usd,
            billed_api_usd,
            cost_saved_usd,
            savings_pct,
            subscription_quota_saved_pct,
            subscription_covered_tokens,
            cache_hit_rate,
        })
    }
}

/// Project token counts into `(raw_frontier_uncached_usd, cascade_effective_usd, billed_api_usd)`.
pub fn project_tokens_cost(
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    tier: CascadeTier,
    subscription_covered: bool,
) -> (f64, f64, f64) {
    let raw_total_input = input_tokens.saturating_add(cache_read_tokens) as f64;
    let raw_usd = (raw_total_input * FRONTIER_INPUT_PER_M
        + (output_tokens as f64) * FRONTIER_OUTPUT_PER_M)
        / 1_000_000.0;

    let (in_rate, out_rate, cache_rate) = match tier {
        CascadeTier::Tier1Fast => (FAST_INPUT_PER_M, FAST_OUTPUT_PER_M, FAST_CACHE_READ_PER_M),
        CascadeTier::Tier2Balanced => (
            BALANCED_INPUT_PER_M,
            BALANCED_OUTPUT_PER_M,
            BALANCED_CACHE_READ_PER_M,
        ),
        CascadeTier::Tier3Frontier => (
            FRONTIER_INPUT_PER_M,
            FRONTIER_OUTPUT_PER_M,
            FRONTIER_CACHE_READ_PER_M,
        ),
    };

    let cascade_usd = ((input_tokens as f64) * in_rate
        + (output_tokens as f64) * out_rate
        + (cache_read_tokens as f64) * cache_rate)
        / 1_000_000.0;

    let billed_usd = if subscription_covered { 0.0 } else { cascade_usd };
    (raw_usd, cascade_usd, billed_usd)
}

/// Compute canonical SHA-256 hex digest over `seq|timestamp|kind|prev_hash|payload`.
pub fn compute_event_hash(
    seq: u64,
    timestamp: &str,
    kind: EventKind,
    prev_hash: &str,
    payload: &Value,
) -> Result<String> {
    let kind_str = event_kind_str(kind);
    let payload_json = canonical_json(payload)?;
    let preimage = format!("{seq}|{timestamp}|{kind_str}|{prev_hash}|{payload_json}");
    let digest = Sha256::digest(preimage.as_bytes());
    Ok(hex::encode(digest))
}

fn event_kind_str(kind: EventKind) -> &'static str {
    match kind {
        EventKind::TaskCreated => "task_created",
        EventKind::TaskClaimed => "task_claimed",
        EventKind::TaskSubmitted => "task_submitted",
        EventKind::GateDecided => "gate_decided",
        EventKind::RouteDecided => "route_decided",
        EventKind::RouterTrained => "router_trained",
        EventKind::ForkCreated => "fork_created",
        EventKind::UsageRecorded => "usage_recorded",
        EventKind::OutcomeScored => "outcome_scored",
    }
}

fn canonical_json(value: &Value) -> Result<String> {
    match value {
        Value::Object(map) => {
            let mut sorted: BTreeMap<&str, String> = BTreeMap::new();
            for (k, v) in map {
                sorted.insert(k.as_str(), canonical_json(v)?);
            }
            let mut out = String::from("{");
            for (idx, (k, v_json)) in sorted.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k)?);
                out.push(':');
                out.push_str(v_json);
            }
            out.push('}');
            Ok(out)
        }
        Value::Array(items) => {
            let mut out = String::from("[");
            for (idx, item) in items.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                out.push_str(&canonical_json(item)?);
            }
            out.push(']');
            Ok(out)
        }
        _ => Ok(serde_json::to_string(value)?),
    }
}

fn extract_u64(payload: &Value, keys: &[&str]) -> u64 {
    for key in keys {
        if let Some(val) = payload.get(*key).and_then(|v| v.as_u64()) {
            return val;
        }
    }
    0
}

fn extract_bool(payload: &Value, keys: &[&str]) -> bool {
    for key in keys {
        if let Some(val) = payload.get(*key).and_then(|v| v.as_bool()) {
            return val;
        }
    }
    false
}

fn extract_tier(payload: &Value) -> Option<CascadeTier> {
    let val = payload.get("tier")?;
    serde_json::from_value::<CascadeTier>(val.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_ledger_path() -> PathBuf {
        std::env::temp_dir()
            .join(format!("hypo-{}", uuid::Uuid::new_v4()))
            .join("ledger.jsonl")
    }

    #[test]
    fn append_and_verify_hash_chain() {
        let path = temp_ledger_path();
        let dir = path.parent().unwrap().to_path_buf();

        let mut ledger = Ledger::open(&path).unwrap();
        let e1 = ledger
            .append(EventKind::TaskCreated, json!({"task": "t1", "b": 2, "a": 1}))
            .unwrap();
        assert_eq!(e1.seq, 1);
        assert_eq!(e1.prev_hash, GENESIS_HASH);

        let e2 = ledger
            .append(EventKind::GateDecided, json!({"passed": true}))
            .unwrap();
        assert_eq!(e2.seq, 2);
        assert_eq!(e2.prev_hash, e1.hash);

        let verified = ledger.verify_chain().unwrap();
        assert_eq!(verified, 2);

        // Re-opening continues the chain seamlessly.
        let mut reopened = Ledger::open(&path).unwrap();
        let e3 = reopened
            .append(EventKind::OutcomeScored, json!({"score": 1.0}))
            .unwrap();
        assert_eq!(e3.seq, 3);
        assert_eq!(e3.prev_hash, e2.hash);
        assert_eq!(reopened.verify_chain().unwrap(), 3);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_chain_detects_tampering() {
        let path = temp_ledger_path();
        let dir = path.parent().unwrap().to_path_buf();

        let mut ledger = Ledger::open(&path).unwrap();
        ledger
            .append(EventKind::TaskCreated, json!({"goal": "keep safe"}))
            .unwrap();
        ledger
            .append(EventKind::GateDecided, json!({"passed": false}))
            .unwrap();
        assert_eq!(ledger.verify_chain().unwrap(), 2);

        // Tamper payload on disk without recomputing hash.
        let contents = fs::read_to_string(&path).unwrap();
        let tampered = contents.replacen("\"passed\":false", "\"passed\":true", 1);
        fs::write(&path, tampered).unwrap();

        let err = ledger.verify_chain().unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("hash mismatch"), "unexpected error: {msg}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_usage_cost_computes_usd_and_quota_saved() {
        let path = temp_ledger_path();
        let dir = path.parent().unwrap().to_path_buf();

        let mut ledger = Ledger::open(&path).unwrap();
        ledger
            .append_usage(UsageRecordInput {
                input_tokens: 1_000,
                output_tokens: 500,
                cache_read_tokens: 9_000,
                tier: Some(CascadeTier::Tier1Fast),
                subscription_covered: true,
            })
            .unwrap();

        let proj = ledger.project_usage_cost().unwrap();
        assert_eq!(proj.total_events, 1);
        assert_eq!(proj.total_input_tokens, 1_000);
        assert_eq!(proj.total_output_tokens, 500);
        assert_eq!(proj.total_cache_read_tokens, 9_000);
        assert_eq!(proj.billed_api_usd, 0.0);
        assert!(proj.raw_api_equivalent_usd > proj.cascade_actual_usd);
        assert!((proj.cost_saved_usd - proj.raw_api_equivalent_usd).abs() < 1e-9);
        assert!(proj.subscription_quota_saved_pct > 90.0);
        assert!((proj.cache_hit_rate - 0.9).abs() < 1e-9);
        assert_eq!(proj.subscription_covered_tokens, 10_500);

        let _ = fs::remove_dir_all(&dir);
    }
}
