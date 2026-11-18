use std::collections::BTreeMap;

use globset::{Glob, GlobMatcher, GlobSet, GlobSetBuilder};
use hypotaxis_contracts::ContractLane;
use serde::{Deserialize, Serialize};

use crate::{normalize_rel_path, KernelError};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClashKind {
    CrossLaneOverlap,
    FrozenInterfaceViolation,
    OutOfLaneScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LaneClash {
    pub path: String,
    pub kind: ClashKind,
    pub conflicting_lane_id: Option<String>,
    pub conflicting_owner_bot: Option<String>,
    pub matched_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClashReport {
    pub lane_id: String,
    pub disjoint: bool,
    pub clashes: Vec<LaneClash>,
}

#[derive(Debug, Clone)]
struct CompiledGlob {
    pattern: String,
    matcher: GlobMatcher,
}

#[derive(Debug, Clone)]
struct RegisteredLane {
    lane: ContractLane,
    scope_set: GlobSet,
    scope_globs: Vec<CompiledGlob>,
    frozen_globs: Vec<CompiledGlob>,
}

/// Registry enforcing strict file/glob disjointness across parallel Contract Lanes.
#[derive(Debug, Clone, Default)]
pub struct ContractLaneRegistry {
    lanes: BTreeMap<String, RegisteredLane>,
}

impl ContractLaneRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a `ContractLane`, validating its ID and compiling its scope and frozen-interface globs.
    pub fn register_lane(&mut self, lane: ContractLane) -> Result<(), KernelError> {
        if lane.id.trim().is_empty() {
            return Err(KernelError::InvalidInput(
                "contract lane id cannot be empty".to_string(),
            ));
        }
        if self.lanes.contains_key(&lane.id) {
            return Err(KernelError::DuplicateLane(lane.id));
        }
        if lane.scope_globs.is_empty() {
            return Err(KernelError::InvalidInput(format!(
                "contract lane '{}' must define at least one scope glob",
                lane.id
            )));
        }

        let (scope_set, scope_globs) = compile_globs(&lane.scope_globs)?;
        let (_, frozen_globs) = compile_globs(&lane.frozen_interfaces)?;

        self.lanes.insert(
            lane.id.clone(),
            RegisteredLane {
                lane,
                scope_set,
                scope_globs,
                frozen_globs,
            },
        );
        Ok(())
    }

    pub fn get_lane(&self, lane_id: &str) -> Option<&ContractLane> {
        self.lanes.get(lane_id).map(|entry| &entry.lane)
    }

    pub fn lanes(&self) -> Vec<&ContractLane> {
        self.lanes.values().map(|entry| &entry.lane).collect()
    }

    /// Detect any frozen-interface, cross-lane overlap, or out-of-lane scope clashes for `lane_id`.
    pub fn detect_clash<S: AsRef<str>>(
        &self,
        lane_id: &str,
        changed_paths: &[S],
    ) -> Result<ClashReport, KernelError> {
        let own = self
            .lanes
            .get(lane_id)
            .ok_or_else(|| KernelError::UnknownLane(lane_id.to_string()))?;

        let mut clashes = Vec::new();

        for raw_path in changed_paths {
            let path = normalize_rel_path(raw_path.as_ref());
            if path.is_empty() {
                continue;
            }

            let mut frozen_hit = false;
            for registered in self.lanes.values() {
                if let Some(pat) = first_matching_pattern(&registered.frozen_globs, &path) {
                    frozen_hit = true;
                    clashes.push(LaneClash {
                        path: path.clone(),
                        kind: ClashKind::FrozenInterfaceViolation,
                        conflicting_lane_id: Some(registered.lane.id.clone()),
                        conflicting_owner_bot: Some(registered.lane.owner_bot.clone()),
                        matched_pattern: pat,
                    });
                    break;
                }
            }
            if frozen_hit {
                continue;
            }

            let mut cross_lane_hit = false;
            for (other_id, other) in &self.lanes {
                if other_id == lane_id {
                    continue;
                }
                if let Some(pat) = first_matching_pattern(&other.scope_globs, &path) {
                    cross_lane_hit = true;
                    clashes.push(LaneClash {
                        path: path.clone(),
                        kind: ClashKind::CrossLaneOverlap,
                        conflicting_lane_id: Some(other.lane.id.clone()),
                        conflicting_owner_bot: Some(other.lane.owner_bot.clone()),
                        matched_pattern: pat,
                    });
                }
            }

            if !cross_lane_hit && !own.scope_set.is_match(&path) {
                clashes.push(LaneClash {
                    path,
                    kind: ClashKind::OutOfLaneScope,
                    conflicting_lane_id: None,
                    conflicting_owner_bot: None,
                    matched_pattern: own.lane.scope_globs.join(", "),
                });
            }
        }

        Ok(ClashReport {
            lane_id: lane_id.to_string(),
            disjoint: clashes.is_empty(),
            clashes,
        })
    }

    /// Convenience guard returning `Err` if `detect_clash` finds any conflict.
    pub fn ensure_disjoint<S: AsRef<str>>(
        &self,
        lane_id: &str,
        changed_paths: &[S],
    ) -> Result<(), KernelError> {
        let report = self.detect_clash(lane_id, changed_paths)?;
        if report.disjoint {
            Ok(())
        } else {
            let summary = report
                .clashes
                .iter()
                .map(|c| format!("{:?} on {}", c.kind, c.path))
                .collect::<Vec<_>>()
                .join("; ");
            Err(KernelError::InvalidInput(format!(
                "lane '{lane_id}' clash detected: {summary}"
            )))
        }
    }
}

fn compile_globs(patterns: &[String]) -> Result<(GlobSet, Vec<CompiledGlob>), KernelError> {
    let mut builder = GlobSetBuilder::new();
    let mut compiled = Vec::new();
    for raw in patterns {
        let mut pat = normalize_rel_path(raw);
        if pat.is_empty() {
            continue;
        }
        if raw.trim().ends_with('/') {
            pat.push_str("/**");
        }
        let glob = Glob::new(&pat)?;
        let matcher = glob.compile_matcher();
        builder.add(glob);
        compiled.push(CompiledGlob {
            pattern: pat,
            matcher,
        });
    }
    let set = builder.build()?;
    Ok((set, compiled))
}

fn first_matching_pattern(globs: &[CompiledGlob], path: &str) -> Option<String> {
    globs
        .iter()
        .find(|g| g.matcher.is_match(path))
        .map(|g| g.pattern.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_lanes() -> ContractLaneRegistry {
        let mut reg = ContractLaneRegistry::new();
        reg.register_lane(ContractLane {
            id: "lane/kernel".into(),
            owner_bot: "kernel".into(),
            frozen_interfaces: vec!["crates/hypotaxis-contracts/**".into()],
            scope_globs: vec![
                "crates/contraprova-kernel/**".into(),
                "crates/turn-primitives/**".into(),
            ],
        })
        .unwrap();
        reg.register_lane(ContractLane {
            id: "lane/bridge".into(),
            owner_bot: "bridge".into(),
            frozen_interfaces: vec!["crates/hypotaxis-contracts/**".into()],
            scope_globs: vec![
                "crates/hermes-bridge/**".into(),
                "crates/compat-loader/**".into(),
            ],
        })
        .unwrap();
        reg
    }

    #[test]
    fn disjoint_paths_pass_cleanly() {
        let reg = sample_lanes();
        let report = reg
            .detect_clash(
                "lane/kernel",
                &[
                    "crates/contraprova-kernel/src/gate.rs",
                    "crates\\turn-primitives\\src\\ship.rs",
                ],
            )
            .unwrap();
        assert!(report.disjoint);
        assert!(report.clashes.is_empty());
    }

    #[test]
    fn detects_cross_lane_frozen_and_out_of_scope_clashes() {
        let reg = sample_lanes();
        let report = reg
            .detect_clash(
                "lane/kernel",
                &[
                    "crates/hermes-bridge/src/lib.rs",
                    "crates/hypotaxis-contracts/src/lib.rs",
                    "README.md",
                ],
            )
            .unwrap();
        assert!(!report.disjoint);
        assert_eq!(report.clashes.len(), 3);
        assert_eq!(report.clashes[0].kind, ClashKind::CrossLaneOverlap);
        assert_eq!(
            report.clashes[0].conflicting_lane_id.as_deref(),
            Some("lane/bridge")
        );
        assert_eq!(report.clashes[1].kind, ClashKind::FrozenInterfaceViolation);
        assert_eq!(report.clashes[2].kind, ClashKind::OutOfLaneScope);
    }
}
