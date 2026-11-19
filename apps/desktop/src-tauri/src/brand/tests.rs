use std::path::{Path, PathBuf};

use super::*;

fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    move |k| {
        pairs
            .iter()
            .find(|(n, _)| *n == k)
            .map(|(_, v)| (*v).to_owned())
    }
}

fn caps(pairs: &[(&str, &str)], tty: bool) -> Caps {
    Caps::detect(&env(pairs), tty)
}

/// The text of a line without its escape sequences.
fn visible(line: &str) -> String {
    let mut out = String::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for d in chars.by_ref() {
                if d.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packaging/brand/golden")
}

#[test]
fn the_shipped_art_is_valid() {
    let art = Art::shipped();
    assert_eq!(art.scenes(), ["banner", "bots"]);
    assert!(art.frame_count("banner") >= 8, "the banner animates");
    assert_eq!(art.text("compact"), Some("b●●pis"));
    assert_eq!(art.text("compact.ascii"), Some("boopis"));
}

#[test]
fn a_broken_file_says_which_line() {
    let e = Art::parse("format 1\ncolor ink -\nsprite a ink\n#x\nend\n").unwrap_err();
    assert_eq!((e.line, e.message.contains("not . # or o")), (4, true));
    let e = Art::parse("format 1\nsprite a nobody\n").unwrap_err();
    assert!(e.message.contains("no color named nobody"), "{e}");
    let e = Art::parse("color ink -\n").unwrap_err();
    assert!(e.message.contains("format 1"), "{e}");
    let e = Art::parse("format 1\ncolor ink -\nsprite a ink\n##\n#\nend\n").unwrap_err();
    assert!(e.message.contains("rectangle"), "{e}");
}

#[test]
fn an_animation_over_one_and_a_half_seconds_is_refused() {
    let text = "format 1\ncolor ink -\nsprite a ink\n#\nend\nscene s\nslot a 0 0 a\nend\nanim s\nframe 1000 a=a\nframe 501 a=a\nend\n";
    assert!(Art::parse(text).unwrap_err().message.contains("1.5 s"));
}

#[test]
fn the_shipped_animation_is_brief() {
    let art = Art::shipped();
    let total: u64 = (0..art.frame_count("banner"))
        .map(|i| u64::from(art.anims["banner"][i].ms))
        .sum();
    assert!(total <= 1500, "{total} ms");
}

#[test]
fn the_environment_decides_the_colour_level() {
    use ColorLevel::{Ansi16, Ansi256, None, TrueColor};
    type Row<'a> = (&'a [(&'a str, &'a str)], bool, ColorLevel);
    let rows: &[Row] = &[
        (
            &[("TERM", "xterm-256color"), ("COLORTERM", "truecolor")],
            true,
            TrueColor,
        ),
        (
            &[("TERM", "xterm"), ("COLORTERM", "24bit")],
            true,
            TrueColor,
        ),
        (&[("TERM", "xterm-256color")], true, Ansi256),
        (&[("TERM", "xterm")], true, Ansi16),
        (&[("TERM", "linux")], true, Ansi16),
        (&[("WT_SESSION", "x")], true, TrueColor),
        // NO_COLOR wins over everything; an empty one does not count (no-color.org).
        (
            &[
                ("TERM", "xterm"),
                ("COLORTERM", "truecolor"),
                ("NO_COLOR", "1"),
            ],
            true,
            None,
        ),
        (
            &[
                ("TERM", "xterm"),
                ("COLORTERM", "truecolor"),
                ("NO_COLOR", ""),
            ],
            true,
            TrueColor,
        ),
        (&[("TERM", "dumb"), ("COLORTERM", "truecolor")], true, None),
        (
            &[("TERM", "xterm"), ("COLORTERM", "truecolor")],
            false,
            None,
        ),
    ];
    for (vars, tty, want) in rows {
        assert_eq!(caps(vars, *tty).color, *want, "{vars:?} tty={tty}");
    }
}

#[test]
fn the_animation_needs_a_terminal_a_utf8_locale_and_no_switch_off() {
    let ok = [("TERM", "xterm-256color"), ("LANG", "en_US.UTF-8")];
    assert!(caps(&ok, true).animate);
    assert!(!caps(&ok, false).animate, "not a terminal");
    assert!(!caps(&[("TERM", "dumb"), ("LANG", "C.UTF-8")], true).animate);
    assert!(
        !caps(&[("TERM", "xterm"), ("LANG", "C")], true).animate,
        "not UTF-8"
    );
    assert!(
        !caps(
            &[("TERM", "xterm"), ("LANG", "C.UTF-8"), ("CI", "true")],
            true
        )
        .animate
    );
    assert!(
        !caps(
            &[
                ("TERM", "xterm"),
                ("LANG", "C.UTF-8"),
                ("BOOPIS_NO_ANIMATION", "1")
            ],
            true
        )
        .animate
    );
    // An empty or zero switch is "off", so the animation stays on.
    assert!(
        caps(
            &[
                ("TERM", "xterm"),
                ("LANG", "C.UTF-8"),
                ("BOOPIS_NO_ANIMATION", "0")
            ],
            true
        )
        .animate
    );
    // NO_COLOR is about colour only: the art can still move.
    assert!(
        caps(
            &[("TERM", "xterm"), ("LANG", "C.UTF-8"), ("NO_COLOR", "1")],
            true
        )
        .animate
    );
}

#[test]
fn the_locale_picks_unicode_in_the_order_all_ctype_lang() {
    assert!(caps(&[("LANG", "pt_BR.UTF-8")], true).unicode);
    assert!(caps(&[("LC_ALL", "en_US.utf8")], true).unicode);
    assert!(
        !caps(&[("LC_ALL", "C"), ("LANG", "en_US.UTF-8")], true).unicode,
        "LC_ALL wins"
    );
    assert!(!caps(&[], true).unicode);
}

#[test]
fn the_compact_logo_falls_back_to_ascii() {
    let art = Art::shipped();
    assert_eq!(
        art.compact(&caps(&[("LANG", "C.UTF-8"), ("TERM", "xterm")], true)),
        "b●●pis"
    );
    assert_eq!(art.compact(&caps(&[("LANG", "C")], true)), "boopis");
    assert_eq!(
        art.compact(&caps(&[("LANG", "C.UTF-8")], false)),
        "boopis",
        "a pipe gets text"
    );
}

#[test]
fn without_colour_there_is_no_escape_code_and_the_eyes_are_holes() {
    let art = Art::shipped();
    for scene in ["banner", "bots"] {
        for line in art.render(scene, None, ColorLevel::None).unwrap() {
            assert!(!line.contains('\u{1b}'), "{line:?}");
        }
    }
    // The first bot's eyes are the two middle cells: in colour they are drawn in the eye colour, in mono they are empty.
    let mono = art.render("bots", None, ColorLevel::None).unwrap();
    let colour = art.render("bots", None, ColorLevel::TrueColor).unwrap();
    assert_ne!(visible(&colour[2]), visible(&mono[2]));
}

#[test]
fn each_level_uses_its_own_kind_of_code() {
    let art = Art::shipped();
    let all = |l| art.render("bots", None, l).unwrap().join("\n");
    let (t, p, s) = (
        all(ColorLevel::TrueColor),
        all(ColorLevel::Ansi256),
        all(ColorLevel::Ansi16),
    );
    assert!(t.contains("38;2;79;201;168"), "kai's teal, exactly");
    assert!(!t.contains("38;5;"));
    assert!(p.contains("38;5;") && !p.contains("38;2;"));
    assert!(
        !s.contains("38;") && !s.contains("48;"),
        "16 colours use 30 to 37 and 90 to 97"
    );
    assert!(s.contains("\u{1b}[0;3") || s.contains("\u{1b}[0;9"));
    // The three levels draw the same shapes.
    assert_eq!(visible(&t), visible(&p));
    assert_eq!(visible(&t), visible(&s));
}

#[test]
fn nearest_colours() {
    assert_eq!(
        nearest_256((0x0f, 0x0e, 0x0c)),
        233,
        "the eye ink is a dark grey"
    );
    assert_eq!(nearest_256((255, 255, 255)), 231);
    assert_eq!(nearest_256((0, 0, 0)), 16);
    assert_eq!(nearest_16((0xf2, 0x3b, 0x5a)), 9);
    assert_eq!(nearest_16((0, 0, 0)), 0);
    assert_eq!(sgr((10, 20, 30), true, ColorLevel::None), "");
    assert_eq!(sgr((205, 0, 0), false, ColorLevel::Ansi16), "41");
    assert_eq!(sgr((255, 0, 0), true, ColorLevel::Ansi16), "91");
}

#[test]
fn the_art_fits_in_eighty_columns_in_every_frame() {
    let art = Art::shipped();
    let mut frames = vec![None];
    frames.extend((0..art.frame_count("banner")).map(Some));
    let mut banner_width = 0;
    for f in frames {
        let lines = art.render("banner", f, ColorLevel::TrueColor).unwrap();
        for l in &lines {
            let w = visible(l).chars().count();
            banner_width = banner_width.max(w);
            assert!(w <= 78, "frame {f:?} is {w} columns: {l:?}");
        }
    }
    // The wordmark and the bots share one width, so the banner is 62 columns with 2 of indent.
    assert_eq!(banner_width, 62);
}

#[test]
fn the_animation_never_changes_the_size_of_the_picture() {
    let art = Art::shipped();
    let n = art.render("banner", None, ColorLevel::None).unwrap().len();
    for i in 0..art.frame_count("banner") {
        assert_eq!(
            art.render("banner", Some(i), ColorLevel::None)
                .unwrap()
                .len(),
            n
        );
    }
}

#[test]
fn the_ink_is_plain_text_without_colour() {
    let off = Ink::new(ColorLevel::None);
    for tone in [Tone::Strong, Tone::Dim, Tone::Ok, Tone::Warn, Tone::Fail] {
        assert_eq!(off.paint(tone, "x"), "x");
    }
    let on = Ink::new(ColorLevel::TrueColor);
    assert_eq!(on.paint(Tone::Ok, "x"), "\u{1b}[38;2;47;210;106mx\u{1b}[0m");
    assert_eq!(on.paint(Tone::Strong, "x"), "\u{1b}[1mx\u{1b}[0m");
}

/// Every golden file is `<scene>[.f<frame>].<level>.txt`. `UPDATE_GOLDEN=1 cargo test -p hypotaxis-host brand` rewrites
/// them; `scripts/test-brand.sh` checks that the awk renderer in `install.sh` produces the same bytes.
fn golden_cases() -> Vec<(String, String, Option<usize>, &'static str)> {
    let mut v = Vec::new();
    for level in ["truecolor", "256", "16", "mono"] {
        v.push((
            format!("banner.{level}.txt"),
            "banner".to_owned(),
            None,
            level,
        ));
        v.push((format!("bots.{level}.txt"), "bots".to_owned(), None, level));
    }
    // A glance and a hop, in the levels that differ most.
    v.push((
        "banner.f2.truecolor.txt".into(),
        "banner".into(),
        Some(2),
        "truecolor",
    ));
    v.push(("banner.f7.256.txt".into(), "banner".into(), Some(7), "256"));
    v
}

#[test]
fn the_goldens_are_what_the_renderer_draws() {
    let art = Art::shipped();
    let update = std::env::var_os("UPDATE_GOLDEN").is_some();
    for (file, scene, frame, level) in golden_cases() {
        let lines = art
            .render(&scene, frame, ColorLevel::parse(level).unwrap())
            .unwrap();
        let text = lines.join("\n") + "\n";
        let path = golden_dir().join(&file);
        if update {
            std::fs::create_dir_all(golden_dir()).unwrap();
            std::fs::write(&path, &text).unwrap();
        }
        let want = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            want == text,
            "{file} is stale: run `UPDATE_GOLDEN=1 cargo test -p hypotaxis-host brand`"
        );
    }
}
