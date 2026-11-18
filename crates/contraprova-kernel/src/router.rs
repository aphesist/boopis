use hypotaxis_contracts::CascadeTier;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteDecision {
    pub from_tier: CascadeTier,
    pub next_tier: Option<CascadeTier>,
    pub retried_same_tier: bool,
    pub escalated: bool,
    pub exhausted: bool,
    pub reason: String,
}

/// Counterfactual Cascade Router:
/// - Starts at `Tier1Fast`
/// - Retries the same tier once on a pure scope/protected-file violation
/// - Escalates `Tier1Fast -> Tier2Balanced -> Tier3Frontier` on semantic/test gate failure
///   or repeated scope violation.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CascadeRouter {
    scope_retry_used: [bool; 3],
    history: Vec<RouteDecision>,
}

impl CascadeRouter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn initial_tier(&self) -> CascadeTier {
        CascadeTier::Tier1Fast
    }

    /// Evaluate the next tier transition after a gate outcome.
    pub fn escalate(
        &mut self,
        current: CascadeTier,
        gate_passed: bool,
        pure_scope_violation: bool,
    ) -> Option<CascadeTier> {
        self.decide(current, gate_passed, pure_scope_violation)
            .next_tier
    }

    /// Evaluate and record the full routing decision.
    pub fn decide(
        &mut self,
        current: CascadeTier,
        gate_passed: bool,
        pure_scope_violation: bool,
    ) -> RouteDecision {
        let decision = if gate_passed {
            RouteDecision {
                from_tier: current,
                next_tier: None,
                retried_same_tier: false,
                escalated: false,
                exhausted: false,
                reason: "gate_passed".to_string(),
            }
        } else if pure_scope_violation {
            let idx = tier_index(current);
            if !self.scope_retry_used[idx] {
                self.scope_retry_used[idx] = true;
                RouteDecision {
                    from_tier: current,
                    next_tier: Some(current),
                    retried_same_tier: true,
                    escalated: false,
                    exhausted: false,
                    reason: "pure_scope_retry_same_tier".to_string(),
                }
            } else {
                let next_tier = current.next();
                RouteDecision {
                    from_tier: current,
                    next_tier,
                    retried_same_tier: false,
                    escalated: next_tier.is_some(),
                    exhausted: next_tier.is_none(),
                    reason: if next_tier.is_some() {
                        "repeated_scope_violation_escalated".to_string()
                    } else {
                        "cascade_exhausted_after_scope_retry".to_string()
                    },
                }
            }
        } else {
            let next_tier = current.next();
            RouteDecision {
                from_tier: current,
                next_tier,
                retried_same_tier: false,
                escalated: next_tier.is_some(),
                exhausted: next_tier.is_none(),
                reason: if next_tier.is_some() {
                    "semantic_or_test_failure_escalated".to_string()
                } else {
                    "cascade_exhausted_at_frontier".to_string()
                },
            }
        };

        self.history.push(decision.clone());
        decision
    }

    pub fn history(&self) -> &[RouteDecision] {
        &self.history
    }

    pub fn scope_retry_used_for(&self, tier: CascadeTier) -> bool {
        self.scope_retry_used[tier_index(tier)]
    }

    pub fn reset(&mut self) {
        self.scope_retry_used = [false; 3];
        self.history.clear();
    }
}

fn tier_index(tier: CascadeTier) -> usize {
    match tier {
        CascadeTier::Tier1Fast => 0,
        CascadeTier::Tier2Balanced => 1,
        CascadeTier::Tier3Frontier => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_violation_retries_same_tier_once_then_escalates() {
        let mut router = CascadeRouter::new();
        let t0 = router.initial_tier();
        assert_eq!(t0, CascadeTier::Tier1Fast);

        // First pure scope violation retries Tier1Fast.
        let t1 = router.escalate(t0, false, true);
        assert_eq!(t1, Some(CascadeTier::Tier1Fast));

        // Second pure scope violation on Tier1Fast escalates to Tier2Balanced.
        let t2 = router.escalate(CascadeTier::Tier1Fast, false, true);
        assert_eq!(t2, Some(CascadeTier::Tier2Balanced));

        // Pure scope violation at Tier2Balanced retries Tier2Balanced once.
        let t2_retry = router.escalate(CascadeTier::Tier2Balanced, false, true);
        assert_eq!(t2_retry, Some(CascadeTier::Tier2Balanced));

        // Semantic/test failure escalates immediately Tier2Balanced -> Tier3Frontier.
        let t3 = router.escalate(CascadeTier::Tier2Balanced, false, false);
        assert_eq!(t3, Some(CascadeTier::Tier3Frontier));

        // Gate pass returns None.
        assert_eq!(router.escalate(CascadeTier::Tier3Frontier, true, false), None);
    }

    #[test]
    fn semantic_failure_escalates_full_ladder_and_terminates() {
        let mut router = CascadeRouter::new();
        assert_eq!(router.initial_tier(), CascadeTier::Tier1Fast);
        assert_eq!(
            router.escalate(CascadeTier::Tier1Fast, false, false),
            Some(CascadeTier::Tier2Balanced)
        );
        assert_eq!(
            router.escalate(CascadeTier::Tier2Balanced, false, false),
            Some(CascadeTier::Tier3Frontier)
        );
        assert_eq!(
            router.escalate(CascadeTier::Tier3Frontier, false, false),
            None
        );
        assert_eq!(router.history().len(), 3);
    }
}
