//! The documented limits of an element tree, checked on the JSON the isolate produced.
//!
//! A tree that fails is skipped: the site keeps its own drawing and the mod gets a log line,
//! as in Claude Code. Rust is the authority; the isolate only stops runaway trees early.

use serde_json::Value;

/// The limits from `docs/research/mods.md` section 2.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TreeLimits {
    /// Characters drawn, summed over text children and the text props.
    pub max_chars: usize,
    /// Elements in the tree.
    pub max_elements: usize,
    /// Nesting depth; the root is depth 1.
    pub max_depth: usize,
    /// `Code.language`, `Code.path`, each `Select` value and `Client.module`.
    pub max_value_chars: usize,
    /// `Link.href`.
    pub max_href_chars: usize,
    /// An `Svg` document.
    pub max_svg_chars: usize,
}

impl Default for TreeLimits {
    fn default() -> Self {
        Self { max_chars: 100_000, max_elements: 20_000, max_depth: 32, max_value_chars: 10_000, max_href_chars: 2_048, max_svg_chars: 131_072 }
    }
}

/// What a valid tree measured.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TreeStats {
    /// Elements.
    pub elements: usize,
    /// Characters drawn.
    pub chars: usize,
    /// Deepest nesting.
    pub depth: usize,
}

/// Why a tree was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum TreeError {
    /// More elements than the limit.
    #[error("the tree has more than {0} elements")]
    TooManyElements(usize),
    /// Nested deeper than the limit.
    #[error("the tree is nested deeper than {0}")]
    TooDeep(usize),
    /// More characters than the limit.
    #[error("the tree draws more than {0} characters")]
    TooManyChars(usize),
    /// A prop longer than its cap.
    #[error("`{element}.{prop}` is longer than {limit} characters")]
    PropTooLong {
        /// The element type.
        element: String,
        /// The prop name.
        prop: String,
        /// Its cap.
        limit: usize,
    },
    /// Not an element: no `type`, or a child that is neither text nor an element.
    #[error("malformed tree: {0}")]
    Malformed(String),
}

/// Props whose string value is drawn as text.
const TEXT_PROPS: [&str; 6] = ["text", "source", "label", "placeholder", "value", "title"];

fn chars(s: &str) -> usize {
    s.chars().count()
}

fn check_prop(element: &str, prop: &str, value: &Value, limits: &TreeLimits) -> Result<(), TreeError> {
    let long = |limit: usize| TreeError::PropTooLong { element: element.to_owned(), prop: prop.to_owned(), limit };
    let too_long = |s: &str, limit: usize| if chars(s) > limit { Err(long(limit)) } else { Ok(()) };
    match (element, prop, value) {
        ("Code", "language" | "path", Value::String(s)) | ("Client", "module", Value::String(s)) => too_long(s, limits.max_value_chars),
        ("Link", "href", Value::String(s)) => too_long(s, limits.max_href_chars),
        ("Svg", _, Value::String(s)) => too_long(s, limits.max_svg_chars),
        ("Select", "options", Value::Array(options)) => {
            for v in options.iter().filter_map(|o| o.get("value").and_then(Value::as_str)) {
                too_long(v, limits.max_value_chars)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Checks `tree` against `limits`.
///
/// # Errors
/// The first limit it breaks. The walk is iterative, so a hostile tree cannot overflow the stack.
pub fn validate(tree: &Value, limits: &TreeLimits) -> Result<TreeStats, TreeError> {
    let mut stats = TreeStats { elements: 0, chars: 0, depth: 0 };
    let mut stack = vec![(tree, 1usize)];
    while let Some((node, depth)) = stack.pop() {
        if depth > limits.max_depth {
            return Err(TreeError::TooDeep(limits.max_depth));
        }
        stats.elements += 1;
        if stats.elements > limits.max_elements {
            return Err(TreeError::TooManyElements(limits.max_elements));
        }
        stats.depth = stats.depth.max(depth);
        let element = node.get("type").and_then(Value::as_str).ok_or_else(|| TreeError::Malformed("an element has no `type`".into()))?;
        if let Some(props) = node.get("props").and_then(Value::as_object) {
            for (name, value) in props {
                check_prop(element, name, value, limits)?;
                if element != "Svg" && TEXT_PROPS.contains(&name.as_str()) {
                    if let Some(s) = value.as_str() {
                        stats.chars += chars(s);
                    }
                }
            }
        }
        for child in node.get("children").and_then(Value::as_array).map_or(&[][..], Vec::as_slice) {
            match child {
                Value::String(s) => stats.chars += chars(s),
                Value::Object(_) => stack.push((child, depth + 1)),
                other => return Err(TreeError::Malformed(format!("a child is {other}"))),
            }
        }
        if stats.chars > limits.max_chars {
            return Err(TreeError::TooManyChars(limits.max_chars));
        }
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn nest(depth: usize) -> Value {
        (1..depth).fold(json!({"type": "Text", "props": {}, "children": ["x"]}), |inner, _| json!({"type": "Box", "props": {}, "children": [inner]}))
    }

    #[test]
    fn depth_limit_is_inclusive() {
        assert_eq!(validate(&nest(32), &TreeLimits::default()).unwrap().depth, 32);
        assert_eq!(validate(&nest(33), &TreeLimits::default()), Err(TreeError::TooDeep(32)));
    }

    #[test]
    fn element_limit_is_inclusive() {
        let flat = |n: usize| json!({"type": "Box", "props": {}, "children": (1..n).map(|_| json!({"type": "Text", "props": {}, "children": []})).collect::<Vec<_>>()});
        assert_eq!(validate(&flat(20_000), &TreeLimits::default()).unwrap().elements, 20_000);
        assert_eq!(validate(&flat(20_001), &TreeLimits::default()), Err(TreeError::TooManyElements(20_000)));
    }

    #[test]
    fn character_limit_counts_text_children_and_text_props() {
        let text = |n: usize| json!({"type": "Box", "props": {}, "children": [{"type": "Markdown", "props": {"text": "é".repeat(n)}, "children": []}]});
        assert_eq!(validate(&text(100_000), &TreeLimits::default()).unwrap().chars, 100_000);
        assert_eq!(validate(&text(100_001), &TreeLimits::default()), Err(TreeError::TooManyChars(100_000)));
    }

    #[test]
    fn per_prop_caps() {
        let link = json!({"type": "Link", "props": {"href": "h".repeat(2_049)}, "children": []});
        assert!(matches!(validate(&link, &TreeLimits::default()), Err(TreeError::PropTooLong { limit: 2_048, .. })));
        let code = json!({"type": "Code", "props": {"language": "l".repeat(10_001)}, "children": []});
        assert!(matches!(validate(&code, &TreeLimits::default()), Err(TreeError::PropTooLong { limit: 10_000, .. })));
        let svg = json!({"type": "Svg", "props": {"source": "s".repeat(131_072)}, "children": []});
        assert!(validate(&svg, &TreeLimits::default()).is_ok());
    }

    #[test]
    fn malformed_children_are_refused() {
        assert!(matches!(validate(&json!({"props": {}}), &TreeLimits::default()), Err(TreeError::Malformed(_))));
        assert!(matches!(validate(&json!({"type": "Box", "children": [3]}), &TreeLimits::default()), Err(TreeError::Malformed(_))));
    }
}
