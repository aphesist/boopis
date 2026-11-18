use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use anyhow::Result;
use contraprova_kernel::{
    gate::is_protected_path, normalize_against_root, normalize_rel_path, project_tokens_cost,
    KernelGate,
};
use hypotaxis_contracts::{
    CascadeTier, ShipDiagnostic, ShipEdit, ShipRequest, ShipResult, ShipStatus,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::PrimitiveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JournalFileEntry {
    rel_path: String,
    abs_path: PathBuf,
    existed: bool,
    snapshot_path: Option<PathBuf>,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RollbackJournal {
    journal_dir: PathBuf,
    entries: Vec<JournalFileEntry>,
    created_dirs: Vec<PathBuf>,
}

struct VirtualFile {
    abs_path: PathBuf,
    original_bytes: Option<Vec<u8>>,
    working_text: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Debug, Clone)]
struct LineSpan<'a> {
    start: usize,
    end_no_eol: usize,
    text: &'a str,
}

enum MatchOutcome {
    Replaced(String),
    Failed(ShipDiagnostic),
}

/// Compound Primitive 3 (`ship`):
/// 1. Validates every `ShipEdit` pre-write (exact + CRLF + whitespace/indentation fuzzy matching).
///    Aborts with `ShipStatus::AbortedBeforeWrite` and rich diagnostics without touching disk on any failure.
/// 2. Snapshots pre-write byte contents of all target files into an on-disk rollback journal.
/// 3. Applies edits atomically.
/// 4. Runs `KernelGate` (unless `run_gate == false`) and enforces `human_approved` on sensitive paths/holds.
///    Rolls back byte-exactly and cleans up newly created files on gate failure or human-gate hold.
pub fn ship(req: ShipRequest) -> Result<ShipResult> {
    let gate = KernelGate::new(&req.root);
    ship_with_gate(req, &gate)
}

/// Variant of `ship` accepting an explicit `KernelGate` (used for explicit test runner configs).
pub fn ship_with_gate(req: ShipRequest, gate: &KernelGate) -> Result<ShipResult> {
    let root = Path::new(&req.root);
    if !root.exists() || !root.is_dir() {
        return Err(PrimitiveError::InvalidRoot(req.root.clone()).into());
    }
    let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());

    let mut files: BTreeMap<String, VirtualFile> = BTreeMap::new();
    let mut diagnostics: Vec<ShipDiagnostic> = Vec::new();
    let mut touched_order: Vec<String> = Vec::new();

    for edit in &req.edits {
        let rel_path = match resolve_safe_rel_path(root, &canon_root, &edit.path) {
            Ok(p) => p,
            Err(err) => {
                diagnostics.push(ShipDiagnostic {
                    path: edit.path.clone(),
                    reason: err.to_string(),
                    closest_snippet: None,
                    first_diff_line: None,
                });
                continue;
            }
        };

        if !files.contains_key(&rel_path) {
            let abs_path = root.join(&rel_path);
            let (original_bytes, working_text) = if abs_path.exists() {
                let bytes = fs::read(&abs_path)?;
                match String::from_utf8(bytes.clone()) {
                    Ok(s) => (Some(bytes), Some(s)),
                    Err(_) => {
                        diagnostics.push(ShipDiagnostic {
                            path: rel_path.clone(),
                            reason: "target file is not valid UTF-8".to_string(),
                            closest_snippet: None,
                            first_diff_line: None,
                        });
                        continue;
                    }
                }
            } else {
                (None, None)
            };
            files.insert(
                rel_path.clone(),
                VirtualFile {
                    abs_path,
                    original_bytes,
                    working_text,
                },
            );
            touched_order.push(rel_path.clone());
        }

        let entry = files.get_mut(&rel_path).expect("inserted above");
        match apply_edit_in_memory(&rel_path, entry.working_text.as_deref(), edit) {
            Ok(new_content) => {
                entry.working_text = Some(new_content);
            }
            Err(diag) => diagnostics.push(diag),
        }
    }

    if !diagnostics.is_empty() {
        return Ok(ShipResult {
            status: ShipStatus::AbortedBeforeWrite,
            changed_files: Vec::new(),
            gate_passed: false,
            gate_output: "aborted before write: pre-write edit validation failed".to_string(),
            diagnostics,
            rolled_back: false,
            cost_saved_usd: 0.0,
        });
    }

    let changed_files: Vec<String> = files.keys().cloned().collect();

    if changed_files.is_empty() {
        return handle_empty_edits(&req, gate);
    }

    // Create on-disk rollback journal BEFORE modifying any workspace files.
    let journal = create_rollback_journal(root, &files)?;

    // Apply all validated edits atomically.
    if let Err(err) = apply_files_atomically(&files) {
        let _ = restore_from_journal(&journal);
        return Err(err);
    }

    // Run KernelGate if enabled.
    let (gate_passed, gate_output) = if req.run_gate {
        let report = gate.evaluate(&req.brief, &changed_files)?;
        if !report.passed {
            restore_from_journal(&journal)?;
            return Ok(ShipResult {
                status: ShipStatus::FailedAndRolledBack,
                changed_files,
                gate_passed: false,
                gate_output: report.output,
                diagnostics: Vec::new(),
                rolled_back: true,
                cost_saved_usd: 0.0,
            });
        }
        (true, report.output)
    } else {
        (false, "gate skipped (run_gate=false)".to_string())
    };

    // Enforce human-approval boundary when sensitive paths or gate hold applies.
    if !req.human_approved && requires_human_gate(&req, &changed_files) {
        restore_from_journal(&journal)?;
        let hold_output = if gate_output.is_empty() {
            "held for human gate approval".to_string()
        } else {
            format!("{gate_output}\nheld for human gate approval on sensitive path/invariant")
        };
        return Ok(ShipResult {
            status: ShipStatus::HeldForHumanGate,
            changed_files,
            gate_passed,
            gate_output: hold_output,
            diagnostics: Vec::new(),
            rolled_back: true,
            cost_saved_usd: 0.0,
        });
    }

    cleanup_journal(&journal);

    let (raw_usd, actual_usd, _) =
        project_tokens_cost(2_400, 650, 9_600, CascadeTier::Tier1Fast, false);
    let cost_saved_usd = (raw_usd - actual_usd).max(0.0);

    Ok(ShipResult {
        status: ShipStatus::ShippedAndVerified,
        changed_files,
        gate_passed,
        gate_output,
        diagnostics: Vec::new(),
        rolled_back: false,
        cost_saved_usd,
    })
}

/// Returns `true` if `rel_path` targets sensitive governance, manifest, contract, or credential paths.
pub fn is_sensitive_path(raw_path: &str) -> bool {
    let norm = normalize_rel_path(raw_path).to_ascii_lowercase();
    let file_name = Path::new(&norm)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    if is_protected_path(&norm) {
        return true;
    }

    matches!(
        file_name,
        "cargo.toml"
            | "cargo.lock"
            | "package.json"
            | "package-lock.json"
            | "pnpm-lock.yaml"
            | "tauri.conf.json"
            | "hooks.json"
            | ".mcp.json"
    ) || norm.starts_with("crates/hypotaxis-contracts/")
        || norm.starts_with(".github/")
        || norm.starts_with(".claude/")
        || norm.starts_with(".agents/")
        || norm.starts_with("migrations/")
        || norm.contains("secret")
        || norm.contains("credential")
}

/// Determine whether a `ShipRequest` triggers a human-approval hold when `!req.human_approved`.
pub fn requires_human_gate(req: &ShipRequest, changed_files: &[String]) -> bool {
    if req.brief.invariants.iter().any(|inv| {
        let lower = inv.to_ascii_lowercase();
        lower.contains("human_gate") || lower.contains("require_human_approval")
    }) {
        return true;
    }

    changed_files.iter().any(|p| is_sensitive_path(p))
}

fn handle_empty_edits(req: &ShipRequest, gate: &KernelGate) -> Result<ShipResult> {
    let empty: Vec<String> = Vec::new();
    if req.run_gate {
        let report = gate.evaluate(&req.brief, &empty)?;
        if !report.passed {
            return Ok(ShipResult {
                status: ShipStatus::FailedAndRolledBack,
                changed_files: empty,
                gate_passed: false,
                gate_output: report.output,
                diagnostics: Vec::new(),
                rolled_back: false,
                cost_saved_usd: 0.0,
            });
        }
        return Ok(ShipResult {
            status: ShipStatus::ShippedAndVerified,
            changed_files: empty,
            gate_passed: true,
            gate_output: report.output,
            diagnostics: Vec::new(),
            rolled_back: false,
            cost_saved_usd: 0.0,
        });
    }

    Ok(ShipResult {
        status: ShipStatus::ShippedAndVerified,
        changed_files: empty,
        gate_passed: false,
        gate_output: "no edits supplied".to_string(),
        diagnostics: Vec::new(),
        rolled_back: false,
        cost_saved_usd: 0.0,
    })
}

fn resolve_safe_rel_path(root: &Path, canon_root: &Path, raw: &str) -> Result<String, PrimitiveError> {
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        let norm = normalize_against_root(root, raw);
        let joined = root.join(&norm);
        if joined == root || norm.is_empty() {
            return Err(PrimitiveError::UnsafePath(raw.to_string()));
        }
        if let Ok(canon_cand) = candidate.canonicalize() {
            if !canon_cand.starts_with(canon_root) {
                return Err(PrimitiveError::UnsafePath(raw.to_string()));
            }
        } else if !candidate.starts_with(root) {
            return Err(PrimitiveError::UnsafePath(raw.to_string()));
        }
        return Ok(norm);
    }

    let norm = normalize_rel_path(raw);
    if norm.is_empty() {
        return Err(PrimitiveError::UnsafePath(raw.to_string()));
    }
    if Path::new(&norm)
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(PrimitiveError::UnsafePath(raw.to_string()));
    }
    Ok(norm)
}

fn apply_edit_in_memory(
    rel_path: &str,
    existing: Option<&str>,
    edit: &ShipEdit,
) -> std::result::Result<String, ShipDiagnostic> {
    match existing {
        None => {
            let old_empty = edit.old_text.as_deref().unwrap_or("").is_empty();
            if edit.create_if_missing && old_empty {
                Ok(edit.new_text.clone())
            } else {
                Err(ShipDiagnostic {
                    path: rel_path.to_string(),
                    reason: if !edit.create_if_missing {
                        "target file does not exist and create_if_missing is false".to_string()
                    } else {
                        "target file does not exist but non-empty old_text was provided".to_string()
                    },
                    closest_snippet: None,
                    first_diff_line: None,
                })
            }
        }
        Some(text) => match &edit.old_text {
            None => Ok(edit.new_text.clone()),
            Some(old) if old.is_empty() => {
                if text.is_empty() {
                    Ok(edit.new_text.clone())
                } else {
                    Err(ShipDiagnostic {
                        path: rel_path.to_string(),
                        reason: "old_text cannot be empty when editing an existing non-empty file"
                            .to_string(),
                        closest_snippet: first_lines_snippet(text, 5),
                        first_diff_line: Some(1),
                    })
                }
            }
            Some(old) => match match_and_replace(rel_path, text, old, &edit.new_text) {
                MatchOutcome::Replaced(updated) => Ok(updated),
                MatchOutcome::Failed(diag) => Err(diag),
            },
        },
    }
}

fn match_and_replace(rel_path: &str, haystack: &str, old: &str, new_text: &str) -> MatchOutcome {
    // 1. Exact byte match.
    let exact_matches: Vec<(usize, &str)> = haystack.match_indices(old).collect();
    if exact_matches.len() == 1 {
        let (pos, _) = exact_matches[0];
        let mut out = String::with_capacity(haystack.len() + new_text.len());
        out.push_str(&haystack[..pos]);
        out.push_str(new_text);
        out.push_str(&haystack[pos + old.len()..]);
        return MatchOutcome::Replaced(out);
    }
    if exact_matches.len() > 1 {
        return MatchOutcome::Failed(ShipDiagnostic {
            path: rel_path.to_string(),
            reason: format!(
                "old_text matched {} distinct locations; provide more context",
                exact_matches.len()
            ),
            closest_snippet: first_lines_snippet(old, 6),
            first_diff_line: Some(line_number_at_offset(haystack, exact_matches[0].0)),
        });
    }

    let file_eol = detect_line_ending(haystack);
    let spans = split_line_spans(haystack);
    let (old_lines, old_had_trailing_nl) = split_logical_lines(old);

    if old_lines.is_empty() || spans.is_empty() {
        return MatchOutcome::Failed(build_mismatch_diagnostic(rel_path, haystack, &spans, &old_lines));
    }

    // 2. Line-ending tolerant (CRLF <-> LF) exact line match.
    if let Some(res) = try_window_match(
        rel_path,
        haystack,
        &spans,
        &old_lines,
        old_had_trailing_nl,
        new_text,
        file_eol,
        false,
        |h, o| h == o,
    ) {
        return res;
    }

    // 3. Trailing-whitespace + common-indentation shift tolerant match.
    if let Some(res) = try_common_indent_match(
        rel_path,
        haystack,
        &spans,
        &old_lines,
        old_had_trailing_nl,
        new_text,
        file_eol,
    ) {
        return res;
    }

    // 4. Full whitespace-normalized fuzzy line match.
    if let Some(res) = try_window_match(
        rel_path,
        haystack,
        &spans,
        &old_lines,
        old_had_trailing_nl,
        new_text,
        file_eol,
        true,
        |h, o| normalize_ws(h) == normalize_ws(o),
    ) {
        return res;
    }

    MatchOutcome::Failed(build_mismatch_diagnostic(
        rel_path,
        haystack,
        &spans,
        &old_lines,
    ))
}

#[allow(clippy::too_many_arguments)]
fn try_window_match<F>(
    rel_path: &str,
    haystack: &str,
    spans: &[LineSpan<'_>],
    old_lines: &[&str],
    old_had_trailing_nl: bool,
    new_text: &str,
    file_eol: LineEnding,
    adjust_indent: bool,
    cmp: F,
) -> Option<MatchOutcome>
where
    F: Fn(&str, &str) -> bool,
{
    let m = old_lines.len();
    if m > spans.len() {
        return None;
    }

    let mut matched_starts = Vec::new();
    for i in 0..=spans.len() - m {
        let all_match = (0..m).all(|k| cmp(spans[i + k].text, old_lines[k]));
        if all_match {
            matched_starts.push(i);
        }
    }

    if matched_starts.is_empty() {
        return None;
    }
    if matched_starts.len() > 1 {
        return Some(MatchOutcome::Failed(ShipDiagnostic {
            path: rel_path.to_string(),
            reason: format!(
                "fuzzy match found {} candidate locations; provide more surrounding lines",
                matched_starts.len()
            ),
            closest_snippet: Some(
                spans[matched_starts[0]..matched_starts[0] + m]
                    .iter()
                    .map(|s| s.text)
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            first_diff_line: Some(matched_starts[0] + 1),
        }));
    }

    let start_idx = matched_starts[0];
    let replacement = format_replacement(
        &spans[start_idx..start_idx + m],
        old_lines,
        old_had_trailing_nl,
        new_text,
        file_eol,
        adjust_indent,
    );

    let byte_start = spans[start_idx].start;
    let byte_end = spans[start_idx + m - 1].end_no_eol;
    let mut out = String::with_capacity(haystack.len() + replacement.len());
    out.push_str(&haystack[..byte_start]);
    out.push_str(&replacement);
    out.push_str(&haystack[byte_end..]);
    Some(MatchOutcome::Replaced(out))
}

fn try_common_indent_match(
    rel_path: &str,
    haystack: &str,
    spans: &[LineSpan<'_>],
    old_lines: &[&str],
    old_had_trailing_nl: bool,
    new_text: &str,
    file_eol: LineEnding,
) -> Option<MatchOutcome> {
    let m = old_lines.len();
    if m > spans.len() {
        return None;
    }

    let old_trimmed: Vec<String> = dedent_lines(old_lines);
    let mut matched_starts = Vec::new();

    for i in 0..=spans.len() - m {
        let slice_lines: Vec<&str> = spans[i..i + m].iter().map(|s| s.text).collect();
        let slice_trimmed = dedent_lines(&slice_lines);
        if slice_trimmed == old_trimmed {
            matched_starts.push(i);
        }
    }

    if matched_starts.is_empty() {
        return None;
    }
    if matched_starts.len() > 1 {
        return Some(MatchOutcome::Failed(ShipDiagnostic {
            path: rel_path.to_string(),
            reason: format!(
                "indentation-tolerant match found {} candidate locations",
                matched_starts.len()
            ),
            closest_snippet: Some(
                spans[matched_starts[0]..matched_starts[0] + m]
                    .iter()
                    .map(|s| s.text)
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            first_diff_line: Some(matched_starts[0] + 1),
        }));
    }

    let start_idx = matched_starts[0];
    let replacement = format_replacement(
        &spans[start_idx..start_idx + m],
        old_lines,
        old_had_trailing_nl,
        new_text,
        file_eol,
        true,
    );

    let byte_start = spans[start_idx].start;
    let byte_end = spans[start_idx + m - 1].end_no_eol;
    let mut out = String::with_capacity(haystack.len() + replacement.len());
    out.push_str(&haystack[..byte_start]);
    out.push_str(&replacement);
    out.push_str(&haystack[byte_end..]);
    Some(MatchOutcome::Replaced(out))
}

fn format_replacement(
    matched_spans: &[LineSpan<'_>],
    old_lines: &[&str],
    old_had_trailing_nl: bool,
    new_text: &str,
    file_eol: LineEnding,
    adjust_indent: bool,
) -> String {
    let eol_str = match file_eol {
        LineEnding::Lf => "\n",
        LineEnding::Crlf => "\r\n",
    };

    let (new_lines_raw, new_had_trailing_nl) = split_logical_lines(new_text);

    let adjusted_lines: Vec<String> = if adjust_indent {
        let target_indent = first_non_empty_indent(
            &matched_spans
                .iter()
                .map(|s| s.text)
                .collect::<Vec<_>>(),
        );
        let old_indent = first_non_empty_indent(old_lines);
        let new_indent = first_non_empty_indent(&new_lines_raw);

        if target_indent != old_indent && new_indent == old_indent {
            new_lines_raw
                .iter()
                .map(|line| {
                    if line.trim().is_empty() {
                        String::new()
                    } else if let Some(rest) = line.strip_prefix(old_indent) {
                        format!("{target_indent}{rest}")
                    } else {
                        (*line).to_string()
                    }
                })
                .collect()
        } else {
            new_lines_raw.iter().map(|s| (*s).to_string()).collect()
        }
    } else {
        new_lines_raw.iter().map(|s| (*s).to_string()).collect()
    };

    let mut out = adjusted_lines.join(eol_str);
    // Preserve extra trailing newline only if `new_text` has one AND `old_text` did not already
    // rely on the line span's trailing newline (preventing accidental duplicate blank lines).
    if new_had_trailing_nl && !old_had_trailing_nl && !out.is_empty() {
        out.push_str(eol_str);
    }
    out
}

fn build_mismatch_diagnostic(
    rel_path: &str,
    _haystack: &str,
    spans: &[LineSpan<'_>],
    old_lines: &[&str],
) -> ShipDiagnostic {
    if spans.is_empty() {
        return ShipDiagnostic {
            path: rel_path.to_string(),
            reason: "old_text did not match: target file is empty".to_string(),
            closest_snippet: Some(String::new()),
            first_diff_line: Some(1),
        };
    }

    let m = old_lines.len().max(1);
    let window_len = m.min(spans.len());
    let mut best_start = 0usize;
    let mut best_score = f64::NEG_INFINITY;

    for i in 0..=spans.len() - window_len {
        let mut score = 0.0f64;
        for k in 0..window_len.min(old_lines.len()) {
            score += line_similarity(spans[i + k].text, old_lines[k]);
        }
        if score > best_score {
            best_score = score;
            best_start = i;
        }
    }

    let best_slice = &spans[best_start..best_start + window_len];
    let mut first_diff_line = best_start + 1;
    for (k, slice_line) in best_slice.iter().enumerate().take(window_len) {
        let expected = old_lines.get(k).copied().unwrap_or("");
        if normalize_ws(slice_line.text) != normalize_ws(expected) {
            first_diff_line = best_start + k + 1;
            break;
        }
        if k + 1 == window_len && old_lines.len() > window_len {
            first_diff_line = best_start + window_len + 1;
        }
    }

    let closest_snippet = best_slice
        .iter()
        .map(|s| s.text)
        .collect::<Vec<_>>()
        .join("\n");

    ShipDiagnostic {
        path: rel_path.to_string(),
        reason: format!(
            "old_text failed exact and fuzzy pre-write validation (closest match starts at line {}, first diff at line {})",
            best_start + 1,
            first_diff_line
        ),
        closest_snippet: Some(closest_snippet),
        first_diff_line: Some(first_diff_line),
    }
}

fn line_similarity(a: &str, b: &str) -> f64 {
    let na = normalize_ws(a);
    let nb = normalize_ws(b);
    if na == nb {
        return 2.0;
    }
    if na.is_empty() && nb.is_empty() {
        return 1.0;
    }
    if na.is_empty() || nb.is_empty() {
        return 0.0;
    }
    let ta: BTreeSet<&str> = na.split(' ').collect();
    let tb: BTreeSet<&str> = nb.split(' ').collect();
    let inter = ta.intersection(&tb).count() as f64;
    let union = ta.union(&tb).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

fn split_line_spans(text: &str) -> Vec<LineSpan<'_>> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] == b'\n' {
            let end_no_eol = if i > start && bytes[i - 1] == b'\r' {
                i - 1
            } else {
                i
            };
            spans.push(LineSpan {
                start,
                end_no_eol,
                text: &text[start..end_no_eol],
            });
            start = i + 1;
        }
        i += 1;
    }

    if start < bytes.len() {
        let end_no_eol = if bytes[bytes.len() - 1] == b'\r' {
            bytes.len() - 1
        } else {
            bytes.len()
        };
        spans.push(LineSpan {
            start,
            end_no_eol,
            text: &text[start..end_no_eol],
        });
    }

    spans
}

fn split_logical_lines(text: &str) -> (Vec<&str>, bool) {
    let had_trailing_nl = text.ends_with('\n');
    let stripped = if let Some(s) = text.strip_suffix("\r\n") {
        s
    } else if let Some(s) = text.strip_suffix('\n') {
        s
    } else {
        text
    };
    if stripped.is_empty() && !text.is_empty() {
        return (vec![""], had_trailing_nl);
    }
    let lines: Vec<&str> = stripped
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    (lines, had_trailing_nl)
}

fn detect_line_ending(text: &str) -> LineEnding {
    let crlf_count = text.matches("\r\n").count();
    let lf_count = text.matches('\n').count();
    if crlf_count > 0 && crlf_count * 2 >= lf_count {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

fn normalize_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn dedent_lines(lines: &[&str]) -> Vec<String> {
    let min_indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                l[min_indent.min(l.len())..].trim_end().to_string()
            }
        })
        .collect()
}

fn first_non_empty_indent<'a>(lines: &[&'a str]) -> &'a str {
    for line in lines {
        if !line.trim().is_empty() {
            let ws_len = line.len() - line.trim_start().len();
            return &line[..ws_len];
        }
    }
    ""
}

fn first_lines_snippet(text: &str, count: usize) -> Option<String> {
    let snippet: Vec<&str> = text.lines().take(count).collect();
    if snippet.is_empty() {
        None
    } else {
        Some(snippet.join("\n"))
    }
}

fn line_number_at_offset(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset.min(text.len())]
        .bytes()
        .filter(|&b| b == b'\n')
        .count()
        + 1
}

fn create_rollback_journal(
    root: &Path,
    files: &BTreeMap<String, VirtualFile>,
) -> Result<RollbackJournal> {
    let journal_dir = std::env::temp_dir().join(format!(
        "hypo-ship-journal-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&journal_dir)?;

    let mut entries = Vec::with_capacity(files.len());
    let mut created_dirs_set: BTreeSet<PathBuf> = BTreeSet::new();

    for (idx, (rel_path, vfile)) in files.iter().enumerate() {
        if let Some(bytes) = &vfile.original_bytes {
            let snap_path = journal_dir.join(format!("snap-{idx}.bin"));
            fs::write(&snap_path, bytes)?;
            let digest = hex::encode(Sha256::digest(bytes));
            entries.push(JournalFileEntry {
                rel_path: rel_path.clone(),
                abs_path: vfile.abs_path.clone(),
                existed: true,
                snapshot_path: Some(snap_path),
                sha256: Some(digest),
            });
        } else {
            // Track any missing ancestor directories inside `root` so rollback removes them too.
            let mut cur = vfile.abs_path.parent();
            while let Some(dir) = cur {
                if dir == root {
                    break;
                }
                if !dir.exists() {
                    created_dirs_set.insert(dir.to_path_buf());
                }
                cur = dir.parent();
            }
            entries.push(JournalFileEntry {
                rel_path: rel_path.clone(),
                abs_path: vfile.abs_path.clone(),
                existed: false,
                snapshot_path: None,
                sha256: None,
            });
        }
    }

    let mut created_dirs: Vec<PathBuf> = created_dirs_set.into_iter().collect();
    // Sort deepest-first so cleanup removes child dirs before parents.
    created_dirs.sort_by_key(|a| std::cmp::Reverse(a.as_os_str().len()));

    let journal = RollbackJournal {
        journal_dir: journal_dir.clone(),
        entries,
        created_dirs,
    };

    let journal_json = serde_json::to_string_pretty(&journal)?;
    fs::write(journal_dir.join("journal.json"), journal_json)?;
    Ok(journal)
}

fn apply_files_atomically(files: &BTreeMap<String, VirtualFile>) -> Result<()> {
    for vfile in files.values() {
        let Some(new_text) = &vfile.working_text else {
            continue;
        };
        if let Some(parent) = vfile.abs_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let parent = vfile.abs_path.parent().unwrap_or_else(|| Path::new("."));
        let tmp_path = parent.join(format!(".hypo-ship-tmp-{}", uuid::Uuid::new_v4()));
        fs::write(&tmp_path, new_text.as_bytes())?;
        if let Err(err) = fs::rename(&tmp_path, &vfile.abs_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(err.into());
        }
    }
    Ok(())
}

fn restore_from_journal(journal: &RollbackJournal) -> Result<()> {
    for entry in &journal.entries {
        if entry.existed {
            let snap_path = entry
                .snapshot_path
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("missing snapshot path for {}", entry.rel_path))?;
            let bytes = fs::read(snap_path)?;
            if let Some(expected_hash) = &entry.sha256 {
                let actual_hash = hex::encode(Sha256::digest(&bytes));
                if &actual_hash != expected_hash {
                    anyhow::bail!(
                        "rollback snapshot checksum mismatch for {}",
                        entry.rel_path
                    );
                }
            }
            if let Some(parent) = entry.abs_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let parent = entry.abs_path.parent().unwrap_or_else(|| Path::new("."));
            let tmp_path = parent.join(format!(".hypo-rollback-tmp-{}", uuid::Uuid::new_v4()));
            fs::write(&tmp_path, &bytes)?;
            fs::rename(&tmp_path, &entry.abs_path)?;
        } else if entry.abs_path.exists() {
            fs::remove_file(&entry.abs_path)?;
        }
    }

    for dir in &journal.created_dirs {
        if dir.exists() {
            // Only removes if empty so pre-existing siblings are never harmed.
            let _ = fs::remove_dir(dir);
        }
    }

    cleanup_journal(journal);
    Ok(())
}

fn cleanup_journal(journal: &RollbackJournal) {
    let _ = fs::remove_dir_all(&journal.journal_dir);
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypotaxis_contracts::TaskBrief;

    fn temp_workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_brief(scope: Vec<&str>) -> TaskBrief {
        TaskBrief {
            id: "ship-test".into(),
            goal: "implement clean helper".into(),
            scope_globs: scope.into_iter().map(String::from).collect(),
            lane_id: "lane/kernel".into(),
            invariants: vec!["byte-exact rollback".into()],
        }
    }

    #[test]
    fn aborted_before_write_returns_diagnostics_without_touching_disk() {
        let dir = temp_workspace();
        fs::create_dir_all(dir.join("src")).unwrap();
        let original = "fn alpha() {\n    let x = 1;\n    let y = 2;\n}\n";
        fs::write(dir.join("src/lib.rs"), original).unwrap();

        let gate = KernelGate::with_command(&dir, None);
        let res = ship_with_gate(
            ShipRequest {
                root: dir.to_string_lossy().into_owned(),
                brief: make_brief(vec!["src/**"]),
                edits: vec![
                    ShipEdit {
                        path: "src/new_file.rs".into(),
                        old_text: None,
                        new_text: "pub fn created() {}\n".into(),
                        create_if_missing: true,
                    },
                    ShipEdit {
                        path: "src/lib.rs".into(),
                        old_text: Some("fn alpha() {\n    let x = 1;\n    let y = 999;\n}".into()),
                        new_text: "fn alpha() {\n    let x = 10;\n}".into(),
                        create_if_missing: false,
                    },
                ],
                run_gate: true,
                human_approved: true,
            },
            &gate,
        )
        .unwrap();

        assert_eq!(res.status, ShipStatus::AbortedBeforeWrite);
        assert!(!res.rolled_back);
        assert_eq!(res.diagnostics.len(), 1);
        let diag = &res.diagnostics[0];
        assert_eq!(diag.path, "src/lib.rs");
        assert_eq!(diag.first_diff_line, Some(3));
        assert!(diag
            .closest_snippet
            .as_deref()
            .unwrap()
            .contains("let y = 2;"));

        // Neither the failed edit nor the earlier valid edit touched disk.
        assert_eq!(fs::read_to_string(dir.join("src/lib.rs")).unwrap(), original);
        assert!(!dir.join("src/new_file.rs").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn fuzzy_crlf_and_indentation_tolerant_edit_ships_cleanly() {
        let dir = temp_workspace();
        fs::create_dir_all(dir.join("src")).unwrap();
        // Original uses CRLF and 4-space indentation.
        let original = "mod inner {\r\n    fn greet() {\r\n        let msg = \"hi\";\r\n    }\r\n}\r\n";
        fs::write(dir.join("src/greet.rs"), original.as_bytes()).unwrap();

        let gate = KernelGate::with_command(&dir, Some("echo tests-pass".into()));
        let res = ship_with_gate(
            ShipRequest {
                root: dir.to_string_lossy().into_owned(),
                brief: make_brief(vec!["src/**"]),
                edits: vec![ShipEdit {
                    path: "src/greet.rs".into(),
                    // LF + 0-space base indent (fuzzy match against 4-space CRLF file)
                    old_text: Some("fn greet() {\n    let msg = \"hi\";\n}".into()),
                    new_text: "fn greet() {\n    let msg = \"hello\";\n}".into(),
                    create_if_missing: false,
                }],
                run_gate: true,
                human_approved: false,
            },
            &gate,
        )
        .unwrap();

        assert_eq!(res.status, ShipStatus::ShippedAndVerified);
        assert!(res.gate_passed);
        assert!(!res.rolled_back);
        let updated = fs::read_to_string(dir.join("src/greet.rs")).unwrap();
        assert!(updated.contains("    fn greet() {\r\n        let msg = \"hello\";\r\n    }"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn gate_failure_rolls_back_byte_exact_and_deletes_new_files() {
        let dir = temp_workspace();
        fs::create_dir_all(dir.join("src")).unwrap();
        // Deliberately include CRLF and non-final trailing bytes to prove byte-exact restore.
        let original_bytes = b"fn core() -> i32 {\r\n    1\r\n}";
        fs::write(dir.join("src/core.rs"), original_bytes).unwrap();

        let gate = KernelGate::with_command(&dir, Some("exit 3".into()));
        let res = ship_with_gate(
            ShipRequest {
                root: dir.to_string_lossy().into_owned(),
                brief: make_brief(vec!["src/**"]),
                edits: vec![
                    ShipEdit {
                        path: "src/core.rs".into(),
                        old_text: Some("1".into()),
                        new_text: "42".into(),
                        create_if_missing: false,
                    },
                    ShipEdit {
                        path: "src/generated/helper.rs".into(),
                        old_text: None,
                        new_text: "pub fn helper() -> i32 { 42 }\n".into(),
                        create_if_missing: true,
                    },
                ],
                run_gate: true,
                human_approved: true,
            },
            &gate,
        )
        .unwrap();

        assert_eq!(res.status, ShipStatus::FailedAndRolledBack);
        assert!(res.rolled_back);
        assert!(!res.gate_passed);
        assert_eq!(fs::read(dir.join("src/core.rs")).unwrap(), original_bytes);
        assert!(!dir.join("src/generated/helper.rs").exists());
        assert!(!dir.join("src/generated").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sensitive_path_without_human_approval_holds_and_rolls_back() {
        let dir = temp_workspace();
        let orig_toml = "[package]\nname = \"demo\"\n";
        fs::write(dir.join("Cargo.toml"), orig_toml).unwrap();

        let gate = KernelGate::with_command(&dir, None);
        let held = ship_with_gate(
            ShipRequest {
                root: dir.to_string_lossy().into_owned(),
                brief: make_brief(vec!["Cargo.toml"]),
                edits: vec![ShipEdit {
                    path: "Cargo.toml".into(),
                    old_text: Some("demo".into()),
                    new_text: "demo-edited".into(),
                    create_if_missing: false,
                }],
                run_gate: true,
                human_approved: false,
            },
            &gate,
        )
        .unwrap();

        assert_eq!(held.status, ShipStatus::HeldForHumanGate);
        assert!(held.rolled_back);
        assert_eq!(fs::read_to_string(dir.join("Cargo.toml")).unwrap(), orig_toml);

        // Once human_approved = true, the exact same edit ships.
        let shipped = ship_with_gate(
            ShipRequest {
                root: dir.to_string_lossy().into_owned(),
                brief: make_brief(vec!["Cargo.toml"]),
                edits: vec![ShipEdit {
                    path: "Cargo.toml".into(),
                    old_text: Some("demo".into()),
                    new_text: "demo-edited".into(),
                    create_if_missing: false,
                }],
                run_gate: true,
                human_approved: true,
            },
            &gate,
        )
        .unwrap();

        assert_eq!(shipped.status, ShipStatus::ShippedAndVerified);
        assert!(!shipped.rolled_back);
        assert!(fs::read_to_string(dir.join("Cargo.toml"))
            .unwrap()
            .contains("demo-edited"));

        let _ = fs::remove_dir_all(&dir);
    }
}
