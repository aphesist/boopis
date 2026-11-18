//! Definition extraction with tree-sitter.
//!
//! One function, [`definitions`], turns source text into a list of
//! [`Definition`]s using only the language's query and its `wrappers` and
//! `leading` node lists. Outline and symbol are views over this list.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use streaming_iterator::StreamingIterator;
use tree_sitter::{Node, Parser, QueryCursor};

use crate::error::{Error, Result};
use crate::languages::Language;

/// Longest signature kept, in bytes.
const MAX_SIGNATURE_BYTES: usize = 300;

/// A function whose parent is one of these is a method.
const METHOD_PARENTS: &[&str] = &["impl", "class", "trait", "interface"];

/// Definitions nested in one of these are locals, left out of outlines.
const LOCAL_SCOPES: &[&str] = &["function", "method"];

/// One definition in a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Symbol {
    /// `function`, `method`, `struct`, `class`, `impl`, `trait`, `interface`, `enum`, `type`, `module`, ...
    pub kind: String,
    /// The identifier (for an `impl`, the implemented type).
    pub name: String,
    /// Enclosing definitions, outermost first, joined with `.`.
    pub parent: Option<String>,
    /// The declaration up to its body, on one line.
    pub signature: String,
    /// Line of the declaration itself, 1-based.
    pub line: u32,
    /// First line including attributes, decorators, export and doc comments.
    pub start_line: u32,
    /// Last line.
    pub end_line: u32,
}

struct Raw<'t> {
    kind: String,
    name: String,
    core: Node<'t>,
    /// From a `@parent` capture: the enclosing type when it is not a syntactic
    /// parent (a Go method's receiver).
    parent: Option<String>,
}

/// Parses `src` and lists its definitions in source order.
///
/// # Errors
/// [`Error::ParseFailed`] when the parser cannot be set up or yields no tree;
/// [`Error::ConfigInvalid`] when the language's query is broken.
pub(crate) fn definitions(lang: &Language, src: &str) -> Result<Vec<Symbol>> {
    let query = lang.query()?;
    let mut parser = Parser::new();
    parser
        .set_language(&lang.ts)
        .map_err(|e| Error::ParseFailed(format!("{}: {e}", lang.id())))?;
    let tree = parser
        .parse(src, None)
        .ok_or_else(|| Error::ParseFailed(format!("{}: no tree", lang.id())))?;
    let names = query.capture_names();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(query, tree.root_node(), src.as_bytes());
    let mut raws: Vec<Raw<'_>> = Vec::new();
    while let Some(m) = matches.next() {
        let (mut name, mut def, mut parent) = (None, None, None);
        for cap in m.captures() {
            let cname = names.get(cap.index as usize).copied().unwrap_or("");
            if cname == "name" {
                name = Some(cap.node);
            } else if cname == "parent" {
                parent = cap.node.utf8_text(src.as_bytes()).ok().map(receiver_name);
            } else if let Some(kind) = cname.strip_prefix("definition.") {
                def = Some((cap.node, kind));
            }
        }
        if let (Some(n), Some((core, kind))) = (name, def)
            && let Ok(text) = n.utf8_text(src.as_bytes())
        {
            raws.push(Raw {
                kind: kind.to_owned(),
                name: text.to_owned(),
                core,
                parent,
            });
        }
    }
    raws.sort_by_key(|r| {
        (
            r.core.start_byte(),
            std::cmp::Reverse(r.core.end_byte()),
            r.kind.clone(),
        )
    });
    raws.dedup_by(|b, a| {
        a.core.start_byte() == b.core.start_byte()
            && a.core.end_byte() == b.core.end_byte()
            && a.kind == b.kind
    });
    Ok(build(lang, src, &raws))
}

/// Resolves nesting, refines kinds, and computes ranges and signatures.
fn build(lang: &Language, src: &str, raws: &[Raw<'_>]) -> Vec<Symbol> {
    // (end_byte, name, kind) of the definitions that contain the current one.
    let mut stack: Vec<(usize, usize, &str, &str)> = Vec::new();
    let mut out = Vec::new();
    for r in raws {
        let (s, e) = (r.core.start_byte(), r.core.end_byte());
        while stack.last().is_some_and(|top| !(top.0 <= s && e <= top.1)) {
            stack.pop();
        }
        if stack.iter().any(|t| LOCAL_SCOPES.contains(&t.3)) {
            // Push so that anything nested deeper is a local too.
            stack.push((s, e, &r.name, &r.kind));
            continue;
        }
        let parent_kind = stack.last().map(|t| t.3);
        let kind =
            if r.kind == "function" && parent_kind.is_some_and(|k| METHOD_PARENTS.contains(&k)) {
                "method"
            } else {
                r.kind.as_str()
            };
        let parent = r.parent.clone().or_else(|| {
            (!stack.is_empty()).then(|| stack.iter().map(|t| t.2).collect::<Vec<_>>().join("."))
        });
        stack.push((s, e, &r.name, kind));
        out.push(Symbol {
            kind: kind.to_owned(),
            name: r.name.clone(),
            parent,
            signature: signature(r.core, src),
            line: row_to_line(r.core.start_position().row),
            start_line: row_to_line(extended_start_row(lang, src, r.core)),
            end_line: row_to_line(last_row(r.core, src)),
        });
    }
    out
}

/// `*Server` or `Server[T]` as the type name `Server`.
fn receiver_name(text: &str) -> String {
    let t = text.trim().trim_start_matches('*');
    t.split(['[', '<']).next().unwrap_or(t).trim().to_owned()
}

fn row_to_line(row: usize) -> u32 {
    u32::try_from(row + 1).unwrap_or(u32::MAX)
}

/// The last row a node occupies. A node that ends just after a newline
/// (some comment nodes do) does not own the next row.
fn last_row(node: Node<'_>, src: &str) -> usize {
    let end = node.end_position();
    if end.column == 0
        && end.row > node.start_position().row
        && src.as_bytes().get(node.end_byte().wrapping_sub(1)) == Some(&b'\n')
    {
        end.row - 1
    } else {
        end.row
    }
}

fn line_start(src: &str, byte: usize) -> usize {
    src[..byte].rfind('\n').map_or(0, |i| i + 1)
}

fn wrapper_applies(lang: &Language, parent: Node<'_>) -> bool {
    lang.spec()
        .wrappers
        .iter()
        .any(|w| match w.split_once(':') {
            Some((kind, "single")) => parent.kind() == kind && parent.named_child_count() == 1,
            _ => parent.kind() == w,
        })
}

/// First row of the definition's full extent: out through wrappers (export,
/// decorators), then up over directly adjacent doc comments and attributes.
fn extended_start_row(lang: &Language, src: &str, core: Node<'_>) -> usize {
    let mut node = core;
    while let Some(p) = node.parent() {
        if wrapper_applies(lang, p) {
            node = p;
        } else {
            break;
        }
    }
    let mut start_row = node.start_position().row;
    let mut cur = node;
    while let Some(prev) = cur.prev_sibling() {
        let adjacent = last_row(prev, src) + 1 >= cur.start_position().row;
        let own_line = src[line_start(src, prev.start_byte())..prev.start_byte()]
            .trim()
            .is_empty();
        if lang.spec().leading.iter().any(|k| k == prev.kind()) && adjacent && own_line {
            start_row = prev.start_position().row;
            cur = prev;
        } else {
            break;
        }
    }
    start_row
}

/// The declaration from its start to its body, whitespace collapsed.
/// Without a body field, the first line.
fn signature(core: Node<'_>, src: &str) -> String {
    let start = core.start_byte();
    let first_line_end = src[start..].find('\n').map_or(src.len(), |i| start + i);
    let end = core
        .child_by_field_name("body")
        .map(|b| b.start_byte())
        .filter(|&b| b > start)
        .unwrap_or(first_line_end)
        .min(core.end_byte());
    let header = src.get(start..end).unwrap_or("");
    let mut collapsed = header.split_whitespace().collect::<Vec<_>>().join(" ");
    // Multi-line parameter lists leave "( a, b, )"; tidy to "(a, b)".
    for (from, to) in [
        ("( ", "("),
        (", )", ")"),
        (" )", ")"),
        (", ]", "]"),
        ("[ ", "["),
    ] {
        collapsed = collapsed.replace(from, to);
    }
    if collapsed.len() <= MAX_SIGNATURE_BYTES {
        return collapsed;
    }
    let mut cut = MAX_SIGNATURE_BYTES;
    while !collapsed.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &collapsed[..cut])
}
