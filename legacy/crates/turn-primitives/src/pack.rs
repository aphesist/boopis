use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use anyhow::Result;
use contraprova_kernel::normalize_rel_path;
use hypotaxis_contracts::{PackMatch, PackOutline, PackRequest, PackResult};
use ignore::WalkBuilder;
use regex::Regex;

use crate::PrimitiveError;

const MAX_FILE_READ_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_PREVIEW_LINES: usize = 20;

/// Compound Primitive 1 (`pack`):
/// Walks workspace (or reads requested files), redacts `.env*` / private keys / secrets,
/// extracts regex matches up to `max_bytes`, emits symbol outlines for `.rs/.ts/.tsx/.py`,
/// and gathers `git status --short`.
pub fn pack(req: PackRequest) -> Result<PackResult> {
    let root = Path::new(&req.root);
    if !root.exists() || !root.is_dir() {
        return Err(PrimitiveError::InvalidRoot(req.root.clone()).into());
    }
    let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());

    let query_re = match &req.query {
        Some(q) if !q.is_empty() => Some(Regex::new(q).map_err(PrimitiveError::InvalidQuery)?),
        _ => None,
    };

    let files = collect_target_files(root, &canon_root, &req.files)?;

    let mut matches = Vec::new();
    let mut outlines = Vec::new();
    let mut redacted_secrets = 0usize;
    let mut truncated = false;
    let mut used_bytes = 0usize;

    let explicit_files_mode = !req.files.is_empty();

    for (rel_path, abs_path) in files {
        if truncated {
            break;
        }
        let Ok(meta) = fs::metadata(&abs_path) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_FILE_READ_BYTES {
            continue;
        }

        let Ok(raw_bytes) = fs::read(&abs_path) else {
            continue;
        };
        if raw_bytes.iter().take(8192).any(|&b| b == 0) {
            // Skip binary files.
            continue;
        }

        let raw_text = String::from_utf8_lossy(&raw_bytes);
        let (safe_text, file_redactions) = redact_secrets_for_path(&rel_path, &raw_text);
        redacted_secrets = redacted_secrets.saturating_add(file_redactions);

        if let Some(re) = &query_re {
            for (idx, line) in safe_text.lines().enumerate() {
                if re.is_match(line) {
                    let snippet = clip_snippet(line);
                    let cost = rel_path.len() + snippet.len() + 16;
                    if used_bytes.saturating_add(cost) > req.max_bytes {
                        truncated = true;
                        break;
                    }
                    used_bytes += cost;
                    matches.push(PackMatch {
                        path: rel_path.clone(),
                        line: idx + 1,
                        snippet,
                    });
                }
            }
        } else if explicit_files_mode || !truncated {
            let line_limit = if explicit_files_mode {
                usize::MAX
            } else {
                DEFAULT_PREVIEW_LINES
            };
            for (idx, line) in safe_text.lines().take(line_limit).enumerate() {
                let snippet = clip_snippet(line);
                let cost = rel_path.len() + snippet.len() + 16;
                if used_bytes.saturating_add(cost) > req.max_bytes {
                    truncated = true;
                    break;
                }
                used_bytes += cost;
                matches.push(PackMatch {
                    path: rel_path.clone(),
                    line: idx + 1,
                    snippet,
                });
            }
        }

        if req.include_outlines && !truncated {
            let symbols = extract_symbol_outlines(&rel_path, &safe_text);
            if !symbols.is_empty() {
                let outline_cost =
                    rel_path.len() + symbols.iter().map(|s| s.len() + 4).sum::<usize>();
                if used_bytes.saturating_add(outline_cost) > req.max_bytes {
                    truncated = true;
                } else {
                    used_bytes += outline_cost;
                    outlines.push(PackOutline {
                        path: rel_path.clone(),
                        symbols,
                    });
                }
            }
        }
    }

    let git_status = collect_git_status(root);

    Ok(PackResult {
        matches,
        outlines,
        git_status,
        redacted_secrets,
        truncated,
    })
}

fn collect_target_files(
    root: &Path,
    canon_root: &Path,
    requested_files: &[String],
) -> Result<Vec<(String, PathBuf)>> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();

    if !requested_files.is_empty() {
        for raw in requested_files {
            let norm = normalize_rel_path(raw);
            if norm.is_empty() {
                continue;
            }
            let rel_path_obj = Path::new(&norm);
            if rel_path_obj.is_absolute()
                || rel_path_obj
                    .components()
                    .any(|c| matches!(c, Component::ParentDir))
            {
                return Err(PrimitiveError::UnsafePath(raw.clone()).into());
            }
            let abs = root.join(rel_path_obj);
            if abs.exists() && abs.is_file() {
                if let Ok(canon_abs) = abs.canonicalize() {
                    if !canon_abs.starts_with(canon_root) {
                        return Err(PrimitiveError::UnsafePath(raw.clone()).into());
                    }
                }
                if seen.insert(norm.clone()) {
                    out.push((norm, abs));
                }
            }
        }
        return Ok(out);
    }

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            name != ".git" && name != "node_modules" && name != "target"
        })
        .build();

    for entry in walker.flatten() {
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        let abs = entry.into_path();
        if let Ok(stripped) = abs.strip_prefix(root) {
            let norm = normalize_rel_path(&stripped.to_string_lossy());
            if !norm.is_empty() && seen.insert(norm.clone()) {
                out.push((norm, abs));
            }
        }
    }

    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn clip_snippet(line: &str) -> String {
    let trimmed = line.trim_end();
    const MAX_LINE_CHARS: usize = 512;
    if trimmed.chars().count() <= MAX_LINE_CHARS {
        trimmed.to_string()
    } else {
        let mut s: String = trimmed.chars().take(MAX_LINE_CHARS).collect();
        s.push_str("...");
        s
    }
}

/// Redact `.env*` entries, private key blocks, and high-signal secret/API token patterns.
pub fn redact_secrets_for_path(rel_path: &str, text: &str) -> (String, usize) {
    let file_name = Path::new(rel_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let is_env_file = file_name.starts_with(".env");

    let mut total_redactions = 0usize;
    let mut working = if is_env_file {
        let mut out_lines = Vec::new();
        for line in text.lines() {
            let trimmed = line.trim_start();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                out_lines.push(line.to_string());
                continue;
            }
            if let Some(eq_idx) = line.find('=') {
                let (key_part, val_part) = line.split_at(eq_idx + 1);
                if !val_part.trim().is_empty() {
                    total_redactions += 1;
                    out_lines.push(format!("{key_part}[REDACTED]"));
                } else {
                    out_lines.push(line.to_string());
                }
            } else {
                total_redactions += 1;
                out_lines.push("[REDACTED_ENV_ENTRY]".to_string());
            }
        }
        out_lines.join("\n")
    } else {
        text.to_string()
    };

    for (re, replacement) in secret_patterns() {
        let count = re.find_iter(&working).count();
        if count > 0 {
            total_redactions += count;
            working = re.replace_all(&working, *replacement).into_owned();
        }
    }

    (working, total_redactions)
}

fn secret_patterns() -> &'static [(Regex, &'static str)] {
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            (
                Regex::new(r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----").unwrap(),
                "[REDACTED_PRIVATE_KEY]",
            ),
            (
                Regex::new(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[^\r\n]*").unwrap(),
                "[REDACTED_PRIVATE_KEY]",
            ),
            (
                Regex::new(r"\bsk-ant-[A-Za-z0-9\-_]{10,}").unwrap(),
                "[REDACTED_ANTHROPIC_KEY]",
            ),
            (
                Regex::new(r"\bsk-(?:proj-)?[A-Za-z0-9\-_]{16,}").unwrap(),
                "[REDACTED_API_KEY]",
            ),
            (
                Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(),
                "[REDACTED_AWS_KEY]",
            ),
            (
                Regex::new(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b").unwrap(),
                "[REDACTED_GITHUB_TOKEN]",
            ),
            (
                Regex::new(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b").unwrap(),
                "[REDACTED_GITHUB_PAT]",
            ),
            (
                Regex::new(r"\bAIza[0-9A-Za-z\-_]{30,}\b").unwrap(),
                "[REDACTED_GOOGLE_KEY]",
            ),
            (
                Regex::new(r"\bxox[baprs]-[0-9A-Za-z\-]{10,}\b").unwrap(),
                "[REDACTED_SLACK_TOKEN]",
            ),
            (
                Regex::new(r"\bBearer\s+[A-Za-z0-9\-_\.=]{20,}").unwrap(),
                "Bearer [REDACTED_TOKEN]",
            ),
            (
                Regex::new(r"\beyJ[A-Za-z0-9\-_]{10,}\.eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b").unwrap(),
                "[REDACTED_JWT]",
            ),
            (
                Regex::new(r#"(?i)\b(api_key|apikey|secret_key|private_key|access_token|auth_token|client_secret|password|passwd)\b(\s*[:=]\s*)(["'])([^"'\r\n]{6,})(["'])"#).unwrap(),
                "$1$2$3[REDACTED]$5",
            ),
        ]
    })
}

/// Extract function/struct/class/interface symbol outlines for `.rs`, `.ts`, `.tsx`, `.py` files.
pub fn extract_symbol_outlines(rel_path: &str, text: &str) -> Vec<String> {
    let ext = Path::new(rel_path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    match ext.as_deref() {
        Some("rs") => extract_rust_symbols(text),
        Some("ts") | Some("tsx") => extract_ts_symbols(text),
        Some("py") => extract_python_symbols(text),
        _ => Vec::new(),
    }
}

fn extract_rust_symbols(text: &str) -> Vec<String> {
    static RS_RE: OnceLock<Regex> = OnceLock::new();
    let re = RS_RE.get_or_init(|| {
        Regex::new(
            r#"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const)\s+)*(?:extern\s+"[^"]+"\s+)?(fn|struct|enum|trait|impl|type|mod)\s+(?:<[^>]*>\s*)?([A-Za-z_][A-Za-z0-9_:<>]*)"#,
        )
        .unwrap()
    });

    re.captures_iter(text)
        .map(|cap| format!("{} {}", &cap[1], &cap[2]))
        .collect()
}

fn extract_ts_symbols(text: &str) -> Vec<String> {
    static TS_RE: OnceLock<Regex> = OnceLock::new();
    let re = TS_RE.get_or_init(|| {
        Regex::new(
            r"(?m)^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)",
        )
        .unwrap()
    });

    re.captures_iter(text)
        .map(|cap| format!("{} {}", &cap[1], &cap[2]))
        .collect()
}

fn extract_python_symbols(text: &str) -> Vec<String> {
    static PY_RE: OnceLock<Regex> = OnceLock::new();
    let re = PY_RE.get_or_init(|| {
        Regex::new(r"(?m)^\s*(?:async\s+)?(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)").unwrap()
    });

    re.captures_iter(text)
        .map(|cap| format!("{} {}", &cap[1], &cap[2]))
        .collect()
}

fn collect_git_status(root: &Path) -> Vec<String> {
    let Ok(output) = Command::new("git")
        .args(["status", "--short"])
        .current_dir(root)
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim_end().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pack_redacts_env_private_keys_and_extracts_outlines() {
        let dir = temp_workspace();
        fs::create_dir_all(dir.join("src")).unwrap();

        fs::write(
            dir.join(".env"),
            "ANTHROPIC_API_KEY=sk-ant-api03-verysecretvalue123456\nDB_PASS=super_secret_pw\n",
        )
        .unwrap();
        fs::write(
            dir.join("src/engine.rs"),
            r#"pub struct KernelEngine {
    pub active: bool,
}

pub async fn run_cycle() -> bool {
    let token = "sk-testsecretvalue9876543210abcdef";
    let key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsomething\n-----END RSA PRIVATE KEY-----";
    !token.is_empty() && !key.is_empty()
}
"#,
        )
        .unwrap();
        fs::write(
            dir.join("src/widget.tsx"),
            "export interface OrbProps { size: number }\nexport class OrbView {}\nexport async function renderOrb() {}\n",
        )
        .unwrap();
        fs::write(
            dir.join("src/worker.py"),
            "class SessionPool:\n    async def dispatch(self):\n        pass\n",
        )
        .unwrap();

        let res = pack(PackRequest {
            root: dir.to_string_lossy().into_owned(),
            query: Some("ANTHROPIC_API_KEY|run_cycle".into()),
            files: Vec::new(),
            include_outlines: true,
            max_bytes: 32 * 1024,
        })
        .unwrap();

        assert!(res.redacted_secrets >= 4, "got {}", res.redacted_secrets);
        assert!(res
            .matches
            .iter()
            .any(|m| m.path == ".env" && m.snippet == "ANTHROPIC_API_KEY=[REDACTED]"));
        assert!(!res
            .matches
            .iter()
            .any(|m| m.snippet.contains("verysecretvalue") || m.snippet.contains("MIIEowIBAAKCAQEAsomething")));

        let rs_outline = res.outlines.iter().find(|o| o.path == "src/engine.rs").unwrap();
        assert_eq!(rs_outline.symbols, vec!["struct KernelEngine", "fn run_cycle"]);

        let ts_outline = res.outlines.iter().find(|o| o.path == "src/widget.tsx").unwrap();
        assert_eq!(
            ts_outline.symbols,
            vec!["interface OrbProps", "class OrbView", "function renderOrb"]
        );

        let py_outline = res.outlines.iter().find(|o| o.path == "src/worker.py").unwrap();
        assert_eq!(py_outline.symbols, vec!["class SessionPool", "def dispatch"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pack_respects_max_bytes_and_captures_git_status() {
        let dir = temp_workspace();
        let _ = Command::new("git").arg("init").current_dir(&dir).output();
        fs::write(
            dir.join("notes.rs"),
            "fn one() {}\nfn two() {}\nfn three() {}\nfn four() {}\n",
        )
        .unwrap();

        let res = pack(PackRequest {
            root: dir.to_string_lossy().into_owned(),
            query: Some("fn ".into()),
            files: Vec::new(),
            include_outlines: false,
            max_bytes: 45,
        })
        .unwrap();

        assert!(res.truncated);
        assert!(res.matches.len() < 4);
        assert!(res.git_status.iter().any(|l| l.contains("notes.rs")));

        let _ = fs::remove_dir_all(&dir);
    }
}
