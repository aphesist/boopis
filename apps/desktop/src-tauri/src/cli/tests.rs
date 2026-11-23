use super::*;
use crate::renderer::{Inputs, Policy};

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn the_arguments_pick_a_command() {
    assert_eq!(parse(&args(&[])), Command::Launch);
    assert_eq!(parse(&args(&["--version"])), Command::Version);
    assert_eq!(parse(&args(&["-V"])), Command::Version);
    assert_eq!(parse(&args(&["doctor"])), Command::Doctor);
    assert_eq!(parse(&args(&["--help"])), Command::Help);
    // A path or a link the system hands the app starts it.
    assert_eq!(parse(&args(&["/tmp/x.txt"])), Command::Launch);
    assert_eq!(parse(&args(&["boopis://open"])), Command::Launch);
    // An option that does not exist is an error, not a silent launch.
    assert_eq!(
        parse(&args(&["--verison"])),
        Command::Unknown("--verison".into())
    );
    assert_eq!(
        parse(&args(&["doctor", "--json"])),
        Command::Unknown("--json".into())
    );
}

/// The word of a command that talks to the engine, `None` for one that does not. Exhaustive on purpose: a new command does
/// not compile here until it is said whether it talks to the engine, and one that does must be in the help's table.
fn engine_word(c: &Command) -> Option<&'static str> {
    match c {
        Command::Groups(_) => Some("groups"),
        Command::Run(_) => Some("run"),
        Command::Team(_) => Some("team"),
        Command::Bots(_) => Some("bots"),
        Command::Connectors(_) => Some("connectors"),
        Command::Connect(_) => Some("connect"),
        Command::Launch
        | Command::Version
        | Command::Doctor
        | Command::Help
        | Command::Unknown(_) => None,
    }
}

#[test]
fn the_help_lists_exactly_the_commands_that_talk_to_the_engine() {
    let text = help_lines(&plain(), "0.1.0").join("\n");
    let mut seen = Vec::new();
    for page in help::PAGES {
        // the word is a command, the command its own, and the top of the help names it
        let made = parse(&args(&[page.word, "list"]));
        assert_eq!(engine_word(&made), Some(page.word), "{}", page.word);
        assert!(
            text.contains(&format!("  {PRODUCT} {:<14}{}", page.word, page.summary)),
            "boopis --help does not list {}:\n{text}",
            page.word
        );
        assert!(!seen.contains(&page.word), "{} is listed twice", page.word);
        seen.push(page.word);
    }
    // every command the exhaustive match calls an engine command is in the table
    for c in [
        Command::Groups(vec![]),
        Command::Run(vec![]),
        Command::Team(vec![]),
        Command::Bots(vec![]),
        Command::Connectors(vec![]),
        Command::Connect(vec![]),
    ] {
        let w = engine_word(&c).unwrap();
        assert!(seen.contains(&w), "{w} is a command the help does not list");
    }
    assert_eq!(seen.len(), 6);
    // no count to go stale: the text says which, not how many
    for stale in ["The four", "The six", "four that", "six that"] {
        assert!(!text.contains(stale), "{stale}");
    }
}

#[test]
fn every_command_and_subcommand_takes_help_and_asks_no_engine_for_it() {
    for page in help::PAGES {
        let w = page.word;
        for a in [
            &[w, "--help"][..],
            &[w, "-h"],
            &[w, "help"],
            &[w, "list", "--help"],
            &[w, "set", "kai", "-h"],
            &[w, "--bot", "kai", "--help"],
            &["help", w],
            &["--help", w],
        ] {
            assert_eq!(asks_help(&parse(&args(a))), Some(w), "{a:?}");
        }
        // after `--` it is a plain argument, and a word that only contains it is not it
        for a in [
            &[w, "send", "g", "--", "-h"][..],
            &[w, "send", "g", "fix -h"],
            &[w, "list"],
        ] {
            assert_eq!(asks_help(&parse(&args(a))), None, "{a:?}");
        }
        let lines = help::page_of(w);
        assert!(lines.len() > 2, "{w}");
        assert!(
            lines.iter().any(|l| l.contains(&format!("{PRODUCT} {w}"))),
            "{w}: {lines:?}"
        );
    }
    assert_eq!(asks_help(&parse(&args(&["--help"]))), None);
    assert_eq!(
        parse(&args(&["help", "nope"])),
        Command::Unknown("nope".into())
    );
}

fn fixture(unpacked: bool) -> Gathered {
    let gpus = vec![
        Gpu {
            card: "card0".into(),
            vendor: "0x8086".into(),
            driver: Some("i915".into()),
            boot_display: true,
        },
        Gpu {
            card: "card1".into(),
            vendor: "0x10de".into(),
            driver: Some("nvidia".into()),
            boot_display: false,
        },
    ];
    let webkit_info = webkit::Info {
        version: Some(webkit::Version::new(2, 52, 6)),
        origin: webkit::Origin::System,
        library: Some("/usr/lib/libwebkit2gtk-4.1.so.0".into()),
    };
    let inputs = Inputs {
        gpus: gpus.clone(),
        session: Session::Wayland,
        hyprland: true,
        policy: Policy::Auto,
        user_switches: vec![],
        webkit: webkit_info.clone(),
        offload: false,
    };
    let decision = renderer::decide(&inputs);
    let (gpu_inputs, gpu_decision) = gpu::plan(gpu::Inputs {
        gpus,
        session: Session::Wayland,
        webkit: webkit_info,
        power: gpu::PowerSource::Ac,
        policy: gpu::Policy::Auto,
        user_vars: vec![],
        switcheroo: None,
    });
    let gpu_report = gpu::report(
        &gpu_inputs,
        gpu::PolicySource::Default,
        &gpu_decision,
        gpu::PowerSource::Ac,
    );
    let mut report = renderer::report(&inputs, &decision, gpu_report);
    report.frame_rate = frame_rate::Report {
        rule: Some(frame_rate::decide(frame_rate::Policy::Auto, None).rule),
        ..frame_rate::Report::pending(frame_rate::Policy::Auto)
    };
    Gathered {
        report,
        fps_policy: frame_rate::Policy::Auto,
        platform_profile: Some("balanced".into()),
        runtime: RuntimeStatus::Bundled {
            hermes: "0.23.2".into(),
            python: "3.14.9".into(),
            root: "/nonexistent/runtime/0.23.2-abcdef12".into(),
            unpacked,
        },
        folders: vec![("data", "/nonexistent/boopis".into(), false)],
        last_webview: None,
    }
}

fn text(out: &Out, g: &Gathered) -> String {
    doctor_lines(out, "0.1.0", g).join("\n")
}

#[test]
fn doctor_has_every_section_the_task_names() {
    let t = text(&plain(), &fixture(true));
    for section in [
        "session",
        "gpus",
        "renderer",
        "gpu",
        "frame rate",
        "webkitgtk",
        "runtime",
        "folders",
    ] {
        assert!(t.lines().any(|l| l == section), "no section {section}\n{t}");
    }
    for needle in [
        "wayland (hyprland)",
        "card0  intel i915  display",
        "card1  nvidia nvidia",
        "BOOPIS_RENDERER=auto",
        "BOOPIS_GPU=auto (default)",
        "BOOPIS_FPS=auto",
        "2.52.6, the system's",
        "0.23.2, bundled",
        "unpacked and checked",
        "not created yet",
    ] {
        assert!(t.contains(needle), "{needle:?} missing\n{t}");
    }
    assert!(t.starts_with("b●●pis doctor 0.1.0"), "{t}");
}

#[test]
fn doctor_fits_in_seventy_eight_columns_apart_from_paths() {
    let t = text(&plain(), &fixture(false));
    for line in t.lines().filter(|l| !l.contains('/')) {
        assert!(line.chars().count() <= 78, "{line}");
    }
    assert!(t.contains("not unpacked yet"), "{t}");
}

#[test]
fn doctor_without_colour_has_no_escape_and_with_colour_has() {
    let g = fixture(true);
    assert!(!text(&plain(), &g).contains('\u{1b}'));
    let colour = Out::new(Caps {
        color: ColorLevel::TrueColor,
        unicode: true,
        interactive: true,
        animate: false,
    });
    let t = text(&colour, &g);
    assert!(
        t.contains("\u{1b}[38;2;47;210;106m✓"),
        "moss green for a good mark"
    );
}

#[test]
fn a_pipe_gets_text_not_a_logo_or_marks() {
    let pipe = Out::new(Caps {
        color: ColorLevel::None,
        unicode: true,
        interactive: false,
        animate: false,
    });
    let t = text(&pipe, &fixture(true));
    assert!(t.starts_with("boopis doctor"), "{t}");
    assert!(!t.contains('✓') && !t.contains('●'));
    assert!(t.contains("+ status"), "{t}");
}

#[test]
fn the_version_names_the_engine_and_webkitgtk() {
    let facts = Facts {
        hermes: Some("0.23.2".into()),
        webkit: webkit::Report {
            version: Some("2.52.6".into()),
            origin: webkit::Origin::Bundled,
            library: None,
        },
    };
    let t = version_lines(&plain(), "0.1.0", &facts).join("\n");
    assert_eq!(
        t,
        "b●●pis 0.1.0\n  engine     0.23.2, bundled\n  webkitgtk  2.52.6, bundled"
    );
    let none = Facts {
        hermes: None,
        webkit: webkit::Report {
            version: None,
            origin: webkit::Origin::Unknown,
            library: None,
        },
    };
    let t = version_lines(&plain(), "0.1.0", &none).join("\n");
    assert!(
        t.contains("not bundled in this build") && t.contains("webkitgtk  unknown"),
        "{t}"
    );
}

#[test]
fn power_saver_is_called_out() {
    let mut g = fixture(true);
    g.platform_profile = Some("low-power".into());
    g.report.frame_rate.power_profile = frame_rate::PowerProfile::PowerSaver;
    let t = text(&plain(), &g);
    assert!(t.contains("! profile      low-power"), "{t}");
    assert!(t.contains("power-saver halves"), "{t}");
}

#[test]
fn a_broken_runtime_is_a_failure_with_the_way_out() {
    let mut g = fixture(true);
    g.runtime = RuntimeStatus::Broken("runtime.json is not valid".into());
    let t = text(&plain(), &g);
    assert!(
        t.contains("✗ status       runtime.json is not valid"),
        "{t}"
    );
    assert!(t.contains("Reinstall boopis"), "{t}");
}

#[test]
fn only_commands_attach_to_the_parent_console() {
    // A normal launch of the window never touches the console; every command that prints does.
    assert!(!needs_console(&parse(&args(&[]))));
    assert!(!needs_console(&parse(&args(&["/tmp/x.txt"]))));
    assert!(!needs_console(&parse(&args(&["boopis://open"]))));
    for a in [&["--version"][..], &["doctor"], &["--help"], &["--nope"]] {
        assert!(needs_console(&parse(&args(a))), "{a:?}");
    }
}

#[test]
fn the_engine_flag_is_read_first_and_only_with_a_known_word() {
    let (choice, rest) = split_engine(&args(&["--engine", "existing"])).unwrap();
    assert_eq!(choice, Some(runtime::Source::Existing));
    assert!(rest.is_empty());
    assert_eq!(parse(&rest), Command::Launch);
    let (choice, rest) = split_engine(&args(&["--engine=bundled", "doctor"])).unwrap();
    assert_eq!(choice, Some(runtime::Source::Bundled));
    assert_eq!(parse(&rest), Command::Doctor);
    assert_eq!(
        split_engine(&args(&["--engine", "mine"])),
        Err("mine".to_owned())
    );
    assert_eq!(split_engine(&args(&["--engine"])), Err(String::new()));
    let (choice, rest) = split_engine(&args(&["doctor"])).unwrap();
    assert_eq!((choice, rest), (None, args(&["doctor"])));
}

/// `--version`, `doctor` and `--help` never name the engine (ADR-0031).
#[test]
fn no_command_names_the_engine() {
    let facts = Facts {
        hermes: Some("0.23.2".into()),
        webkit: webkit::Report {
            version: None,
            origin: webkit::Origin::Unknown,
            library: None,
        },
    };
    let mut all = version_lines(&plain(), "0.1.0", &facts);
    all.extend(doctor_lines(&plain(), "0.1.0", &fixture(true)));
    all.extend(help_lines(&plain(), "0.1.0"));
    for page in help::PAGES {
        all.extend(help::page_of(page.word));
    }
    let mut broken = fixture(true);
    broken.runtime = RuntimeStatus::Broken("the bundled Hermes runtime cannot be read".into());
    all.extend(doctor_lines(&plain(), "0.1.0", &broken));
    let mut existing = fixture(true);
    existing.runtime = RuntimeStatus::Existing {
        chosen: true,
        home: "/nonexistent/home".into(),
    };
    all.extend(doctor_lines(&plain(), "0.1.0", &existing));
    for line in all {
        assert!(!crate::error::names_engine(&line), "{line}");
    }
}
