//! The three rules the host and the plugin must compute the same way, against `apps/shared/data/store.golden.json` (written by the
//! plugin's side; its Python test is `plugins/boopis/tests/test_store_plan.py`): the tree hash, the canonical JSON, and the
//! plugin's plan hash. The tree hash sorts by path components, so `a/b.txt` comes before `a-b.txt`; the plugin will not change
//! that rule, because the locks it already wrote depend on it.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde_json::Value;

use super::plan::{canonical, plugin_hash};
use super::stage::tree_sha256;

const GOLDEN: &str = include_str!("../../../../shared/data/store.golden.json");

fn golden() -> Value {
    serde_json::from_str(GOLDEN).unwrap()
}

#[test]
fn every_tree_hash_vector_matches() {
    let g = golden();
    let vectors = g["tree_hash"].as_array().unwrap();
    assert!(vectors.len() >= 6);
    for v in vectors {
        let d = tempfile::tempdir().unwrap();
        for (rel, text) in v["files"].as_object().unwrap() {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text.as_str().unwrap()).unwrap();
        }
        assert_eq!(
            tree_sha256(d.path()).unwrap(),
            v["tree_sha256"].as_str().unwrap(),
            "{}",
            v["name"]
        );
    }
}

#[test]
fn every_canonical_json_vector_matches() {
    for v in golden()["canonical"].as_array().unwrap() {
        assert_eq!(
            canonical(&v["value"]),
            v["json"].as_str().unwrap(),
            "{}",
            v["value"]
        );
    }
}

#[test]
fn every_plugin_hash_vector_matches() {
    for v in golden()["plugin_hash"].as_array().unwrap() {
        assert_eq!(plugin_hash(&v["plan"]), v["plugin_hash"].as_str().unwrap());
        let plan: super::types::PluginPlan = serde_json::from_value({
            let mut p = v["plan"].clone();
            p["plugin_hash"] = v["plugin_hash"].clone();
            p
        })
        .unwrap();
        assert_eq!(
            plan.plugin_hash,
            v["plugin_hash"].as_str().unwrap(),
            "the vector's plan is in the contract's shape"
        );
    }
}
