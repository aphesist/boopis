//! `pack.read`: whole files, ranges, and everything that is not text.
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
    LineRange, ReadParams, ReadRequest, ReadResponse, ReadStatus, Truncation, handle_read,
};

fn params(path: &str, ranges: &[(u32, Option<u32>)]) -> ReadParams {
    ReadParams {
        path: path.to_owned(),
        ranges: ranges
            .iter()
            .map(|&(start, end)| LineRange { start, end })
            .collect(),
        max_bytes: None,
        walk: hx_pack::WalkOptions::default(),
    }
}

fn read(t: &Tree, p: ReadParams) -> hx_pack::Result<ReadResponse> {
    handle_read(&ReadRequest {
        root: t.root().to_owned(),
        params: p,
    })
}

#[test]
fn whole_file_with_line_numbers() {
    let t = Tree::new();
    t.write("a.txt", "one\ntwo\nthree\n");
    let r = read(&t, params("a.txt", &[])).unwrap();
    assert_eq!(r.status, ReadStatus::Ok);
    assert_eq!(r.total_lines, 3);
    assert_eq!(r.segments.len(), 1);
    assert_eq!(r.segments[0].text, "1|one\n2|two\n3|three\n");
    assert_eq!((r.segments[0].start_line, r.segments[0].end_line), (1, 3));
    assert!(r.truncated.is_empty());
}

#[test]
fn ranges_are_sorted_merged_and_clamped() {
    let t = Tree::new();
    t.write(
        "a.txt",
        &(1..=20).map(|i| format!("L{i}\n")).collect::<String>(),
    );
    let r = read(
        &t,
        params(
            "a.txt",
            &[
                (15, Some(99)),
                (3, Some(5)),
                (5, Some(7)),
                (9, Some(9)),
                (10, Some(10)),
            ],
        ),
    )
    .unwrap();
    let got: Vec<_> = r
        .segments
        .iter()
        .map(|s| (s.start_line, s.end_line))
        .collect();
    assert_eq!(got, [(3, 7), (9, 10), (15, 20)]);
    assert!(r.segments[0].text.starts_with("3|L3\n"));
    let open = read(&t, params("a.txt", &[(18, None)])).unwrap();
    assert_eq!(open.segments[0].text, "18|L18\n19|L19\n20|L20\n");
    let past = read(&t, params("a.txt", &[(50, Some(60)), (1, Some(1))])).unwrap();
    assert_eq!(
        past.unsatisfied,
        [LineRange {
            start: 50,
            end: Some(60)
        }]
    );
    assert_eq!(past.segments.len(), 1);
}

#[test]
fn bad_ranges_are_invalid_requests() {
    let t = Tree::new();
    t.write("a.txt", "x\n");
    for ranges in [vec![(0, Some(3))], vec![(5, Some(2))]] {
        assert_eq!(
            read(&t, params("a.txt", &ranges)).unwrap_err().code(),
            "hx.pack.invalid_request"
        );
    }
    let many: Vec<_> = (1..=101).map(|i| (i, Some(i))).collect();
    assert_eq!(
        read(&t, params("a.txt", &many)).unwrap_err().code(),
        "hx.pack.invalid_request"
    );
}

#[test]
fn never_pack_files_are_withheld_even_when_named() {
    let t = Tree::new();
    t.write(".env", "SECRET=hunter2\n");
    t.write(
        "keys/id_rsa",
        "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
    );
    t.write("certs/ca.pem", "pem");
    for p in [
        ".env",
        "keys/id_rsa",
        "certs/ca.pem",
        "./.env",
        "keys//id_rsa",
    ] {
        let r = read(&t, params(p, &[])).unwrap();
        assert_eq!(r.status, ReadStatus::Withheld, "{p}");
        assert!(r.segments.is_empty() && r.withheld.is_some());
        assert!(!serde_json::to_string(&r).unwrap().contains("hunter2"));
    }
}

#[test]
fn binary_oversized_directories_and_missing_files() {
    let t = Tree::new();
    t.write_bytes("b.bin", &[1, 2, 0, 3]);
    t.write("big.txt", &"y".repeat(3000));
    t.write("d/x.txt", "x");
    assert_eq!(
        read(&t, params("b.bin", &[])).unwrap().status,
        ReadStatus::Binary
    );
    let mut p = params("big.txt", &[]);
    p.walk.max_file_bytes = Some(1000);
    assert_eq!(read(&t, p).unwrap().status, ReadStatus::TooLarge);
    assert_eq!(
        read(&t, params("d", &[])).unwrap_err().code(),
        "hx.pack.invalid_request"
    );
    assert_eq!(
        read(&t, params("nope.txt", &[])).unwrap_err().code(),
        "hx.pack.not_found"
    );
    assert_eq!(
        read(&t, params("", &[])).unwrap_err().code(),
        "hx.pack.invalid_request"
    );
}

#[test]
fn a_secret_spanning_the_range_edge_is_still_redacted() {
    let t = Tree::new();
    t.write(
        "k.txt",
        "top\n-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\nbottom\n",
    );
    // Lines 3-4 are the middle of the key block.
    let r = read(&t, params("k.txt", &[(3, Some(4))])).unwrap();
    assert_eq!(r.segments[0].text, "3|\n4|\n");
    assert!(!serde_json::to_string(&r).unwrap().contains("AAAA"));
    let whole = read(&t, params("k.txt", &[(2, Some(2))])).unwrap();
    assert_eq!(whole.segments[0].text, "2|[REDACTED:private_key]\n");
    assert_eq!(whole.redactions.total, 1);
    assert_eq!(whole.total_lines, 6);
}

#[test]
fn the_budget_cuts_a_file_at_a_line_boundary() {
    let t = Tree::new();
    t.write(
        "a.txt",
        &(1..=100).map(|i| format!("row {i}\n")).collect::<String>(),
    );
    let mut p = params("a.txt", &[]);
    p.max_bytes = Some(120);
    let r = read(&t, p).unwrap();
    assert!(r.bytes <= 120 && r.truncated.contains(&Truncation::MaxBytes));
    let seg = &r.segments[0];
    assert!(seg.text.ends_with('\n') && seg.end_line < 100);
    assert_eq!(seg.text.lines().count() as u32, seg.end_line);
    // A budget too small for even a header returns nothing, honestly.
    let mut p = params("a.txt", &[]);
    p.max_bytes = Some(5);
    let r = read(&t, p).unwrap();
    assert!(r.segments.is_empty() && r.truncated.contains(&Truncation::MaxBytes) && r.bytes <= 5);
}

#[test]
fn crlf_and_missing_final_newline() {
    let t = Tree::new();
    t.write_bytes("w.txt", b"a\r\nb\r\nc");
    let r = read(&t, params("w.txt", &[])).unwrap();
    assert_eq!(r.segments[0].text, "1|a\n2|b\n3|c\n");
    assert_eq!(r.total_lines, 3);
    t.write("empty.txt", "");
    let e = read(&t, params("empty.txt", &[])).unwrap();
    assert_eq!((e.total_lines, e.segments.len()), (0, 0));
}

#[test]
fn invalid_utf8_is_replaced_not_fatal() {
    let t = Tree::new();
    t.write_bytes("l1.txt", b"caf\xe9\nok\n");
    let r = read(&t, params("l1.txt", &[])).unwrap();
    assert!(r.segments[0].text.starts_with("1|caf\u{fffd}\n"));
}

#[test]
fn env_templates_are_readable_but_redacted_and_other_env_files_are_not() {
    let t = Tree::new();
    t.write(
        ".env.example",
        "API_URL=https://example.com\nSTRIPE_KEY=sk_live_abcdefghijklmnop1234\n# fill in\n",
    );
    t.write(".env.local", "SECRET=1\n");
    t.write(".env.production", "SECRET=2\n");
    let r = read(&t, params(".env.example", &[])).unwrap();
    assert_eq!(r.status, ReadStatus::Ok);
    assert!(r.segments[0].text.contains("API_URL=https://example.com"));
    assert!(r.segments[0].text.contains("[REDACTED:stripe_key]"));
    assert!(!r.segments[0].text.contains("sk_live"));
    for name in [".env.local", ".env.production"] {
        assert_eq!(
            read(&t, params(name, &[])).unwrap().status,
            ReadStatus::Withheld
        );
    }
}
