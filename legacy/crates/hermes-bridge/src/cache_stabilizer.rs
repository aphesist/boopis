use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Minimum static prefix token count required for KV-cache breakpoint activation
/// (per Contraprova's 0%-to-high KV-cache hit threshold finding).
pub const MIN_CACHE_PREFIX_TOKENS: usize = 512;

/// Signed thinking block carried in historical assistant turns.
///
/// Must stay byte-identical across turns so signature validation and KV-cache
/// prefix hashes never break.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThinkingBlock {
    pub thinking: String,
    #[serde(default)]
    pub signature: Option<String>,
}

/// Message representation passed through the KV-cache prefix stabilizer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CacheMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub thinking_blocks: Vec<ThinkingBlock>,
    #[serde(default)]
    pub pinned_static: bool,
}

impl CacheMessage {
    /// Creates a plain message with no thinking blocks.
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            thinking_blocks: Vec::new(),
            pinned_static: false,
        }
    }

    /// Creates a message carrying signed thinking blocks that must stay unaltered.
    pub fn with_thinking(
        role: impl Into<String>,
        content: impl Into<String>,
        thinking_blocks: Vec<ThinkingBlock>,
    ) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            thinking_blocks,
            pinned_static: false,
        }
    }
}

/// Result of stabilizing a single prompt prefix string.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StabilizedPrefix {
    pub stabilized_text: String,
    pub prefix_hash: String,
    pub estimated_tokens: usize,
    pub cacheable_tokens: usize,
    pub cache_upto: Option<usize>,
    pub stripped_lines: usize,
    pub signed_thinking_preserved: bool,
}

/// Result of stabilizing a sequence of historical prompt messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StabilizedConversation {
    pub messages: Vec<CacheMessage>,
    /// Inclusive index of the last message covered by the cache breakpoint, if >= 512 tokens.
    pub cache_upto: Option<usize>,
    /// Byte length of the stabilized prefix up to `cache_upto`, if active.
    pub cache_upto_bytes: Option<usize>,
    pub prefix_hash: String,
    pub estimated_cacheable_tokens: usize,
    pub total_estimated_tokens: usize,
    pub stripped_lines: usize,
    pub signed_thinking_preserved: bool,
}

/// Estimates token count deterministically without an external tokenizer.
///
/// Uses `max(ceil(chars / 4), whitespace_words)` so both prose and compact token
/// fixtures trigger threshold boundaries reliably.
pub fn estimate_tokens(text: &str) -> usize {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let char_est = trimmed.chars().count().div_ceil(4);
    let word_est = trimmed.split_whitespace().count();
    char_est.max(word_est)
}

/// Strips volatile per-request date and account-email reminder lines from prompt prefixes
/// while preserving `<thinking>...</thinking>` blocks and fenced code blocks verbatim.
pub fn strip_volatile_reminders(input: &str) -> (String, usize) {
    let normalized = input.replace("\r\n", "\n");
    let mut output_lines: Vec<String> = Vec::new();
    let mut stripped_count = 0usize;
    let mut in_thinking_block = false;
    let mut in_code_fence = false;
    let mut in_system_reminder = false;
    let mut reminder_buffer: Vec<String> = Vec::new();
    let mut reminder_had_volatile = false;

    for raw_line in normalized.split('\n') {
        let trimmed = raw_line.trim();
        let lower = trimmed.to_ascii_lowercase();

        if !in_code_fence && lower.contains("<thinking") && !lower.contains("</thinking>") {
            in_thinking_block = true;
            output_lines.push(raw_line.to_string());
            continue;
        }
        if in_thinking_block {
            output_lines.push(raw_line.to_string());
            if lower.contains("</thinking>") {
                in_thinking_block = false;
            }
            continue;
        }

        if trimmed.starts_with("```") {
            in_code_fence = !in_code_fence;
            output_lines.push(raw_line.to_string());
            continue;
        }
        if in_code_fence {
            output_lines.push(raw_line.to_string());
            continue;
        }

        // Single-line <system-reminder>...</system-reminder>
        if let Some(stripped_single) = try_strip_single_line_system_reminder(raw_line) {
            match stripped_single {
                SingleReminderOutcome::Removed => {
                    stripped_count += 1;
                    continue;
                }
                SingleReminderOutcome::Kept => {
                    output_lines.push(raw_line.to_string());
                    continue;
                }
            }
        }

        // Multi-line <system-reminder> ... </system-reminder>
        if !in_system_reminder && lower == "<system-reminder>" {
            in_system_reminder = true;
            reminder_buffer.clear();
            reminder_buffer.push(raw_line.to_string());
            reminder_had_volatile = false;
            continue;
        }

        if in_system_reminder {
            if lower == "</system-reminder>" {
                in_system_reminder = false;
                let has_static_inner = reminder_buffer
                    .iter()
                    .skip(1)
                    .any(|line| !line.trim().is_empty());
                if reminder_had_volatile && !has_static_inner {
                    // Nothing non-volatile remained inside <system-reminder>; drop wrapper too.
                    reminder_buffer.clear();
                } else {
                    for buffered in reminder_buffer.drain(..) {
                        output_lines.push(buffered);
                    }
                    output_lines.push(raw_line.to_string());
                }
                continue;
            }

            if is_volatile_reminder_line(trimmed) {
                stripped_count += 1;
                reminder_had_volatile = true;
                continue;
            }

            reminder_buffer.push(raw_line.to_string());
            continue;
        }

        if is_volatile_reminder_line(trimmed) {
            stripped_count += 1;
            continue;
        }

        output_lines.push(raw_line.to_string());
    }

    // Flush unclosed reminder buffer safely.
    if in_system_reminder {
        for buffered in reminder_buffer {
            output_lines.push(buffered);
        }
    }

    let joined = collapse_excess_blank_lines(&output_lines, stripped_count > 0);
    (joined, stripped_count)
}

/// Stabilizes a raw prompt prefix string and computes `cache_upto` if `>= 512` tokens.
pub fn stabilize_prefix(prefix: &str) -> StabilizedPrefix {
    let signed_thinking_preserved = prefix.contains("<thinking");
    let (stabilized_text, stripped_lines) = strip_volatile_reminders(prefix);
    let estimated_tokens = estimate_tokens(&stabilized_text);
    let prefix_hash = hash_str(&stabilized_text);

    let (cache_upto, cacheable_tokens) = if estimated_tokens >= MIN_CACHE_PREFIX_TOKENS {
        (Some(stabilized_text.len()), estimated_tokens)
    } else {
        (None, 0)
    };

    StabilizedPrefix {
        stabilized_text,
        prefix_hash,
        estimated_tokens,
        cacheable_tokens,
        cache_upto,
        stripped_lines,
        signed_thinking_preserved,
    }
}

/// Stabilizes a slice of historical prefix messages and computes the `cache_upto` message
/// index breakpoint only when total stabilized prefix tokens reach `min_tokens` (default 512).
pub fn stabilize_messages(
    prefix_messages: &[CacheMessage],
    min_tokens: Option<usize>,
) -> StabilizedConversation {
    let threshold = min_tokens.unwrap_or(MIN_CACHE_PREFIX_TOKENS);
    let mut stabilized_messages = Vec::with_capacity(prefix_messages.len());
    let mut total_stripped = 0usize;
    let mut total_tokens = 0usize;
    let mut total_bytes = 0usize;
    let mut hasher = Sha256::new();
    let mut has_thinking = false;

    for msg in prefix_messages {
        let (clean_content, stripped) = strip_volatile_reminders(&msg.content);
        total_stripped += stripped;
        if !msg.thinking_blocks.is_empty() || msg.content.contains("<thinking") {
            has_thinking = true;
        }

        let mut msg_tokens = estimate_tokens(&clean_content);
        let mut msg_bytes = clean_content.len();

        hasher.update(msg.role.as_bytes());
        hasher.update(b"\x1f");
        hasher.update(clean_content.as_bytes());
        hasher.update(b"\x1f");

        // Signed thinking blocks are preserved verbatim in content and hash.
        for tb in &msg.thinking_blocks {
            msg_tokens += estimate_tokens(&tb.thinking);
            msg_bytes += tb.thinking.len();
            hasher.update(tb.thinking.as_bytes());
            hasher.update(b"\x1e");
            if let Some(sig) = &tb.signature {
                hasher.update(sig.as_bytes());
            }
            hasher.update(b"\x1e");
        }

        total_tokens += msg_tokens;
        total_bytes += msg_bytes;

        stabilized_messages.push(CacheMessage {
            role: msg.role.clone(),
            content: clean_content,
            thinking_blocks: msg.thinking_blocks.clone(),
            pinned_static: msg.pinned_static,
        });
    }

    let prefix_hash = hex::encode(hasher.finalize());
    let (cache_upto, cache_upto_bytes, estimated_cacheable_tokens) =
        if !stabilized_messages.is_empty() && total_tokens >= threshold {
            (
                Some(stabilized_messages.len() - 1),
                Some(total_bytes),
                total_tokens,
            )
        } else {
            (None, None, 0)
        };

    StabilizedConversation {
        messages: stabilized_messages,
        cache_upto,
        cache_upto_bytes,
        prefix_hash,
        estimated_cacheable_tokens,
        total_estimated_tokens: total_tokens,
        stripped_lines: total_stripped,
        signed_thinking_preserved: has_thinking,
    }
}

/// Finds the longest shared stabilized prefix between two conversation histories and
/// emits a `cache_upto` breakpoint only when that shared static prefix >= 512 tokens.
pub fn compute_shared_prefix_breakpoint(
    history_a: &[CacheMessage],
    history_b: &[CacheMessage],
) -> StabilizedConversation {
    let norm_a = stabilize_messages(history_a, Some(0));
    let norm_b = stabilize_messages(history_b, Some(0));

    let shared_len = norm_a
        .messages
        .iter()
        .zip(norm_b.messages.iter())
        .take_while(|(a, b)| {
            a.role == b.role && a.content == b.content && a.thinking_blocks == b.thinking_blocks
        })
        .count();

    let shared_slice = &history_a[..shared_len];
    stabilize_messages(shared_slice, Some(MIN_CACHE_PREFIX_TOKENS))
}

enum SingleReminderOutcome {
    Removed,
    Kept,
}

fn try_strip_single_line_system_reminder(line: &str) -> Option<SingleReminderOutcome> {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("<system-reminder>") && lower.ends_with("</system-reminder>")) {
        return None;
    }
    let inner = &trimmed["<system-reminder>".len()..trimmed.len() - "</system-reminder>".len()];
    let inner_trimmed = inner.trim();
    if inner_trimmed.is_empty() || is_volatile_reminder_line(inner_trimmed) {
        Some(SingleReminderOutcome::Removed)
    } else {
        Some(SingleReminderOutcome::Kept)
    }
}

fn is_volatile_reminder_line(trimmed: &str) -> bool {
    if trimmed.is_empty() {
        return false;
    }

    // Strip common markdown/bullet wrappers around reminder lines before matching.
    let candidate = trimmed
        .trim_start_matches(['-', '*', '>', '['])
        .trim_end_matches(']')
        .trim();
    let lower = candidate.to_ascii_lowercase();

    // Temporal anchoring & per-request date/time reminders
    let date_prefixes = [
        "current date:",
        "current date is",
        "current date =",
        "current utc date:",
        "current date and time:",
        "today's date:",
        "today's date is",
        "current time:",
        "current datetime:",
        "current timestamp:",
        "request date:",
        "request timestamp:",
        "session date:",
        "session timestamp:",
        "temporal anchoring:",
        "system date:",
    ];
    if date_prefixes.iter().any(|p| lower.starts_with(p)) {
        return true;
    }

    if lower.starts_with("today is ") && contains_iso_date_or_year(&lower) {
        return true;
    }

    if lower.starts_with("date:") && contains_iso_date_or_year(&lower) {
        return true;
    }

    // Account / subscription email reminders
    let account_prefixes = [
        "account email:",
        "user email:",
        "claude account:",
        "subscription account:",
        "active account:",
        "logged-in account:",
        "logged in email:",
        "signed-in email:",
    ];
    if account_prefixes.iter().any(|p| lower.starts_with(p)) {
        return true;
    }

    if (lower.starts_with("signed in as ")
        || lower.starts_with("logged in as ")
        || lower.starts_with("authenticated as ")
        || lower.starts_with("account:"))
        && (lower.contains('@') || lower.contains("subscription") || lower.contains("account"))
    {
        return true;
    }

    false
}

fn contains_iso_date_or_year(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    if bytes.len() >= 10 {
        for win in bytes.windows(10) {
            if win[0..4].iter().all(u8::is_ascii_digit)
                && win[4] == b'-'
                && win[5..7].iter().all(u8::is_ascii_digit)
                && win[7] == b'-'
                && win[8..10].iter().all(u8::is_ascii_digit)
            {
                return true;
            }
        }
    }
    let months = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ];
    months.iter().any(|m| lower.contains(m))
}

fn collapse_excess_blank_lines(lines: &[String], removed_any: bool) -> String {
    if !removed_any {
        return lines.join("\n");
    }

    let mut collapsed = Vec::with_capacity(lines.len());
    let mut prev_blank = false;
    for line in lines {
        let is_blank = line.trim().is_empty();
        if is_blank {
            if collapsed.is_empty() || prev_blank {
                continue;
            }
            prev_blank = true;
            collapsed.push(String::new());
        } else {
            prev_blank = false;
            collapsed.push(line.clone());
        }
    }
    while collapsed.last().is_some_and(|l| l.trim().is_empty()) {
        collapsed.pop();
    }
    collapsed.join("\n")
}

fn hash_str(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}
