//! The scrubber: free text from the engine (an approval's command, a description, a tool's name, a message preview) is
//! passed through it before it can leave the host, so a secret that slipped into it does not reach another client.
//! It is a second line: the types of the contract carry no secret field at all, and the engine redacts approval text
//! itself. It removes bearer tokens, gateway tickets, the values after words like `token=` and `password:`, well-known key
//! shapes, long opaque strings, and the exact values the host itself holds (its endpoint token, a ticket it minted).

/// What replaces a removed value.
pub const MASK: &str = "[removed]";

/// Words whose value, the next word, is removed (`token=abc`, `password: abc`, `Authorization: Bearer abc`).
const KEYWORDS: [&str; 16] = [
    "token", "secret", "password", "passwd", "pwd", "apikey", "api_key", "api-key", "authorization",
    "bearer", "credential", "credentials", "ticket", "private_key", "access_key", "auth",
];

/// Prefixes of well-known key shapes.
const PREFIXES: [&str; 14] = [
    "sk-", "sk_", "ghp_", "gho_", "ghs_", "ghu_", "github_pat_", "xox", "akia", "aiza", "eyj",
    "hermes-gateway-ticket", "pk_live", "rk_live",
];

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+' | '=' | '~' | '$')
}

fn opaque(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    if PREFIXES.iter().any(|p| lower.starts_with(p)) && word.len() >= 12 {
        return true;
    }
    if word.len() < 32 {
        return false;
    }
    // A full git object name is not a secret and shows up in commands.
    if word.len() == 40 && word.bytes().all(|b| b.is_ascii_hexdigit()) {
        return false;
    }
    let digits = word.bytes().any(|b| b.is_ascii_digit());
    let lowers = word.bytes().any(|b| b.is_ascii_lowercase());
    let uppers = word.bytes().any(|b| b.is_ascii_uppercase());
    digits && (lowers || uppers) && (lowers as u8 + uppers as u8 + digits as u8) >= 2
}

/// The text with every secret-shaped value removed.
#[must_use]
pub fn scrub(text: &str, exact: &[&str]) -> String {
    let mut text = text.to_owned();
    for value in exact.iter().filter(|v| v.len() >= 8) {
        text = text.replace(value, MASK);
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.char_indices().peekable();
    let mut mask_next = false;
    while let Some((start, c)) = chars.next() {
        if !is_word_char(c) {
            out.push(c);
            continue;
        }
        let mut end = start + c.len_utf8();
        while let Some(&(i, n)) = chars.peek() {
            if !is_word_char(n) {
                break;
            }
            end = i + n.len_utf8();
            chars.next();
        }
        let word = &text[start..end];
        // `key=value`, `key:value` and a bare `=value` split on the sign: judge both sides.
        if let Some((key, value)) = word.split_once('=')
            && !value.is_empty()
            && keyword(key)
        {
            out.push_str(key);
            out.push('=');
            out.push_str(MASK);
            continue;
        }
        if mask_next && word.len() >= 4 {
            out.push_str(MASK);
            mask_next = false;
            continue;
        }
        mask_next = keyword(word.trim_end_matches([':', '=']))
            || (word.eq_ignore_ascii_case("bearer"))
            || next_is_colon(&text[end..]) && keyword(word);
        if opaque(word) {
            out.push_str(MASK);
        } else {
            out.push_str(word);
        }
    }
    out
}

fn next_is_colon(rest: &str) -> bool {
    rest.trim_start_matches(' ').starts_with(':')
}

fn keyword(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    KEYWORDS.iter().any(|k| lower == *k || lower.ends_with(&format!("_{k}")) || lower.ends_with(&format!("-{k}")))
}

/// The text scrubbed and cut to `max` characters (an ellipsis marks a cut).
#[must_use]
pub fn clip(text: &str, max: usize, exact: &[&str]) -> String {
    let clean = scrub(text, exact);
    let single: String = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if single.chars().count() <= max {
        return single;
    }
    let cut: String = single.chars().take(max.saturating_sub(1)).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bearer_token_a_ticket_and_key_shapes_are_removed() {
        let cases = [
            "curl -H 'Authorization: Bearer abcDEF123456xyz' https://x",
            "dial hermes-gateway-ticket.AbCdEf0123456789AbCdEf",
            "export OPENAI_API_KEY=sk-proj-AbCdEf0123456789",
            "git push https://ghp_0123456789abcdefghijklmnopqrstuvwxyz0123@github.com/o/r",
            "password: hunter2hunter2",
            "token=0123456789abcdef0123456789abcdef0123",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
        ];
        for case in cases {
            let got = scrub(case, &[]);
            assert!(got.contains(MASK), "{case} -> {got}");
        }
        assert!(!scrub(cases[0], &[]).contains("abcDEF123456xyz"));
        assert!(!scrub(cases[3], &[]).contains("0123456789abcdefghijkl"));
        assert!(!scrub(cases[4], &[]).contains("hunter2"));
    }

    #[test]
    fn the_hosts_own_values_are_removed_wherever_they_sit() {
        let token = "f00dfeedbeef1234";
        let got = scrub(&format!("a{token}b and {token}"), &[token]);
        assert!(!got.contains(token), "{got}");
    }

    #[test]
    fn plain_text_and_a_git_sha_are_left_alone() {
        let plain = "run `git log -1 4e1243bd22c66e76c2ba9eddc1f91394e57f9f83` in /home/x/project and then ls -la";
        assert_eq!(scrub(plain, &[]), plain);
        assert_eq!(scrub("rm -rf build/ && cargo test", &[]), "rm -rf build/ && cargo test");
    }

    #[test]
    fn a_clip_is_one_line_scrubbed_and_cut() {
        let got = clip("line one\n  Bearer abcdefgh12345678\nlast", 200, &[]);
        assert_eq!(got, format!("line one Bearer {MASK} last"));
        let long = "word ".repeat(100);
        let cut = clip(&long, 20, &[]);
        assert_eq!(cut.chars().count(), 20);
        assert!(cut.ends_with('…'));
    }
}
