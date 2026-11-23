//! Who a room message names, by the engine's own rule (`apps/shared/data/room-mentions.json`, the one copy of the rule that
//! the host and the UI both read). The engine matches `@([A-Za-z0-9][A-Za-z0-9._:-]*)` case-insensitively, non-overlapping
//! and left to right; a handle is the whole run after the `@`; `@all` and `@everyone` name every member; the human is named
//! `user` in every member's prompt and has no handle of its own, so `@user` addresses the human unless a member holds that
//! handle. No regex crate: the scanner below is that pattern, and a test keeps it equal to the data file's.

/// The engine's mention pattern, as the data file states it (the scanner implements exactly this).
pub const PATTERN: &str = "@([A-Za-z0-9][A-Za-z0-9._:-]*)";
/// The handles that name every member of a room.
pub const EVERYONE: [&str; 2] = ["all", "everyone"];
/// The name the engine gives the human in a room's transcript.
pub const USER: &str = "user";

fn first(b: u8) -> bool {
    b.is_ascii_alphanumeric()
}

fn rest(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-')
}

/// The handles a text mentions, lowercased, in order, each once.
#[must_use]
pub fn handles(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' && bytes.get(i + 1).is_some_and(|b| first(*b)) {
            let start = i + 1;
            let mut end = start + 1;
            while end < bytes.len() && rest(bytes[end]) {
                end += 1;
            }
            // The run is ASCII by construction, so the slice is on character boundaries.
            let handle = text[start..end].to_ascii_lowercase();
            if !out.contains(&handle) {
                out.push(handle);
            }
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

/// Whether a text names every member (`@all`, `@everyone`).
#[must_use]
pub fn names_everyone(text: &str) -> bool {
    handles(text).iter().any(|h| EVERYONE.contains(&h.as_str()))
}

/// Whether a text addresses the human: it mentions `@user` and no member of the room holds that handle.
#[must_use]
pub fn addresses_user(text: &str, member_handles: &[&str]) -> bool {
    if member_handles.iter().any(|m| m.eq_ignore_ascii_case(USER)) {
        return false;
    }
    handles(text).iter().any(|h| h == USER)
}

/// The bots a text mentions that are not in the room: each handle that is not a member's, not `@all` or `@everyone`, and
/// is the name of a bot that exists (`known`). A handle nobody has is not an outsider (the engine ignores it as well).
#[must_use]
pub fn outsiders<'a>(text: &str, member_handles: &[&str], known: &'a [String]) -> Vec<&'a str> {
    let mut out = Vec::new();
    for h in handles(text) {
        if EVERYONE.contains(&h.as_str())
            || member_handles.iter().any(|m| m.eq_ignore_ascii_case(&h))
        {
            continue;
        }
        if let Some(bot) = known.iter().find(|k| k.eq_ignore_ascii_case(&h))
            && !out.contains(&bot.as_str())
        {
            out.push(bot.as_str());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULE: &str = include_str!("../../../../shared/data/room-mentions.json");

    #[test]
    fn the_scanner_is_the_data_files_rule() {
        let v: serde_json::Value = serde_json::from_str(RULE).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(
            v["pattern"], PATTERN,
            "the scanner implements this pattern; change both together"
        );
        assert_eq!(v["ignore_case"], true);
        assert_eq!(v["everyone"], serde_json::json!(EVERYONE));
        assert_eq!(v["user"], USER);
    }

    #[test]
    fn handles_are_matched_as_the_engine_matches_them() {
        assert_eq!(handles("@Kai and @nina, ask @KAI"), ["kai", "nina"]);
        assert_eq!(handles("@kai. then"), ["kai."], "the run includes the dot");
        assert_eq!(
            handles("mail a@b.com"),
            ["b.com"],
            "no word boundary before the @"
        );
        assert_eq!(handles("@@moss"), ["moss"]);
        assert_eq!(
            handles("@-x @_y @ z @"),
            Vec::<String>::new(),
            "the first character is a letter or digit"
        );
        assert_eq!(handles("@a:b-c_d.e"), ["a:b-c_d.e"]);
        assert_eq!(handles("é@kai"), ["kai"], "text around it may be anything");
    }

    #[test]
    fn the_human_is_addressed_by_user_unless_a_member_holds_it() {
        assert!(addresses_user("@user can you check?", &["kai", "nina"]));
        assert!(
            !addresses_user("Thanks @User.", &["kai"]),
            "\"User.\" is another handle"
        );
        assert!(addresses_user("thanks @USER", &["kai"]));
        assert!(
            !addresses_user("@all done", &["kai"]),
            "@all names the members, not the human"
        );
        assert!(
            !addresses_user("the user wants it", &["kai"]),
            "words are not a mention"
        );
        assert!(
            !addresses_user("@user hi", &["user", "kai"]),
            "a member named user takes it"
        );
    }

    #[test]
    fn outsiders_are_known_bots_that_are_not_seated() {
        let known: Vec<String> = ["kai", "nina", "moss", "nimbus"].map(String::from).to_vec();
        let members = ["kai", "nina"];
        assert_eq!(
            outsiders("@moss please confirm, @kai too", &members, &known),
            ["moss"]
        );
        assert_eq!(
            outsiders("@nobody @all @everyone @user", &members, &known),
            Vec::<&str>::new()
        );
        assert_eq!(
            outsiders("@nimbus. and @Moss", &members, &known),
            ["moss"],
            "\"@nimbus.\" names nobody"
        );
        assert!(names_everyone("@everyone listen"));
    }
}
