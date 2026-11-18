//! `pack.bundle`: many requests, one budget.
// Test code: a failing unwrap is the failure report, and these pedantic style
// lints (casts in assertions, `Default::default()` in fixtures, `format!` in
// iterator chains) add noise without protecting anything.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::default_trait_access,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::format_collect,
    clippy::too_many_lines
)]

mod common;

use common::Tree;
use hx_pack::{
    BundleItem, BundleParams, BundleRequest, BundleResponse, LineRange, OutlineParams, ReadParams,
    SearchParams, StatusParams, SymbolParams, Truncation, handle_bundle,
};

fn run(t: &Tree, requests: Vec<BundleItem>, max_bytes: usize) -> BundleResponse {
    handle_bundle(&BundleRequest {
        root: t.root().to_owned(),
        params: BundleParams {
            requests,
            max_bytes,
        },
    })
    .unwrap()
}

fn search(p: &str) -> BundleItem {
    BundleItem::Search(SearchParams::new(p))
}

fn read(path: &str) -> BundleItem {
    BundleItem::Read(ReadParams {
        path: path.into(),
        ranges: vec![],
        max_bytes: None,
        walk: Default::default(),
    })
}

fn tree() -> Tree {
    let t = Tree::new();
    t.fixture("lang/sample.rs", "src/sample.rs");
    t.write("big/a.txt", &"alpha line\n".repeat(400));
    t.write("big/b.txt", &"beta line\n".repeat(400));
    t.write("small.txt", "tiny needle\n");
    t
}

#[test]
fn runs_every_method_in_one_call() {
    let t = tree();
    let items = vec![
        search("needle"),
        read("small.txt"),
        BundleItem::Symbol(SymbolParams {
            name: "Point".into(),
            path: None,
            lang: None,
            max_definitions: 5,
            max_bytes: None,
            walk: Default::default(),
        }),
        BundleItem::Outline(OutlineParams {
            paths: vec!["src".into()],
            max_bytes: None,
            max_files: 10,
            walk: Default::default(),
        }),
        BundleItem::Status(StatusParams::default()),
    ];
    let r = run(&t, items, 100_000);
    assert_eq!(r.results.len(), 5);
    assert_eq!(
        r.results
            .iter()
            .map(|e| e.method.as_str())
            .collect::<Vec<_>>(),
        [
            "pack.search",
            "pack.read",
            "pack.symbol",
            "pack.outline",
            "pack.status"
        ]
    );
    assert!(
        r.results.iter().all(|e| e.ok),
        "{:#?}",
        r.results
            .iter()
            .filter_map(|e| e.error.as_ref())
            .collect::<Vec<_>>()
    );
    assert!(r.truncated.is_empty());
    assert_eq!(r.bytes, r.results.iter().map(|e| e.bytes).sum::<usize>());
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["results"][0]["result"]["matches"], 1);
    assert!(json["results"][4]["result"]["is_repo"].is_boolean());
}

#[test]
fn a_failing_item_does_not_fail_the_bundle() {
    let t = tree();
    let r = run(
        &t,
        vec![
            read("../etc/passwd"),
            read("missing.txt"),
            read("small.txt"),
        ],
        10_000,
    );
    assert_eq!(
        r.results[0].error.as_ref().unwrap().code,
        "hx.pack.path_escape"
    );
    assert_eq!(
        r.results[1].error.as_ref().unwrap().code,
        "hx.pack.not_found"
    );
    assert!(r.results[2].ok && r.results[2].result.is_some() && r.results[2].error.is_none());
}

#[test]
fn the_budget_is_never_exceeded_and_is_split_fairly() {
    let t = tree();
    let mut alpha = SearchParams::new("alpha");
    alpha.max_matches = 10_000;
    let mut beta = SearchParams::new("beta");
    beta.max_matches = 10_000;
    for limit in [300usize, 1_000, 5_000] {
        let r = run(
            &t,
            vec![
                BundleItem::Search(alpha.clone()),
                BundleItem::Search(beta.clone()),
            ],
            limit,
        );
        assert!(r.bytes <= limit, "limit {limit}: {}", r.bytes);
        let (first, second) = (r.results[0].bytes, r.results[1].bytes);
        assert!(
            first.abs_diff(second) <= limit / 4,
            "unfair split {first} vs {second} of {limit}"
        );
        assert_eq!(r.truncated.len(), 2);
        assert!(
            r.truncated
                .iter()
                .all(|item| item.reasons.contains(&Truncation::MaxBytes))
        );
    }
}

#[test]
fn unused_share_goes_to_the_items_that_need_it() {
    let t = tree();
    let mut big = SearchParams::new("alpha");
    big.max_matches = 10_000;
    let items = vec![read("small.txt"), BundleItem::Search(big)];
    let r = run(&t, items, 4_000);
    let small = r.results[0].bytes;
    let big_bytes = r.results[1].bytes;
    assert!(small < 100);
    // Equal shares would be 2000; the big item gets almost everything the small one left.
    assert!(big_bytes > 3_000, "big got {big_bytes}");
    assert!(r.bytes <= 4_000);
    assert_eq!(r.truncated.len(), 1);
    assert_eq!(r.truncated[0].index, 1);
}

#[test]
fn an_items_own_cap_is_respected_even_with_room_to_spare() {
    let t = tree();
    let mut capped = SearchParams::new("alpha");
    capped.max_bytes = Some(500);
    capped.max_matches = 10_000;
    let r = run(&t, vec![BundleItem::Search(capped)], 50_000);
    assert!(r.bytes <= 500);
    assert!(r.truncated[0].reasons.contains(&Truncation::MaxBytes));
}

#[test]
fn results_are_deterministic() {
    let t = tree();
    let items = || {
        vec![
            search("line"),
            BundleItem::Read(ReadParams {
                path: "big/a.txt".into(),
                ranges: vec![LineRange {
                    start: 5,
                    end: Some(9),
                }],
                max_bytes: None,
                walk: Default::default(),
            }),
        ]
    };
    let first = serde_json::to_string(&run(&t, items(), 2_000)).unwrap();
    for _ in 0..5 {
        assert_eq!(
            serde_json::to_string(&run(&t, items(), 2_000)).unwrap(),
            first
        );
    }
}

#[test]
fn bad_bundles_are_rejected() {
    let t = tree();
    let call = |n: usize, max: usize| {
        handle_bundle(&BundleRequest {
            root: t.root().to_owned(),
            params: BundleParams {
                requests: (0..n).map(|_| read("small.txt")).collect(),
                max_bytes: max,
            },
        })
        .map(|_| ())
    };
    assert_eq!(call(0, 100).unwrap_err().code(), "hx.pack.invalid_request");
    assert_eq!(call(33, 100).unwrap_err().code(), "hx.pack.invalid_request");
    assert_eq!(call(1, 0).unwrap_err().code(), "hx.pack.invalid_request");
}

#[test]
fn json_request_shape() {
    let req: BundleRequest = serde_json::from_str(
        r#"{"root":"/tmp","max_bytes":5000,"requests":[
            {"method":"pack.search","params":{"pattern":"x"}},
            {"method":"pack.read","params":{"path":"a","ranges":[{"start":1,"end":2}]}},
            {"method":"pack.status","params":{}}]}"#,
    )
    .unwrap();
    assert_eq!(req.params.requests.len(), 3);
    assert_eq!(req.params.requests[1].method(), "pack.read");
}
