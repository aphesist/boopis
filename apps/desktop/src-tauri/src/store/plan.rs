//! The install plan: what the review card shows, and the hash the install must name (`docs/STORE.md` 5.5 and 6).
//!
//! The hash is the SHA-256 of the plan's canonical JSON: every object's keys sorted, no whitespace, UTF-8, and `plan_hash` and
//! `sessions_open` left out. It is written here by hand (not by whatever order a serializer happens to use) so it cannot change
//! with a dependency's features; the fixture's plans (`store.fixtures.json`) and the plugin's `plugin_hash` follow the same rule.
//!
//! A plan is made from three halves: the catalogue's item, the staged bytes (their tree hash and the host's scan), and the
//! layer's own plan (the connector flow's, or the plugin's [`PluginPlan`]). [`merge_plugin`] joins the plugin's half to the host's.

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::types::{
    CodeKind, CodeRun, CodeWhere, ConsentItem, Cost, FindingLevel, GovernedNote, HostBasis, HostList, InstallPlan, ItemKind, Layer,
    Pin, PluginPlan, Scan, ScanVerdict, Scope, StoreItem, Tier, Warning, WarningLevel,
};

/// The JSON of `v` with every object's keys sorted and no whitespace.
#[must_use]
pub fn canonical(v: &Value) -> String {
    fn go(v: &Value, out: &mut String) {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                out.push('{');
                for (i, k) in keys.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&Value::String(k.clone()).to_string());
                    out.push(':');
                    go(&m[k], out);
                }
                out.push('}');
            }
            Value::Array(a) => {
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    go(x, out);
                }
                out.push(']');
            }
            other => out.push_str(&other.to_string()),
        }
    }
    let mut s = String::new();
    go(v, &mut s);
    s
}

/// The plan's hash: `plan_hash` and `sessions_open` are not part of what the user agrees to.
#[must_use]
pub fn plan_hash(plan: &InstallPlan) -> String {
    let mut v = serde_json::to_value(plan).unwrap_or(Value::Null);
    if let Some(o) = v.as_object_mut() {
        o.remove("plan_hash");
        o.remove("sessions_open");
    }
    hex::encode(Sha256::digest(canonical(&v).as_bytes()))
}

/// Set the plan's hash from its contents.
pub fn seal(plan: &mut InstallPlan) {
    plan.plan_hash = plan_hash(plan);
}

fn rank(v: ScanVerdict) -> u8 {
    match v {
        ScanVerdict::Safe => 1,
        ScanVerdict::NotScanned => 0,
        ScanVerdict::Caution => 2,
        ScanVerdict::Dangerous => 3,
    }
}

/// The two scans as one: the worse verdict, both scanners named, every finding.
#[must_use]
pub fn join_scans(a: &Scan, b: &Scan) -> Scan {
    let verdict = if rank(a.verdict) >= rank(b.verdict) { a.verdict } else { b.verdict };
    // "Not scanned" must not hide behind a clean scan of the other half, and a clean scan must not read as not scanned.
    let verdict = match (a.verdict, b.verdict) {
        (ScanVerdict::NotScanned, ScanVerdict::Safe) | (ScanVerdict::Safe, ScanVerdict::NotScanned) => ScanVerdict::Safe,
        _ => verdict,
    };
    let mut findings = a.findings.clone();
    findings.extend(b.findings.iter().cloned());
    findings.truncate(100);
    Scan { verdict, scanner: format!("{}; {}", a.scanner, b.scanner), findings }
}

/// The stronger warning an item nobody reviewed carries (`docs/STORE.md` 5.5 step 4).
#[must_use]
pub fn unreviewed_warning(kind: ItemKind) -> Warning {
    let what = match kind {
        ItemKind::EnginePlugin => "Python that runs inside the engine",
        ItemKind::Connector => "a server that gets what the assistant sends it",
        _ => "instructions and code for the assistant",
    };
    Warning {
        code: "unreviewed".into(),
        level: WarningLevel::Strong,
        text: format!("Nobody reviewed this. It is {what}. Read what it runs below before you approve."),
    }
}

/// What the plan's `warnings` must hold whatever the layer said: the unreviewed warning for a `not-reviewed` tier, once.
pub fn ensure_tier_warnings(warnings: &mut Vec<Warning>, tier: Tier, kind: ItemKind) {
    if tier == Tier::NotReviewed && !warnings.iter().any(|w| w.code == "unreviewed") {
        warnings.insert(0, unreviewed_warning(kind));
    }
}

/// The note on governed mode for an item the plugin did not describe (a connector).
#[must_use]
pub fn connector_governed() -> GovernedNote {
    GovernedNote {
        allowed: true,
        switch_blocks: false,
        text: "In governed mode this server is reachable only through exec, and each call is decided by your permissions.".into(),
    }
}

/// A [`CodeRun`] for a connector's command.
#[must_use]
pub fn connector_code_run(command: &str, args: &[String]) -> CodeRun {
    let package = matches!(command, "npx" | "uvx" | "docker" | "pipx" | "bunx");
    CodeRun {
        what: if package { CodeKind::PackageStart } else { CodeKind::McpCommand },
        command: crate::connectors::validate::display_command(command, args),
        runs_where: CodeWhere::OutsideSandbox,
        sha256: None,
        detail: Some(if package {
            "Starts a package from its registry the first time a session uses it, as you, outside boopis's sandbox.".into()
        } else {
            "Runs on this computer as you, outside boopis's sandbox.".into()
        }),
    }
}

/// The host's half of a plan, from the catalogue item and what was staged.
pub struct Base<'a> {
    /// The item (a snapshot taken when it was staged).
    pub item: &'a StoreItem,
    /// What it is pinned to.
    pub pinned: Pin,
    /// The staged tree's hash, when something was staged.
    pub tree_sha256: Option<String>,
    /// The staging handle.
    pub stage_id: Option<String>,
    /// The scope.
    pub scope: Scope,
    /// The host's scan of what was staged.
    pub scan: Scan,
    /// Sessions with a turn running, when the engine could say.
    pub sessions_open: Option<u32>,
}

/// Join the plugin's half to the host's: the plugin owns components, code, files, consent and governed policy; the host owns
/// the pin, the tier, the staged hash and its own scan. Hosts and secrets come from the plugin when it knows them and from the
/// item otherwise (a plugin that reads no manifest hosts does not say "none"). The result is sealed.
#[must_use]
pub fn merge_plugin(base: Base<'_>, layer: Layer, p: PluginPlan) -> InstallPlan {
    let item = base.item;
    let hosts = if p.hosts.basis == HostBasis::Unknown && item.hosts.basis != HostBasis::Unknown { item.hosts.clone() } else { p.hosts };
    let secrets = if p.secrets.is_empty() { item.secrets.clone() } else { p.secrets };
    let mut warnings = p.warnings;
    ensure_tier_warnings(&mut warnings, item.tier, p.kind);
    let mut plan = InstallPlan {
        item_id: item.id.clone(),
        kind: p.kind,
        title: item.title.clone(),
        source: item.source.clone(),
        publisher: item.publisher.clone(),
        version: item.version.clone(),
        pinned: base.pinned,
        tree_sha256: p.tree_sha256.or(base.tree_sha256),
        stage_id: base.stage_id,
        layer,
        components: p.components,
        code_runs: p.code_runs,
        hosts,
        secrets,
        files_written: p.files_written,
        scope: base.scope,
        consent: p.consent,
        warnings,
        governed: p.governed,
        cost: p.cost,
        tier: item.tier,
        scan: join_scans(&base.scan, &p.scan),
        sessions_open: base.sessions_open,
        plan_hash: String::new(),
    };
    seal(&mut plan);
    plan
}

/// The consent item for a key.
#[must_use]
pub fn key_consent(title: &str, id: &str) -> ConsentItem {
    ConsentItem { id: format!("key-{id}"), text: format!("Keep {title} in your keychain and give it to this server when it starts."), runs_code: false }
}

/// A host list for a bundle or a local program: this computer only is not claimed; it is not known.
#[must_use]
pub fn unknown_hosts() -> HostList {
    HostList { basis: HostBasis::Unknown, hosts: vec![] }
}

/// A cost nobody measured.
#[must_use]
pub fn unknown_cost() -> Cost {
    Cost { tools: None, context_tokens: None }
}

/// Whether a finding level blocks an install.
#[must_use]
pub fn blocks(level: FindingLevel) -> bool {
    level == FindingLevel::Dangerous
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::store::types::Bundle;

    fn fixture_plans() -> Vec<InstallPlan> {
        serde_json::from_str::<Bundle>(include_str!("../../../../shared/data/store.fixtures.json")).unwrap().plans.unwrap()
    }

    #[test]
    fn the_canonical_form_sorts_every_key_and_has_no_whitespace() {
        let v: Value = serde_json::from_str(r#"{"b":[{"z":1,"a":"é\n"},2],"a":{"y":null,"x":true}}"#).unwrap();
        assert_eq!(canonical(&v), r#"{"a":{"x":true,"y":null},"b":[{"a":"é\n","z":1},2]}"#);
    }

    #[test]
    fn the_fixture_plans_hash_to_the_hashes_they_carry() {
        for p in fixture_plans() {
            assert_eq!(plan_hash(&p), p.plan_hash, "{}", p.item_id);
        }
    }

    #[test]
    fn the_hash_ignores_the_session_count_and_the_hash_itself_and_nothing_else() {
        let p = fixture_plans().remove(0);
        let h = plan_hash(&p);
        let mut q = p.clone();
        q.sessions_open = Some(99);
        q.plan_hash = "junk".into();
        assert_eq!(plan_hash(&q), h, "what the user agrees to does not include how many sessions are open");
        let mut changes: Vec<(&str, InstallPlan)> = Vec::new();
        let mut c = p.clone();
        c.pinned.value.push('0');
        changes.push(("pin", c));
        let mut c = p.clone();
        c.tree_sha256 = Some("0".repeat(64));
        changes.push(("tree", c));
        let mut c = p.clone();
        c.code_runs.clear();
        changes.push(("code", c));
        let mut c = p.clone();
        c.hosts.hosts.push("x.example".into());
        changes.push(("host", c));
        let mut c = p.clone();
        c.consent[0].runs_code = !c.consent[0].runs_code;
        changes.push(("consent", c));
        let mut c = p.clone();
        c.scope.bot = "other".into();
        changes.push(("scope", c));
        let mut c = p.clone();
        c.tier = Tier::NotReviewed;
        changes.push(("tier", c));
        let mut c = p.clone();
        c.warnings.pop();
        changes.push(("warnings", c));
        let mut c = p.clone();
        c.scan.verdict = ScanVerdict::Caution;
        changes.push(("scan", c));
        for (what, c) in changes {
            assert_ne!(plan_hash(&c), h, "a change in {what} changes the hash");
        }
    }

    #[test]
    fn the_hash_is_stable_across_a_round_trip_through_json_in_any_key_order() {
        let p = fixture_plans().remove(1);
        let reordered: Value = {
            let v = serde_json::to_value(&p).unwrap();
            // Rebuild every object with its keys reversed.
            fn flip(v: &Value) -> Value {
                match v {
                    Value::Object(m) => Value::Object(m.iter().rev().map(|(k, x)| (k.clone(), flip(x))).collect()),
                    Value::Array(a) => Value::Array(a.iter().map(flip).collect()),
                    o => o.clone(),
                }
            }
            flip(&v)
        };
        let back: InstallPlan = serde_json::from_value(reordered).unwrap();
        assert_eq!(plan_hash(&back), p.plan_hash);
    }

    #[test]
    fn scans_join_to_the_worse_verdict_and_not_scanned_never_hides_or_fakes_a_result() {
        let mk = |v, s: &str| Scan { verdict: v, scanner: s.into(), findings: vec![] };
        assert_eq!(join_scans(&mk(ScanVerdict::Safe, "a"), &mk(ScanVerdict::Caution, "b")).verdict, ScanVerdict::Caution);
        assert_eq!(join_scans(&mk(ScanVerdict::Dangerous, "a"), &mk(ScanVerdict::Safe, "b")).verdict, ScanVerdict::Dangerous);
        assert_eq!(join_scans(&mk(ScanVerdict::NotScanned, "a"), &mk(ScanVerdict::NotScanned, "b")).verdict, ScanVerdict::NotScanned);
        assert_eq!(join_scans(&mk(ScanVerdict::NotScanned, "a"), &mk(ScanVerdict::Safe, "b")).verdict, ScanVerdict::Safe);
        assert_eq!(join_scans(&mk(ScanVerdict::Safe, "a"), &mk(ScanVerdict::Safe, "b")).scanner, "a; b");
    }

    #[test]
    fn a_not_reviewed_item_always_carries_the_strong_warning_once() {
        let mut w = Vec::new();
        ensure_tier_warnings(&mut w, Tier::NotReviewed, ItemKind::Plugin);
        ensure_tier_warnings(&mut w, Tier::NotReviewed, ItemKind::Plugin);
        assert_eq!(w.len(), 1);
        assert_eq!((w[0].code.as_str(), w[0].level), ("unreviewed", WarningLevel::Strong));
        let mut none = Vec::new();
        ensure_tier_warnings(&mut none, Tier::Verified, ItemKind::Plugin);
        ensure_tier_warnings(&mut none, Tier::Recommended, ItemKind::Skill);
        assert!(none.is_empty());
    }
}
