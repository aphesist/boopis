//! The commands that talk to the engine, as one table: the word that names each, what it builds, a line for `boopis --help`
//! and the page `boopis <command> --help` prints. `parse` reads this table and `--help` lists it, so a command cannot exist
//! without being listed, or be listed without existing (a test checks both).
//!
//! A page asks nothing of the engine: `--help` (or `-h`, anywhere before a `--`, or `help` as the first word after the
//! command) prints and exits 0 before any link is opened.

use super::{Command, PRODUCT};

/// One command that talks to the engine.
pub struct Page {
    /// The word that names it.
    pub word: &'static str,
    /// What `parse` makes of the word and the arguments after it.
    pub make: fn(Vec<String>) -> Command,
    /// Its line in `boopis --help`.
    pub summary: &'static str,
    /// Its page: the usage lines and what they mean.
    pub lines: fn() -> Vec<String>,
}

/// Every command that talks to the engine, in the order `boopis --help` lists them.
pub const PAGES: &[Page] = &[
    Page {
        word: "groups",
        make: Command::Groups,
        summary: "list, create, send to and read the log of group chats",
        lines: groups,
    },
    Page {
        word: "run",
        make: Command::Run,
        summary: "run a task through a group, or with one bot, to its end",
        lines: run,
    },
    Page {
        word: "bots",
        make: Command::Bots,
        summary: "list, create and change bots",
        lines: bots,
    },
    Page {
        word: "team",
        make: Command::Team,
        summary: "check, apply or export a whole team as one file",
        lines: team,
    },
    Page {
        word: "connectors",
        make: Command::Connectors,
        summary: "list, add, test and remove connectors, the main profile's or one bot's",
        lines: connectors,
    },
    Page {
        word: "connect",
        make: Command::Connect,
        summary: "say how to dial the engine's gateway, for another client of yours",
        lines: connect,
    },
];

/// The page of the command named `word`.
#[must_use]
pub fn find(word: &str) -> Option<&'static Page> {
    PAGES.iter().find(|p| p.word == word)
}

/// Whether the arguments after a command ask for its page: `--help` or `-h` before a `--`, or `help` as the first word.
#[must_use]
pub fn asked(rest: &[String]) -> bool {
    rest.first().is_some_and(|a| a == "help")
        || rest
            .iter()
            .take_while(|a| *a != "--")
            .any(|a| a == "--help" || a == "-h")
}

/// The page of `word` with its heading, as printed.
#[must_use]
pub fn page_of(word: &str) -> Vec<String> {
    let Some(p) = find(word) else {
        return Vec::new();
    };
    let mut out = vec![
        format!("{PRODUCT} {}: {}", p.word, p.summary),
        String::new(),
    ];
    out.extend((p.lines)());
    out
}

/// The sentence a usage mistake ends with.
#[must_use]
pub fn hint(word: &str) -> String {
    format!("{PRODUCT} {word} --help lists what it takes")
}

const EXITS: &str =
    "Exit codes: 0 done, 1 failed, 2 a usage mistake, 3 stopped at a cap, 4 a bot needs you.";

fn lines(text: &[&str]) -> Vec<String> {
    text.iter().map(|l| (*l).replace("{p}", PRODUCT)).collect()
}

fn groups() -> Vec<String> {
    lines(&[
        "  {p} groups list [--all] [--json]",
        "  {p} groups create \"<name>\" <bot> <bot> [<bot>...] [--lead <bot>] [--purpose FILE] [--max-rounds N] [--json]",
        "  {p} groups send <group> <text...> [--file FILE] [--wait] [--json]",
        "  {p} groups log <group> [--since SEQ] [--last N] [--follow [--for SECONDS]] [--json]",
        "  {p} groups set <group> [--max-rounds N|default] [--json]",
        "",
        "A <group> is its id or its name. The text of send may be - to read standard input.",
        EXITS,
    ])
}

fn run() -> Vec<String> {
    lines(&[
        "  {p} run --group <group> \"<task>\" [--max-rounds N] [--timeout MINUTES] [--to-board <board>] [--file FILE] [--json]",
        "  {p} run --bot <bot> \"<task>\" [--max-turns N] [--timeout MINUTES] [--file FILE] [--json]",
        "",
        "It prints every reply as it arrives and ends with one line that says why it stopped.",
        EXITS,
    ])
}

fn bots() -> Vec<String> {
    lines(&[
        "  {p} bots list [--json]",
        "  {p} bots create <name> [--role TEXT] [--soul-file FILE|-] [--model MODEL] [--shape SHAPE --color #rrggbb]",
        "                         [--governed] [--max-turns N] [--json]",
        "  {p} bots set <name> [--role TEXT] [--soul-file FILE|-] [--model MODEL] [--shape SHAPE] [--color #rrggbb]",
        "                      [--governed|--ungoverned] [--max-turns N|default] [--json]",
        "",
        "A model is opus (on the provider the app uses) or provider/model.",
        "Exit codes: 0 done, 1 failed, 2 a usage mistake.",
    ])
}

fn team() -> Vec<String> {
    lines(&[
        "  {p} team check <file>",
        "  {p} team apply <file> [--dry-run] [--prune] [--json]",
        "  {p} team export [--output FILE [--force]] [--json]",
        "",
        "apply creates what is missing and updates what differs; it never removes anything without --prune.",
        "Exit codes: 0 done (or nothing to do), 1 a problem in the plan or an action that failed, 2 a usage mistake.",
    ])
}

fn connectors() -> Vec<String> {
    let mut out = super::connectors::usage(PRODUCT);
    out.extend(lines(&[
        "",
        "Exit codes: 0 done, 1 failed, 2 a usage mistake, 3 waiting for --yes.",
    ]));
    out
}

fn connect() -> Vec<String> {
    crate::local_api::connect::usage()
        .lines()
        .map(str::to_owned)
        .collect()
}
