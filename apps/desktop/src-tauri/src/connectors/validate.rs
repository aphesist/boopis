//! What the host accepts of a connector, before anything reaches Hermes. Every input here is untrusted (the form's fields, an
//! agent's form, a catalog file): names are plain tokens, URLs are `https` (plain `http` only for loopback, for a server the
//! user is developing) with no credentials in them, a command is one program and an argument vector (never a shell string),
//! and a key is never a literal in anything boopis writes: it goes to the keychain and the config holds a `${VAR}` reference.
//!
//! Hermes validates a server again when it saves it (`hermes_cli/mcp_security.py`); these checks are the host's own and
//! come first, so a refusal is ours, in words, and nothing was sent.

use url::{Host, Url};

use crate::error::{Error, Result};

/// The longest connector name.
pub const MAX_NAME: usize = 48;
/// The longest URL.
pub const MAX_URL: usize = 2048;
/// The most arguments a command may carry.
pub const MAX_ARGS: usize = 64;
/// The longest single argument, environment value or header value.
pub const MAX_VALUE: usize = 4096;
/// The most environment variables or headers one connector may carry.
pub const MAX_PAIRS: usize = 32;

fn bad(what: impl Into<String>) -> Error {
    Error::InvalidInput(what.into())
}

/// A connector's name: lowercase letters, digits, `-` and `_`, starting with a letter or digit. It becomes a config key and
/// part of every tool name Hermes makes (`mcp_<name>_<tool>`), so nothing else is allowed.
///
/// # Errors
/// `InvalidInput` for anything else.
pub fn name(raw: &str) -> Result<()> {
    let b = raw.as_bytes();
    let ok = (1..=MAX_NAME).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'-' | b'_'));
    if ok {
        Ok(())
    } else {
        Err(bad(format!(
            "a connector's name is 1 to {MAX_NAME} characters of a-z, 0-9, - and _, starting with a letter or digit"
        )))
    }
}

/// Query parameters that carry a credential. A URL with one is refused: the key would sit in the config file and in every log
/// line that prints the URL.
const CREDENTIAL_QUERY: &[&str] = &[
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "api_key",
    "apikey",
    "api-key",
    "key",
    "secret",
    "client_secret",
    "password",
    "passwd",
    "pwd",
    "auth",
    "authorization",
    "bearer",
    "sig",
    "signature",
    "x-api-key",
];

fn loopback(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(d) => {
            d.eq_ignore_ascii_case("localhost") || d.to_ascii_lowercase().ends_with(".localhost")
        }
        Host::Ipv4(ip) => ip.is_loopback(),
        Host::Ipv6(ip) => ip.is_loopback(),
    }
}

/// An MCP server's URL: `https`, or `http` only for a loopback host (a server being developed on this machine); a host; no
/// user name or password; no fragment; no credential in the query.
///
/// # Errors
/// `InvalidInput` with the reason in words.
pub fn url(raw: &str) -> Result<Url> {
    if raw.len() > MAX_URL || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(bad(
            "the URL is too long, or has spaces or control characters",
        ));
    }
    let parsed = Url::parse(raw).map_err(|e| bad(format!("not a URL: {e}")))?;
    let host = parsed.host().ok_or_else(|| bad("the URL needs a host"))?;
    match parsed.scheme() {
        "https" => {}
        "http" if loopback(&host) => {}
        "http" => {
            return Err(bad(
                "only https links are accepted (plain http only for this computer, 127.0.0.1 or localhost)",
            ));
        }
        other => return Err(bad(format!("only https links are accepted, not {other}"))),
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(bad(
            "the URL has a user name or password in it; keys go in the key field, to the keychain",
        ));
    }
    if parsed.fragment().is_some() {
        return Err(bad(
            "the URL has a # fragment, which a server never receives",
        ));
    }
    if let Some((k, _)) = parsed
        .query_pairs()
        .find(|(k, _)| CREDENTIAL_QUERY.contains(&k.to_ascii_lowercase().as_str()))
    {
        return Err(bad(format!(
            "the URL carries a credential in its query ({k}=...); give the key in the key field instead, so it goes to the keychain"
        )));
    }
    Ok(parsed)
}

/// The name of a server that already exists in Hermes (it may not follow our own rule: a native entry can be `GitHub`). It
/// still goes into a command line and a config key, so it is plain: no spaces, no control characters, and no `.` where it
/// would split a config key (`dotted` says whether it is used as one).
///
/// # Errors
/// `InvalidInput`.
pub fn existing_name(raw: &str, dotted: bool) -> Result<()> {
    let ok = (1..=128).contains(&raw.len())
        && !raw.starts_with('-')
        && raw
            .chars()
            .all(|c| !c.is_control() && !c.is_whitespace() && c != '\\' && c != '/');
    if !ok {
        return Err(bad("that is not a connector's name"));
    }
    if dotted && raw.contains('.') {
        return Err(bad("a name with a . in it cannot be changed from here"));
    }
    Ok(())
}

/// The page a sign-in sends the user to, from Hermes: `https` (or loopback `http`, for a server being developed), no
/// credentials in the address, a `state` to check, and, when it names a `redirect_uri`, one that is a loopback address with a
/// port, so the code can only come back to this computer. The host opens nothing else.
///
/// # Errors
/// `InvalidInput`.
pub fn auth_url(raw: &str) -> Result<Url> {
    if raw.len() > 8192 || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(bad(
            "the sign-in address is too long, or has spaces or control characters",
        ));
    }
    let parsed =
        Url::parse(raw).map_err(|e| bad(format!("the sign-in address is not a URL: {e}")))?;
    let host = parsed
        .host()
        .ok_or_else(|| bad("the sign-in address needs a host"))?;
    match parsed.scheme() {
        "https" => {}
        "http" if loopback(&host) => {}
        _ => return Err(bad("the sign-in address must be https")),
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(bad("the sign-in address has a user name or password in it"));
    }
    let q: std::collections::BTreeMap<String, String> = parsed
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if q.get("state").is_none_or(String::is_empty) {
        return Err(bad(
            "the sign-in address carries no state to check the answer against",
        ));
    }
    if let Some(r) = q.get("redirect_uri") {
        let red = Url::parse(r).map_err(|_| bad("the sign-in's return address is not a URL"))?;
        let local = red.scheme() == "http"
            && red.port().is_some()
            && red.host().as_ref().is_some_and(loopback);
        if !local || !red.username().is_empty() || red.password().is_some() {
            return Err(bad(
                "the sign-in's return address is not this computer (127.0.0.1 with a port)",
            ));
        }
    }
    Ok(parsed)
}

/// The host (and port, when not the scheme's own) a URL reaches, for the install form.
#[must_use]
pub fn host_of(url: &Url) -> String {
    match (url.host_str(), url.port()) {
        (Some(h), Some(p)) => format!("{h}:{p}"),
        (Some(h), None) => h.to_owned(),
        _ => String::new(),
    }
}

/// Programs that interpret a string as a command line. Starting one is a shell string with extra steps, so none may be the
/// command, whatever its arguments.
const SHELLS: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "dash",
    "fish",
    "ksh",
    "csh",
    "tcsh",
    "ash",
    "busybox",
    "cmd",
    "powershell",
    "pwsh",
    "wsl",
    "nu",
    "elvish",
    "xonsh",
];
/// Programs that run another program from their arguments, which would put a command line in `args`.
const WRAPPERS: &[&str] = &[
    "env", "sudo", "doas", "su", "nohup", "setsid", "xargs", "nice", "ionice", "timeout", "time",
    "exec", "eval", "command", "stdbuf", "strace", "watch", "script", "runas", "start", "call",
    "xterm", "open",
];
/// Interpreters that are fine to start a server script with (`python -m server`, `node server.js`) and not fine to hand a
/// program text on the command line.
const INTERPRETERS: &[&str] = &[
    "python",
    "node",
    "nodejs",
    "deno",
    "bun",
    "perl",
    "ruby",
    "php",
    "lua",
    "osascript",
];
/// The flags of those interpreters that take a program text.
const INLINE_FLAGS: &[&str] = &[
    "-c",
    "-e",
    "-E",
    "-p",
    "-r",
    "-R",
    "-x",
    "--eval",
    "--print",
    "--command",
    "-command",
    "-encodedcommand",
    "eval",
    "--exec",
    "-exec",
];

/// A program's name without its folder and `.exe`.
fn base(command: &str) -> String {
    let leaf = command.rsplit(['/', '\\']).next().unwrap_or(command);
    let lower = leaf.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_owned()
}

/// `python3.12` is `python`.
fn interpreter(base: &str) -> bool {
    let stem = base.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.');
    INTERPRETERS.contains(&stem) || INTERPRETERS.contains(&base)
}

/// A stdio server's command: one program (a name on the `PATH` or a path), no spaces and nothing a shell would read, not a
/// shell and not a wrapper that runs another program.
///
/// # Errors
/// `InvalidInput` with the reason in words.
pub fn command(raw: &str) -> Result<()> {
    if raw.is_empty() || raw.len() > 512 {
        return Err(bad("the command is empty or too long"));
    }
    if raw.chars().any(char::is_control) {
        return Err(bad("the command has control characters in it"));
    }
    if raw.chars().any(char::is_whitespace) {
        return Err(bad(
            "the command is one program: put its arguments in the arguments field, one per line, not in the command",
        ));
    }
    let shellish = |c: char| {
        matches!(
            c,
            ';' | '&'
                | '|'
                | '<'
                | '>'
                | '`'
                | '$'
                | '('
                | ')'
                | '{'
                | '}'
                | '*'
                | '?'
                | '!'
                | '#'
                | '"'
                | '\''
                | '['
                | ']'
        )
    };
    if raw.chars().any(shellish) || (cfg!(not(windows)) && raw.contains('\\')) {
        return Err(bad(
            "the command has characters only a shell would read; give a program, not a shell string",
        ));
    }
    if raw.starts_with('-') || raw.starts_with('~') {
        return Err(bad(
            "the command must be a program name or a path, not an option or a ~ path",
        ));
    }
    let b = base(raw);
    if SHELLS.contains(&b.as_str()) {
        return Err(bad(format!(
            "{b} is a shell: boopis never runs a shell string. Give the program itself and its arguments"
        )));
    }
    if WRAPPERS.contains(&b.as_str()) {
        return Err(bad(format!(
            "{b} runs another program from its arguments; give that program as the command"
        )));
    }
    Ok(())
}

/// A command's arguments: a bounded vector of plain strings, and for an interpreter no flag that takes program text.
///
/// # Errors
/// `InvalidInput` with the reason in words.
pub fn args(command: &str, args: &[String]) -> Result<()> {
    if args.len() > MAX_ARGS {
        return Err(bad(format!("at most {MAX_ARGS} arguments")));
    }
    for a in args {
        if a.len() > MAX_VALUE || a.contains(['\0', '\n', '\r']) {
            return Err(bad(
                "an argument is too long, or has a line break or NUL in it",
            ));
        }
    }
    if interpreter(&base(command))
        && let Some(flag) = args.iter().find(|a| INLINE_FLAGS.contains(&a.as_str()))
    {
        return Err(bad(format!(
            "{flag} hands {command} a program text, which is a shell string by another name; run a script file or a module instead"
        )));
    }
    Ok(())
}

/// Variables that change how a program starts or what it loads, which no MCP server's configuration should set.
const HIJACK_ENV: &[&str] = &[
    "PATH",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONSTARTUP",
    "PYTHONINSPECT",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "RUBYOPT",
    "RUBYLIB",
    "PERL5OPT",
    "PERL5LIB",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "BASH_ENV",
    "ENV",
    "IFS",
    "SHELLOPTS",
    "PS4",
    "GIT_SSH_COMMAND",
    "GIT_EXTERNAL_DIFF",
    "GIT_ASKPASS",
    "HOME",
    "HERMES_HOME",
    "XDG_CONFIG_HOME",
    "BASH_FUNC_",
    "PROMPT_COMMAND",
    "CDPATH",
    "GLOBIGNORE",
];

/// An environment variable's name.
///
/// # Errors
/// `InvalidInput` for a name that is not `[A-Za-z_][A-Za-z0-9_]*`, or one that changes how programs load.
pub fn env_name(raw: &str) -> Result<()> {
    let b = raw.as_bytes();
    let ok = (1..=128).contains(&b.len())
        && (b[0].is_ascii_alphabetic() || b[0] == b'_')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_');
    if !ok {
        return Err(bad(format!(
            "{raw:?} is not an environment variable name (letters, digits and _)"
        )));
    }
    let upper = raw.to_ascii_uppercase();
    if upper.starts_with("DYLD_")
        || upper.starts_with("LD_")
        || HIJACK_ENV.contains(&upper.as_str())
    {
        return Err(bad(format!(
            "{raw} changes how programs start; it cannot be set for a connector"
        )));
    }
    Ok(())
}

/// Whether a name reads as one that carries a key.
fn secret_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    [
        "key",
        "token",
        "secret",
        "password",
        "passwd",
        "credential",
        "auth",
        "cookie",
        "bearer",
        "signature",
    ]
    .iter()
    .any(|w| n.contains(w))
}

/// Whether `value` is only `${VAR}` references (and an auth scheme word), which carries no secret.
fn only_references(value: &str) -> bool {
    let mut rest = value.trim();
    for scheme in ["Bearer ", "Basic ", "Token "] {
        if let Some(r) = rest.strip_prefix(scheme) {
            rest = r.trim();
        }
    }
    if rest.is_empty() {
        return false;
    }
    let mut left = rest;
    while let Some(start) = left.find("${") {
        let (head, tail) = left.split_at(start);
        if !head.trim().is_empty() {
            return false;
        }
        match tail.find('}') {
            Some(end) if end > 2 => left = &tail[end + 1..],
            _ => return false,
        }
    }
    left.trim().is_empty()
}

/// An environment value that is plain, not a key.
///
/// # Errors
/// `InvalidInput` when the value is too long, has a NUL or line break, or sits in a variable that reads as a key and is not a
/// `${VAR}` reference (a key goes through the key field, to the keychain, never into a config file).
pub fn env_value(name: &str, value: &str) -> Result<()> {
    if value.len() > MAX_VALUE || value.contains(['\0', '\n', '\r']) {
        return Err(bad(format!(
            "the value of {name} is too long, or has a line break"
        )));
    }
    if secret_name(name) && !value.is_empty() && !only_references(value) {
        return Err(bad(format!(
            "{name} reads as a key. Give it in the key field, so it goes to your keychain; boopis never writes a key into a config file"
        )));
    }
    Ok(())
}

/// An HTTP header's name: an RFC 9110 token.
///
/// # Errors
/// `InvalidInput` for anything else.
pub fn header_name(raw: &str) -> Result<()> {
    let ok = (1..=128).contains(&raw.len())
        && raw
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&c));
    if ok {
        Ok(())
    } else {
        Err(bad(format!("{raw:?} is not a header name")))
    }
}

/// A header the user typed in the plain headers field: a name, and a value that is not a key.
///
/// # Errors
/// `InvalidInput`; a header that reads as a key, or a value with `Bearer`/`Basic` and a literal token, is refused.
pub fn plain_header(name: &str, value: &str) -> Result<()> {
    header_name(name)?;
    if value.len() > MAX_VALUE || value.contains(['\0', '\n', '\r']) {
        return Err(bad(format!(
            "the value of {name} is too long, or has a line break"
        )));
    }
    let literal_scheme = ["bearer ", "basic ", "token "]
        .iter()
        .any(|s| value.trim().to_ascii_lowercase().starts_with(s))
        && !only_references(value);
    if (secret_name(name) || literal_scheme) && !value.is_empty() && !only_references(value) {
        return Err(bad(format!(
            "{name} reads as a key. Use the key option, so the key goes to your keychain; boopis never writes a key into a config file"
        )));
    }
    Ok(())
}

/// Parse `Name: value` lines (blank lines and `#` comments skipped) into validated pairs.
///
/// # Errors
/// `InvalidInput` naming the line.
pub fn header_lines(text: &str) -> Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (n, v) = line
            .split_once(':')
            .ok_or_else(|| bad(format!("header line {} is not `Name: value`", i + 1)))?;
        let (n, v) = (n.trim(), v.trim());
        plain_header(n, v).map_err(|e| bad(format!("header line {}: {e}", i + 1)))?;
        if out
            .iter()
            .any(|(m, _): &(String, String)| m.eq_ignore_ascii_case(n))
        {
            return Err(bad(format!("the header {n} is given twice")));
        }
        out.push((n.to_owned(), v.to_owned()));
    }
    if out.len() > MAX_PAIRS {
        return Err(bad(format!("at most {MAX_PAIRS} headers")));
    }
    Ok(out)
}

/// Parse `NAME=value` lines into validated pairs.
///
/// # Errors
/// `InvalidInput` naming the line.
pub fn env_lines(text: &str) -> Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (n, v) = line
            .split_once('=')
            .ok_or_else(|| bad(format!("environment line {} is not `NAME=value`", i + 1)))?;
        let (n, v) = (n.trim(), v.trim());
        env_name(n).map_err(|e| bad(format!("environment line {}: {e}", i + 1)))?;
        env_value(n, v).map_err(|e| bad(format!("environment line {}: {e}", i + 1)))?;
        if out.iter().any(|(m, _): &(String, String)| m == n) {
            return Err(bad(format!("{n} is given twice")));
        }
        out.push((n.to_owned(), v.to_owned()));
    }
    if out.len() > MAX_PAIRS {
        return Err(bad(format!("at most {MAX_PAIRS} environment variables")));
    }
    Ok(out)
}

/// Arguments, one per line (blank lines skipped). There is no quoting and no splitting on spaces: each line is one argument,
/// exactly as written, which is what makes the vector the command line and nothing else.
#[must_use]
pub fn arg_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty())
        .map(str::to_owned)
        .collect()
}

/// Arguments as the user sees them: each quoted only when it has a space.
#[must_use]
pub fn display_args(args: &[String]) -> String {
    let q = |s: &str| {
        if s.is_empty() || s.contains(char::is_whitespace) {
            format!("'{}'", s.replace('\'', "'\\''"))
        } else {
            s.to_owned()
        }
    };
    args.iter().map(|a| q(a)).collect::<Vec<_>>().join(" ")
}

/// A command as the user sees it, for the form and for a log line: each argument quoted only when it has a space.
#[must_use]
pub fn display_command(command: &str, args: &[String]) -> String {
    let q = |s: &str| {
        if s.is_empty() || s.contains(char::is_whitespace) {
            format!("'{}'", s.replace('\'', "'\\''"))
        } else {
            s.to_owned()
        }
    };
    std::iter::once(q(command))
        .chain(args.iter().map(|a| q(a)))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;

    #[test]
    fn names_are_plain_tokens() {
        for ok in ["firecrawl", "a", "my-server_2", "0day"] {
            assert!(name(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "Firecrawl",
            "-x",
            "_x",
            "a b",
            "a.b",
            "a/b",
            "a;b",
            "ü",
            &"a".repeat(49),
        ] {
            assert!(name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn urls_are_https_with_no_credentials() {
        for ok in [
            "https://mcp.example.com/v1/mcp",
            "https://mcp.example.com:8443/x?tenant=acme",
            "http://127.0.0.1:3000/mcp",
            "http://localhost:8080/mcp",
            "http://[::1]:9000/mcp",
            "http://dev.localhost/mcp",
        ] {
            assert!(url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://mcp.example.com/mcp",
            "http://10.0.0.5/mcp",
            "ftp://example.com/x",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://user:pw@example.com/mcp",
            "https://user@example.com/mcp",
            "https://example.com/mcp#frag",
            "https://example.com/mcp?token=abc",
            "https://example.com/mcp?API_KEY=abc",
            "https://example.com/mcp?x=1&access_token=abc",
            "https://example.com/a b",
            "https://",
            "not a url",
            "https://example.com/\u{7}",
            &format!("https://example.com/{}", "a".repeat(2100)),
        ] {
            assert!(url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_sign_in_address_returns_only_to_this_computer() {
        let ok = "https://auth.example.com/authorize?response_type=code&client_id=c&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A53211%2Fcallback&code_challenge=x";
        assert!(auth_url(ok).is_ok());
        assert!(auth_url("https://auth.example.com/authorize?state=abc").is_ok());
        for bad in [
            "https://auth.example.com/authorize",
            "https://auth.example.com/authorize?state=",
            "http://auth.example.com/authorize?state=abc",
            "https://u:p@auth.example.com/authorize?state=abc",
            "file:///x?state=abc",
            "javascript:alert(1)//?state=abc",
            "https://auth.example.com/authorize?state=abc&redirect_uri=https%3A%2F%2Fevil.example%2Fcb",
            "https://auth.example.com/authorize?state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcb",
            "https://auth.example.com/authorize?state=abc&redirect_uri=http%3A%2F%2Flocalhost.evil.com%3A1%2Fcb",
            "https://auth.example.com/authorize?state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%40evil.com%2Fcb",
        ] {
            assert!(auth_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn existing_names_are_plain_and_never_split_a_config_key() {
        assert!(existing_name("GitHub", true).is_ok());
        assert!(existing_name("a.b", false).is_ok());
        assert!(existing_name("a.b", true).is_err());
        for bad in ["", "-x", "a b", "a\nb", "a/b"] {
            assert!(existing_name(bad, false).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_url_that_would_leak_a_key_says_where_the_key_goes() {
        let e = url("https://example.com/mcp?token=abc")
            .unwrap_err()
            .to_string();
        assert!(e.contains("key field") && e.contains("keychain"), "{e}");
        assert!(!e.contains("abc"), "the credential is never echoed: {e}");
    }

    #[test]
    fn a_command_is_one_program_never_a_shell_string() {
        for ok in [
            "npx",
            "uvx",
            "python3",
            "node",
            "/usr/local/bin/my-server",
            "docker",
            "./server",
            "C:/tools/srv.exe",
        ] {
            assert!(command(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "npx -y foo",
            "npx\t-y",
            "npx;rm -rf",
            "a|b",
            "a&&b",
            "$(id)",
            "`id`",
            "a>b",
            "bash",
            "/bin/sh",
            "zsh",
            "cmd.exe",
            "powershell",
            "pwsh.exe",
            "env",
            "/usr/bin/env",
            "sudo",
            "xargs",
            "nohup",
            "-rf",
            "~/bin/x",
            "a\nb",
            "a\0b",
            "'x'",
            "a*",
        ] {
            assert!(command(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn arguments_are_a_vector_and_an_interpreter_gets_no_program_text() {
        assert!(args("npx", &["-y".into(), "firecrawl-mcp@3.40.0".into()]).is_ok());
        assert!(args("python3", &["-m".into(), "my_server".into()]).is_ok());
        assert!(
            args(
                "node",
                &["server.js".into(), "--port".into(), "3000".into()]
            )
            .is_ok()
        );
        for flag in ["-c", "-e", "-p", "--eval", "--print", "-E"] {
            assert!(
                args("python3", &[flag.into(), "import os".into()]).is_err(),
                "{flag}"
            );
            assert!(
                args("/usr/bin/node", &[flag.into(), "1".into()]).is_err(),
                "{flag}"
            );
            assert!(
                args("python3.12", &[flag.into(), "1".into()]).is_err(),
                "{flag}"
            );
        }
        // a program that is not an interpreter may use the same letters as an ordinary flag
        assert!(
            args(
                "docker",
                &["run".into(), "-e".into(), "A=1".into(), "img".into()]
            )
            .is_ok()
        );
        assert!(args("npx", &["a\nb".into()]).is_err());
        assert!(args("npx", &["a\0b".into()]).is_err());
        assert!(args("npx", &vec!["x".to_owned(); MAX_ARGS + 1]).is_err());
        assert!(args("npx", &["x".repeat(MAX_VALUE + 1)]).is_err());
    }

    #[test]
    fn argument_lines_are_not_split_on_spaces() {
        assert_eq!(
            arg_lines("-y\n\nfirecrawl-mcp@3.40.0\n/my folder/x\r\n"),
            vec!["-y", "firecrawl-mcp@3.40.0", "/my folder/x"]
        );
        assert_eq!(
            display_command("npx", &["-y".into(), "a b".into()]),
            "npx -y 'a b'"
        );
    }

    #[test]
    fn environment_names_cannot_change_how_a_program_loads() {
        for ok in ["FIRECRAWL_API_URL", "_x", "Debug1"] {
            assert!(env_name(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "1A",
            "A-B",
            "A B",
            "A=B",
            "LD_PRELOAD",
            "ld_library_path",
            "DYLD_INSERT_LIBRARIES",
            "PATH",
            "NODE_OPTIONS",
            "PYTHONPATH",
            "BASH_ENV",
        ] {
            assert!(env_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_key_is_never_a_literal_in_the_config() {
        assert!(env_value("FIRECRAWL_API_URL", "http://127.0.0.1:3002").is_ok());
        assert!(env_value("API_KEY", "${BOOPIS_X}").is_ok());
        assert!(env_value("API_KEY", "").is_ok());
        for bad in ["sk-live-123", "abc"] {
            let e = env_value("FIRECRAWL_API_KEY", bad).unwrap_err().to_string();
            assert!(e.contains("keychain"), "{e}");
            assert!(!e.contains(bad), "the value is never echoed: {e}");
        }
        assert!(env_value("MY_TOKEN", "a ${X} b").is_err());
        assert!(env_value("A", "x\ny").is_err());
    }

    #[test]
    fn headers_carry_no_keys() {
        assert!(plain_header("X-Tenant", "acme").is_ok());
        assert!(plain_header("Authorization", "Bearer ${BOOPIS_X}").is_ok());
        for (n, v) in [
            ("Authorization", "Bearer sk-live-123"),
            ("X-Api-Key", "abc"),
            ("Cookie", "s=1"),
            ("X-Custom", "Bearer abc"),
            ("X-Custom", "Basic dXNlcjpwdw=="),
            ("Bad Name", "x"),
            ("X", "a\r\nInjected: 1"),
        ] {
            assert!(plain_header(n, v).is_err(), "{n}: {v}");
        }
    }

    #[test]
    fn header_and_environment_lines_are_parsed_strictly() {
        assert_eq!(
            header_lines("# a comment\nX-Tenant: acme\n\nX-Region:eu").unwrap(),
            vec![
                ("X-Tenant".into(), "acme".into()),
                ("X-Region".into(), "eu".into())
            ]
        );
        assert!(header_lines("no colon here").is_err());
        assert!(header_lines("X-A: 1\nx-a: 2").is_err());
        assert_eq!(
            env_lines("A=1\n# c\nB = two").unwrap(),
            vec![("A".into(), "1".into()), ("B".into(), "two".into())]
        );
        assert!(env_lines("A=1\nA=2").is_err());
        assert!(env_lines("novalue").is_err());
        assert!(env_lines("LD_PRELOAD=/x.so").is_err());
        let many = (0..=MAX_PAIRS).fold(String::new(), |mut s, i| {
            let _ = writeln!(s, "V{i}=1");
            s
        });
        assert!(env_lines(&many).is_err());
    }
}
