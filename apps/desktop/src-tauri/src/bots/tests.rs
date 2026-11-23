//! `prepare`, `release` and `repair` over a temporary engine home shaped like the owner's (22 November 2026): six bots made in
//! boopis 0.1.7 on the Claude subscription, each with the owner's own absolute link to the subscription plugin in its
//! `plugins/`, their six hand-made `hosted_rooms.profiles` entries in the root, every bot's record saying "governed" (the old
//! default), and the engine's macOS skills in every bot. The engine is an in-memory double of its CLI and gateway.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::*;

const SUB: &str = "claude-subscription-directsdk-experimental";
const CARRIED: &[&str] = &[SUB, "github-copilot", "grok-acp"];
const TEAM: &[(&str, &str)] = &[
    ("kai", "opus"),
    ("nina", "sonnet"),
    ("moss", "sonnet"),
    ("iris", "sonnet"),
    ("hex", "haiku"),
    ("nimbus", "haiku"),
];

/// What the double saw, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Did {
    Set(String, String, String),
    Unset(String, String),
    Enable(String, String),
    Call(String),
    Reload(String),
    Restart,
}

/// The engine, in memory: one configuration tree per home, the plugin's records by bot, and a log.
#[allow(clippy::struct_excessive_bools)] // independent switches of the double
struct Fake {
    config: Mutex<BTreeMap<PathBuf, Value>>,
    records: Mutex<BTreeMap<String, Value>>,
    /// The bots `bots.guide` was asked for, in order.
    guided: Mutex<Vec<String>>,
    log: Mutex<Vec<Did>>,
    reload_works: bool,
    busy: bool,
    /// An older plugin, without `bots.guide` (switched while a service holds the engine, as an update does).
    no_guide: std::sync::atomic::AtomicBool,
    /// The live kanban boards, `(slug, name)`, and who each board's cards are assigned to.
    boards: Mutex<Vec<(String, String)>>,
    assignees: Mutex<BTreeMap<String, Vec<String>>>,
    /// The groups (`groups.list`'s `rooms`).
    rooms: Mutex<Value>,
    /// Each bot's toolsets as `bots.toolsets` left them: name to whether it is on.
    toolsets: Mutex<BTreeMap<String, BTreeMap<String, bool>>>,
    /// The boards cannot be read.
    boards_fail: bool,
    /// What `bots.read` says is wrong with a bot's project folder.
    project_problems: Mutex<BTreeMap<String, String>>,
}

fn walk<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    key.split('.').try_fold(v, |at, k| at.get(k))
}

fn put(v: &mut Value, key: &str, value: Value) {
    let parts: Vec<&str> = key.split('.').collect();
    let mut at = v;
    for k in &parts[..parts.len() - 1] {
        if !at.get(*k).is_some_and(Value::is_object) {
            at[*k] = json!({});
        }
        at = at.get_mut(*k).unwrap();
    }
    at[parts[parts.len() - 1]] = value;
}

fn drop_key(v: &mut Value, key: &str) {
    let (parent, last) = key.rsplit_once('.').unwrap_or(("", key));
    let target = if parent.is_empty() {
        Some(v)
    } else {
        parent.split('.').try_fold(v, |at, k| at.get_mut(k))
    };
    if let Some(Value::Object(m)) = target {
        m.remove(last);
    }
}

impl Fake {
    fn new() -> Self {
        Self {
            config: Mutex::new(BTreeMap::new()),
            records: Mutex::new(BTreeMap::new()),
            guided: Mutex::new(Vec::new()),
            log: Mutex::new(Vec::new()),
            reload_works: true,
            busy: false,
            no_guide: std::sync::atomic::AtomicBool::new(false),
            boards: Mutex::new(Vec::new()),
            assignees: Mutex::new(BTreeMap::new()),
            rooms: Mutex::new(json!([])),
            toolsets: Mutex::new(BTreeMap::new()),
            boards_fail: false,
            project_problems: Mutex::new(BTreeMap::new()),
        }
    }
    fn seed(&self, home: &Path, config: Value) {
        self.config
            .lock()
            .unwrap()
            .insert(home.to_path_buf(), config);
    }
    fn get(&self, home: &Path, key: &str) -> Option<Value> {
        self.config
            .lock()
            .unwrap()
            .get(home)
            .and_then(|c| walk(c, key).cloned())
    }
    fn writes(&self) -> Vec<Did> {
        self.log
            .lock()
            .unwrap()
            .iter()
            .filter(
                |d| !matches!(d, Did::Call(m) if m.ends_with("bots.read") || m == "groups.list"),
            )
            .cloned()
            .collect()
    }
    fn clear(&self) {
        self.log.lock().unwrap().clear();
    }
}

#[async_trait]
impl Engine for Fake {
    async fn config_get(&self, home: &Path, key: &str) -> Result<Option<Value>> {
        Ok(self.get(home, key))
    }
    async fn config_set(&self, home: &Path, key: &str, value: &str) -> Result<()> {
        // the engine's coercion: JSON where it parses, text otherwise
        let parsed =
            serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.to_owned()));
        let mut all = self.config.lock().unwrap();
        put(
            all.entry(home.to_path_buf()).or_insert_with(|| json!({})),
            key,
            parsed,
        );
        self.log.lock().unwrap().push(Did::Set(
            home.display().to_string(),
            key.to_owned(),
            value.to_owned(),
        ));
        Ok(())
    }
    async fn config_unset(&self, home: &Path, key: &str) -> Result<()> {
        if let Some(c) = self.config.lock().unwrap().get_mut(home) {
            drop_key(c, key);
        }
        self.log
            .lock()
            .unwrap()
            .push(Did::Unset(home.display().to_string(), key.to_owned()));
        Ok(())
    }
    async fn enable_plugin(&self, home: &Path, name: &str) -> Result<()> {
        {
            let mut all = self.config.lock().unwrap();
            let c = all.entry(home.to_path_buf()).or_insert_with(|| json!({}));
            let mut list = walk(c, "plugins.enabled")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if !list.iter().any(|v| v == name) {
                list.push(json!(name));
            }
            put(c, "plugins.enabled", Value::Array(list));
        }
        self.log
            .lock()
            .unwrap()
            .push(Did::Enable(home.display().to_string(), name.to_owned()));
        Ok(())
    }
    async fn call(&self, _root: &Path, method: &str, params: Value) -> Result<Value> {
        self.log.lock().unwrap().push(Did::Call(method.to_owned()));
        let mut records = self.records.lock().unwrap();
        match method {
            "plugin.boopis.bots.read" => {
                let problems = self.project_problems.lock().unwrap();
                Ok(
                    json!({"bots": records.iter().map(|(n, r)| json!({"name": n, "record": r, "project_problem": problems.get(n)})).collect::<Vec<_>>()}),
                )
            }
            "plugin.boopis.bots.write" => {
                let name = params["name"].as_str().unwrap().to_owned();
                let r = records.entry(name).or_insert_with(|| json!({}));
                if let Some(s) = params.get("settings").and_then(Value::as_object) {
                    for (k, v) in s {
                        put(r, &format!("settings.{k}"), v.clone());
                    }
                }
                Ok(json!({"record": r.clone()}))
            }
            "plugin.boopis.bots.guide"
                if !self.no_guide.load(std::sync::atomic::Ordering::SeqCst) =>
            {
                let name = params["name"].as_str().unwrap().to_owned();
                let mut guided = self.guided.lock().unwrap();
                let fresh = !guided.contains(&name);
                guided.push(name);
                Ok(json!({"skill": "boopis-handoffs", "version": 2, "written": fresh}))
            }
            "groups.list" => Ok(json!({"rooms": self.rooms.lock().unwrap().clone()})),
            "plugin.boopis.bots.toolsets" => {
                let name = params["name"].as_str().unwrap().to_owned();
                let mut all = self.toolsets.lock().unwrap();
                let bot = all.entry(name).or_default();
                for (key, on) in [("on", true), ("off", false)] {
                    for t in params[key].as_array().unwrap() {
                        bot.insert(t.as_str().unwrap().to_owned(), on);
                    }
                }
                Ok(json!({"on": params["on"], "off": params["off"]}))
            }
            other => Err(Error::Unavailable(format!("the double has no {other}"))),
        }
    }
    async fn reload_plugins(&self, _root: &Path, home: &Path) -> Result<()> {
        self.log
            .lock()
            .unwrap()
            .push(Did::Reload(home.display().to_string()));
        if self.reload_works {
            Ok(())
        } else {
            Err(Error::Unavailable("no control socket here".into()))
        }
    }
    async fn restart_when_idle(&self, _root: &Path) -> Result<bool> {
        self.log.lock().unwrap().push(Did::Restart);
        Ok(!self.busy)
    }
    async fn boards(&self, _root: &Path) -> Result<Vec<(String, String)>> {
        if self.boards_fail {
            return Err(Error::Unavailable("the board could not be read".into()));
        }
        Ok(self.boards.lock().unwrap().clone())
    }
    async fn board_assignees(&self, _root: &Path, slug: &str) -> Result<Vec<String>> {
        Ok(self
            .assignees
            .lock()
            .unwrap()
            .get(slug)
            .cloned()
            .unwrap_or_default())
    }
}

fn plugin(dir: &Path, version: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("plugin.yaml"),
        format!(
            "name: {}\nversion: {version}\n",
            dir.file_name().unwrap().to_string_lossy()
        ),
    )
    .unwrap();
    std::fs::write(dir.join("__init__.py"), "").unwrap();
}

struct Home {
    _tmp: tempfile::TempDir,
    root: PathBuf,
}

impl Home {
    fn bot(&self, name: &str) -> PathBuf {
        self.root.join("profiles").join(name)
    }
}

/// The owner's engine folder, as their files show it.
fn owners_home(fake: &Fake) -> Home {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(tmp.path()).unwrap().join("engine");
    for p in std::iter::once(&BOOPIS).chain(CARRIED) {
        plugin(&root.join("plugins").join(p), "1.0.0");
    }
    std::fs::create_dir_all(root.join("boopis/bin")).unwrap();
    std::fs::write(crate::setup::install::hx_target(&root), "hx").unwrap();
    let mut rooms = serde_json::Map::new();
    for (name, model) in TEAM {
        let home = root.join("profiles").join(name);
        for f in [
            "config.yaml",
            "SOUL.md",
            "profile.yaml",
            "state.db",
            ".env",
            "gateway.lock",
        ] {
            std::fs::create_dir_all(&home).unwrap();
            std::fs::write(home.join(f), "").unwrap();
        }
        for d in ["cron", "runtime", "boopis"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
        }
        // the engine's bundled skills, the mac ones among them, with the engine's list of them; and one from the store
        std::fs::create_dir_all(home.join("skills")).unwrap();
        std::fs::write(
            home.join("skills/.bundled_manifest"),
            "apple-notes:a969\nimessage:f545\narxiv:1f2a\nhermes-agent:a6fb\nsdlc-review:4a4b\n",
        )
        .unwrap();
        for (skill, fm) in [
            ("apple/apple-notes", "platforms: [macos]"),
            ("apple/imessage", "platforms: [macos]"),
            ("research/arxiv", "name: arxiv"),
            ("autonomous-ai-agents/hermes-agent", "name: hermes-agent"),
            ("devops/sdlc-review", "name: sdlc-review"),
            ("papercraft", "name: papercraft"),
        ] {
            std::fs::create_dir_all(home.join("skills").join(skill)).unwrap();
            std::fs::write(
                home.join("skills").join(skill).join("SKILL.md"),
                format!("---\n{fm}\n---\n"),
            )
            .unwrap();
        }
        // the owner's workaround: an absolute link to the subscription plugin
        std::fs::create_dir_all(home.join("plugins")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            root.join("plugins").join(SUB),
            home.join("plugins").join(SUB),
        )
        .unwrap();
        #[cfg(not(unix))]
        plugin(&home.join("plugins").join(SUB), "1.0.0");
        let mut cfg = json!({
            "_config_version": 53,
            "model": {"provider": SUB, "default": model},
            "platform_toolsets": {"cli": ["browser", "computer_use", "terminal", "file", "web"]},
            "known_plugin_toolsets": {"cli": ["a2a"]},
        });
        if *name == "kai" || *name == "nina" {
            cfg["mcp_servers"] = json!({"fetch": {"command": "uvx", "args": ["mcp-server-fetch==2026.11.18"], "enabled": true}});
        }
        fake.seed(&home, cfg);
        rooms.insert((*name).to_owned(), json!(home.display().to_string()));
        fake.records.lock().unwrap().insert(
            (*name).to_owned(),
            json!({"look": {"shape": "circle"}, "settings": {"gov": "governed", "cap": "0.60", "workspace": "worktree"}}),
        );
    }
    fake.seed(
        &root,
        json!({
            "gateway": {"multiplex_profiles": true},
            "model": {"provider": SUB, "default": "opus"},
            "plugins": {"enabled": ["boopis"], "entries": {"boopis": {"allow_gateway_injection": true, "settings": {
                "hx_path": crate::setup::install::hx_target(&root).display().to_string(),
                "ladder": {"tiers": [{"model": format!("{SUB}/opus"), "name": "opus"}]}}}}},
            "tools": {"tool_search": {"enabled": "off"}},
            "delegation": {"backend": "boopis"},
            "hosted_rooms": {"profiles": Value::Object(rooms)},
        }),
    );
    Home { _tmp: tmp, root }
}

fn layout_of(home: &Home, strategy: Strategy) -> Layout {
    let carried: Vec<String> = CARRIED.iter().map(|s| (*s).to_owned()).collect();
    let mut l = Layout::new(home.root.clone(), &carried);
    l.strategy = strategy;
    l.system = "linux".into();
    l
}

#[tokio::test]
async fn the_owners_home_is_repaired_once_and_their_fixes_are_kept() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    let done = repair(&fake, &layout).await.unwrap();
    assert!(done.problems.is_empty(), "{:?}", done.problems);
    assert_eq!(done.bots.len(), 6);
    // Every bot is ungoverned now, in its record and in its plugin's mode, and one notice names them all.
    assert_eq!(done.ungoverned.len(), 6);
    let notice = take_notice(&home.root).unwrap().unwrap();
    for (name, _) in TEAM {
        assert!(notice.contains(name), "{notice}");
        assert_eq!(
            fake.records.lock().unwrap()[*name]["settings"]["gov"],
            "ungoverned"
        );
        let bot = home.bot(name);
        assert_eq!(
            fake.get(&bot, "plugins.entries.boopis.settings.mode"),
            Some(json!("ungoverned"))
        );
        // boopis, enabled, with the root's hx and the settings the user agreed to
        assert!(is_enabled(fake.get(&bot, "plugins").as_ref(), BOOPIS));
        assert_eq!(
            fake.get(&bot, "plugins.entries.boopis.settings.hx_path"),
            Some(json!(layout.hx().display().to_string()))
        );
        assert_eq!(fake.get(&bot, "delegation.backend"), Some(json!("boopis")));
        assert_eq!(
            fake.get(&bot, "tools.tool_search.enabled"),
            Some(json!("off"))
        );
        // every plugin the root has reaches the bot; the owner's own link is the one it had
        for p in std::iter::once(&BOOPIS).chain(CARRIED) {
            assert_eq!(
                std::fs::canonicalize(bot.join("plugins").join(p)).unwrap(),
                std::fs::canonicalize(home.root.join("plugins").join(p)).unwrap(),
                "{name}/{p}"
            );
        }
        #[cfg(unix)]
        assert_eq!(
            std::fs::read_link(bot.join("plugins").join(SUB)).unwrap(),
            home.root.join("plugins").join(SUB),
            "the owner's absolute link is left as it was"
        );
        // the mac skills are off, and the bundled ones outside the default index; the index's and the store's stay on
        assert_eq!(
            fake.get(&bot, "skills.disabled"),
            Some(json!(["apple-notes", "arxiv", "imessage"]))
        );
        // their MCP connector is untouched
        if *name == "kai" || *name == "nina" {
            assert!(fake.get(&bot, "mcp_servers.fetch").is_some());
        }
    }
    // every bot got its role's toolsets, once; none is on a board, so none has kanban
    for (name, _) in TEAM {
        let tools = fake.toolsets.lock().unwrap()[*name].clone();
        for t in &toolsets::defaults().on {
            assert_eq!(tools.get(t), Some(&true), "{name} {t}");
        }
        assert_eq!(tools.get("kanban"), Some(&false), "{name}");
        assert_eq!(tools.get("browser"), Some(&false), "{name}");
    }
    // every bot got the hand-off skill, once
    let mut guided = fake.guided.lock().unwrap().clone();
    guided.sort();
    let mut team: Vec<String> = TEAM.iter().map(|(n, _)| (*n).to_owned()).collect();
    team.sort();
    assert_eq!(guided, team);
    assert!(done.bots.iter().all(|b| b.handoffs));
    // kai runs on opus, a frontier model: its ladder is its own model; the others get none
    assert_eq!(
        fake.get(&home.bot("kai"), "plugins.entries.boopis.settings.ladder"),
        Some(json!({"tiers": [{"name": "opus", "model": format!("{SUB}/opus")}]}))
    );
    assert_eq!(
        fake.get(&home.bot("hex"), "plugins.entries.boopis.settings.ladder"),
        None
    );
    // the owner's room entries were right: none was written
    let root = home.root.display().to_string();
    assert!(
        !fake
            .writes()
            .iter()
            .any(|d| matches!(d, Did::Set(h, k, _) if *h == root && k.starts_with("hosted_rooms"))),
        "{:?}",
        fake.writes()
    );
    assert!(done.bots.iter().all(|b| !b.seated));
    assert!(done.released.is_empty());
    // enabling the plugin made the gateway load it, so nothing restarted
    assert!(!done.restarted);
    assert!(!fake.writes().contains(&Did::Restart));

    // A second start changes nothing, and reads none of the bots again.
    fake.clear();
    let again = repair(&fake, &layout).await.unwrap();
    assert!(again.bots.is_empty(), "{:?}", again.bots);
    assert!(fake.writes().is_empty(), "{:?}", fake.writes());
    assert_eq!(
        take_notice(&home.root).unwrap(),
        None,
        "the notice is shown once"
    );
}

#[tokio::test]
async fn a_governed_bot_turned_on_later_stays_governed() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    repair(&fake, &layout).await.unwrap();
    // the owner turns Governed on for kai (opus) in its settings; the app then prepares it
    fake.records.lock().unwrap().get_mut("kai").unwrap()["settings"]["gov"] = json!("governed");
    let mut view = RootView::read(&fake, &home.root).await.unwrap();
    let done = prepare(
        &fake,
        &layout,
        &mut view,
        "kai",
        Ask {
            governed: true,
            fresh: false,
            ..Ask::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        done.written,
        vec!["plugins.entries.boopis.settings.mode".to_owned()]
    );
    assert_eq!(
        fake.get(&home.bot("kai"), "plugins.entries.boopis.settings.mode"),
        Some(json!("governed"))
    );
    // the next start does not undo it: the one-time change is done
    let next = repair(&fake, &layout).await.unwrap();
    assert!(next.ungoverned.is_empty());
    assert_eq!(
        fake.records.lock().unwrap()["kai"]["settings"]["gov"],
        "governed"
    );
    assert_eq!(
        fake.get(&home.bot("kai"), "plugins.entries.boopis.settings.mode"),
        Some(json!("governed"))
    );
}

#[tokio::test]
async fn a_new_bot_gets_everything_and_its_seat() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    repair(&fake, &layout).await.unwrap();
    fake.clear();
    // what profiles.create leaves: a fresh home with the model pinned and nothing of boopis's
    let bot = home.bot("iris2");
    std::fs::create_dir_all(bot.join("skills/apple/findmy")).unwrap();
    std::fs::write(
        bot.join("skills/apple/findmy/SKILL.md"),
        "---\nplatforms: [macos]\n---\n",
    )
    .unwrap();
    std::fs::write(bot.join("config.yaml"), "").unwrap();
    fake.seed(
        &bot,
        json!({"model": {"provider": SUB, "default": "sonnet"}}),
    );
    let mut view = RootView::read(&fake, &home.root).await.unwrap();
    let done = prepare(
        &fake,
        &layout,
        &mut view,
        "iris2",
        Ask {
            governed: false,
            fresh: true,
            ..Ask::default()
        },
    )
    .await
    .unwrap();
    assert!(done.problems.is_empty(), "{:?}", done.problems);
    assert_eq!(done.placed.len(), 4);
    assert!(done.enabled && done.seated);
    assert_eq!(done.skills_off, vec!["findmy".to_owned()]);
    assert_eq!(
        fake.get(&home.root, "hosted_rooms.profiles.iris2"),
        Some(json!(super::plain(
            &std::fs::canonicalize(&bot).unwrap().display().to_string()
        )))
    );
    // the settings and the secrets come before the enable, so the gateway loads the plugin with them
    let log = fake.writes();
    let enable = log
        .iter()
        .position(|d| matches!(d, Did::Enable(..)))
        .unwrap();
    let last_bot_set = log
        .iter()
        .rposition(|d| matches!(d, Did::Set(h, ..) if *h == bot.display().to_string()))
        .unwrap();
    assert!(last_bot_set < enable, "{log:?}");
    // archived: it leaves the groups, and nothing else goes
    assert!(release(&fake, &home.root, "iris2").await.unwrap());
    assert_eq!(fake.get(&home.root, "hosted_rooms.profiles.iris2"), None);
    assert!(
        !release(&fake, &home.root, "iris2").await.unwrap(),
        "nothing to do twice"
    );
    assert!(fake.get(&home.root, "hosted_rooms.profiles.kai").is_some());
}

#[tokio::test]
async fn the_roots_key_wiring_reaches_every_bot_and_a_reload_loads_it() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    repair(&fake, &layout).await.unwrap();
    fake.clear();
    // the user adds an API key in Settings: the root's secret source now names it
    let mut root_cfg = fake.config.lock().unwrap()[&home.root].clone();
    put(
        &mut root_cfg,
        "secrets.boopis_host",
        json!({"enabled": true, "env": {"ANTHROPIC_API_KEY": "secret://provider.anthropic/api_key"}}),
    );
    fake.seed(&home.root, root_cfg);
    let done = repair(&fake, &layout).await.unwrap();
    assert_eq!(
        done.bots.len(),
        6,
        "the root changed, so every bot is looked at again"
    );
    for (name, _) in TEAM {
        let bot = home.bot(name);
        assert_eq!(
            fake.get(&bot, "secrets.boopis_host.enabled"),
            Some(json!(true))
        );
        assert_eq!(
            fake.get(&bot, "secrets.boopis_host.env.ANTHROPIC_API_KEY"),
            Some(json!("secret://provider.anthropic/api_key"))
        );
        assert!(
            fake.writes()
                .contains(&Did::Reload(bot.display().to_string())),
            "{name}"
        );
    }
    assert!(!done.restarted);
}

#[tokio::test]
async fn without_a_reload_the_gateway_restarts_once_and_never_on_live_work() {
    let mut fake = Fake::new();
    fake.reload_works = false;
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    // boopis already enabled in every bot by hand, but its link missing: only a reload or a restart loads it
    for (name, _) in TEAM {
        let mut cfg = fake.config.lock().unwrap()[&home.bot(name)].clone();
        put(&mut cfg, "plugins.enabled", json!(["boopis"]));
        fake.seed(&home.bot(name), cfg);
    }
    let done = repair(&fake, &layout).await.unwrap();
    assert!(done.restarted);
    assert_eq!(
        fake.writes().iter().filter(|d| **d == Did::Restart).count(),
        1
    );
    // with work running nothing is restarted, and the next start looks again
    let mut busy = Fake::new();
    busy.reload_works = false;
    busy.busy = true;
    let home = owners_home(&busy);
    let layout = layout_of(&home, Strategy::here());
    for (name, _) in TEAM {
        let mut cfg = busy.config.lock().unwrap()[&home.bot(name)].clone();
        put(&mut cfg, "plugins.enabled", json!(["boopis"]));
        busy.seed(&home.bot(name), cfg);
    }
    let first = repair(&busy, &layout).await.unwrap();
    assert!(!first.restarted);
    let second = repair(&busy, &layout).await.unwrap();
    assert_eq!(second.bots.len(), 6);
}

#[tokio::test]
async fn a_gone_bots_seat_is_removed_and_a_foreign_one_stays() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    let mut cfg = fake.config.lock().unwrap()[&home.root].clone();
    put(
        &mut cfg,
        "hosted_rooms.profiles.ghost",
        json!(home.bot("ghost").display().to_string()),
    );
    put(
        &mut cfg,
        "hosted_rooms.profiles.away",
        json!("/somewhere/else/profiles/away"),
    );
    fake.seed(&home.root, cfg);
    // an archived bot keeps its folder under its new name and loses its seat
    std::fs::rename(home.bot("nimbus"), home.bot("archived--nimbus")).unwrap();
    let done = repair(&fake, &layout).await.unwrap();
    let mut released = done.released.clone();
    released.sort();
    assert_eq!(released, vec!["ghost".to_owned(), "nimbus".to_owned()]);
    assert!(fake.get(&home.root, "hosted_rooms.profiles.away").is_some());
    assert_eq!(done.bots.len(), 5, "an archived bot is not prepared");
}

#[tokio::test]
async fn on_windows_the_plugins_are_copies_and_follow_the_root() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::Copy);
    repair(&fake, &layout).await.unwrap();
    let bot = home.bot("moss");
    let copy = bot.join("plugins").join(BOOPIS);
    assert!(
        !std::fs::symlink_metadata(&copy)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(links::version_in(&bot, BOOPIS).as_deref(), Some("1.0.0"));
    // an app update replaces the root's copy: the next start replaces each bot's
    plugin(&home.root.join("plugins").join(BOOPIS), "1.1.0");
    let mut view = RootView::read(&fake, &home.root).await.unwrap();
    let done = prepare(&fake, &layout, &mut view, "moss", Ask::default())
        .await
        .unwrap();
    assert_eq!(done.placed, vec![BOOPIS.to_owned()]);
    assert_eq!(links::version_in(&bot, BOOPIS).as_deref(), Some("1.1.0"));
}

/// B27 on Windows: a repair skipped every bot whose copy was merely there, so a release at the same manifest version never
/// reached the bots. A copy is now looked at by content.
#[tokio::test]
async fn a_repair_replaces_a_bot_s_copy_whose_code_is_not_the_root_s() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::Copy);
    repair(&fake, &layout).await.unwrap();
    let again = repair(&fake, &layout).await.unwrap();
    assert!(
        again.bots.is_empty(),
        "nothing to do while every copy is current"
    );
    // the next release: the same `version: 1.0.0`, other code
    std::fs::write(
        home.root.join("plugins").join(BOOPIS).join("__init__.py"),
        "V = 'next release'\n",
    )
    .unwrap();
    let after = repair(&fake, &layout).await.unwrap();
    assert!(
        after
            .bots
            .iter()
            .all(|b| b.placed == vec![BOOPIS.to_owned()])
            && !after.bots.is_empty(),
        "{:?}",
        after.bots
    );
    assert_eq!(
        std::fs::read_to_string(
            home.bot("moss")
                .join("plugins")
                .join(BOOPIS)
                .join("__init__.py")
        )
        .unwrap(),
        "V = 'next release'\n"
    );
}

#[tokio::test]
async fn nothing_happens_before_setup_placed_the_plugin() {
    let fake = Fake::new();
    let tmp = tempfile::tempdir().unwrap();
    let layout = Layout::new(tmp.path().join("engine"), &[]);
    let done = repair(&fake, &layout).await.unwrap();
    assert!(done.bots.is_empty() && fake.log.lock().unwrap().is_empty());
}

#[test]
fn names_are_checked_and_the_default_profile_is_no_bot() {
    for bad in ["", "default", "Kai", "-x", "a/b", "../x", &"x".repeat(65)] {
        assert!(check_name(bad).is_err(), "{bad:?}");
    }
    assert!(check_name("kai").is_ok() && check_name("archived--kai").is_ok());
    let tmp = tempfile::tempdir().unwrap();
    let layout = Layout::new(tmp.path().to_path_buf(), &[]);
    assert!(
        layout.home("archived--kai").is_err(),
        "an archived bot is restored first"
    );
    assert_eq!(
        layout.home("nobody").unwrap_err().code(),
        "hx.bots.not_found"
    );
}

#[test]
fn the_settings_follow_the_switch_and_the_model() {
    let opus = (SUB.to_owned(), "opus".to_owned());
    let haiku = (SUB.to_owned(), "haiku".to_owned());
    let w = settings_writes(None, None, false, &haiku);
    assert_eq!(
        w,
        vec![(
            "plugins.entries.boopis.settings.mode".to_owned(),
            json!("ungoverned")
        )]
    );
    let w = settings_writes(Some(&json!({"mode": "governed"})), None, true, &opus);
    assert_eq!(w.len(), 1, "the ladder only: {w:?}");
    assert_eq!(w[0].1["tiers"][0]["model"], format!("{SUB}/opus"));
    assert_eq!(tier_name("anthropic/claude-opus-5-5"), "claude-opus-5-5");
}

#[test]
fn the_roots_secrets_and_providers_are_copied_leaf_by_leaf_without_inline_keys() {
    let root = json!({"enabled": true, "env": {"A": "secret://x/a", "B": "secret://x/b"}});
    let bot = json!({"enabled": true, "env": {"A": "secret://x/a", "MINE": "secret://y/m"}});
    assert_eq!(
        secrets_writes(Some(&root), Some(&bot)),
        vec![(
            "secrets.boopis_host.env.B".to_owned(),
            json!("secret://x/b")
        )]
    );
    let mut providers = BTreeMap::new();
    providers.insert(
        "custom-lab".to_owned(),
        json!({"base_url": "https://lab.example/v1", "key_env": "BOOPIS_LAB"}),
    );
    providers.insert(
        "inline".to_owned(),
        json!({"base_url": "https://x", "api_key": "sk-123"}),
    );
    assert_eq!(provider_writes(&providers, "custom-lab", None).len(), 2);
    assert!(
        provider_writes(&providers, "inline", None).is_empty(),
        "a key in the text is never copied"
    );
}

#[test]
fn the_notice_names_the_bots_plainly() {
    let one = governance_notice(&["kai".to_owned()]);
    assert!(one.contains("kai stays ungoverned, as it ran"));
    let many = governance_notice(&["kai".into(), "nina".into(), "moss".into()]);
    assert!(
        many.contains("kai, nina and moss stay ungoverned, as they ran"),
        "{many}"
    );
    assert!(!crate::error::names_engine(&many));
}

#[test]
fn a_room_entry_has_no_windows_verbatim_prefix() {
    assert_eq!(
        super::plain(r"\\?\C:\Users\me\engine\profiles\kai"),
        r"C:\Users\me\engine\profiles\kai"
    );
    assert_eq!(
        super::plain(r"\\?\UNC\server\share\profiles\kai"),
        r"\\server\share\profiles\kai"
    );
    assert_eq!(
        super::plain("/home/me/engine/profiles/kai"),
        "/home/me/engine/profiles/kai"
    );
}

#[tokio::test]
async fn bots_that_appear_together_share_one_restart() {
    let mut fake = Fake::new();
    fake.reload_works = false;
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    repair(&fake, &layout).await.unwrap();
    fake.clear();
    // two bots made elsewhere while the app runs, boopis enabled by hand but not linked: only a restart loads it
    for name in ["iris", "sol"] {
        let bot = home.bot(name);
        std::fs::create_dir_all(&bot).unwrap();
        std::fs::write(bot.join("config.yaml"), "").unwrap();
        fake.seed(
            &bot,
            json!({"model": {"provider": SUB, "default": "sonnet"}, "plugins": {"enabled": ["boopis"]}}),
        );
    }
    let fake = std::sync::Arc::new(fake);
    let service = std::sync::Arc::new(
        engine::Service::with_engine(fake.clone())
            .with_quiet(std::time::Duration::from_millis(100)),
    );
    for name in ["iris", "sol"] {
        let done = service.prepare(&layout, name, true).await.unwrap();
        assert!(done.needs_restart, "{name}");
    }
    let restarts = || fake.writes().iter().filter(|d| **d == Did::Restart).count();
    assert_eq!(restarts(), 0, "the restart waits for the batch");
    for _ in 0..50 {
        if restarts() > 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    assert_eq!(restarts(), 1);
}

#[tokio::test]
async fn an_older_plugin_without_the_hand_off_skill_is_said_and_tried_again_next_start() {
    let fake = Fake::new();
    fake.no_guide
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    let first = repair(&fake, &layout).await.unwrap();
    assert_eq!(first.bots.len(), 6);
    for b in &first.bots {
        assert!(!b.handoffs);
        assert_eq!(b.problems.len(), 1, "{:?}", b.problems);
        assert!(
            b.problems[0].starts_with("the skill for handing work over:"),
            "{:?}",
            b.problems
        );
    }
    // the plugin is updated: the next start looks at every bot again and gives it the skill
    fake.no_guide
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let second = repair(&fake, &layout).await.unwrap();
    assert_eq!(second.bots.len(), 6);
    assert!(
        second
            .bots
            .iter()
            .all(|b| b.handoffs && b.problems.is_empty())
    );
    assert!(repair(&fake, &layout).await.unwrap().bots.is_empty());
}

/// The automatic update replaced the plugin under the running app after it waited for the bots: the start-up repair had asked
/// the earlier plugin, which has no `bots.guide`. `repair_once` does nothing more in that run; `repair_again` (the host calls it
/// once such an update is done) gives every bot the skill from the new plugin, so the UI keeps no retry of its own.
#[tokio::test]
async fn the_repair_runs_again_after_an_update_that_replaced_the_plugin_under_it() {
    use std::sync::atomic::Ordering;
    let fake = std::sync::Arc::new(Fake::new());
    fake.no_guide.store(true, Ordering::SeqCst);
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    let service = std::sync::Arc::new(engine::Service::with_engine(fake.clone()));
    let wait_for = |what: &dyn Fn() -> bool| {
        for _ in 0..250 {
            if what() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        false
    };
    service.repair_once(layout.clone());
    assert!(
        wait_for(&|| skills::Given::load(&home.root).has("kai")),
        "the first repair ran"
    );
    assert!(fake.guided.lock().unwrap().is_empty());
    // the new plugin is in: once per run means once
    fake.no_guide.store(false, Ordering::SeqCst);
    service.repair_once(layout.clone());
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert!(fake.guided.lock().unwrap().is_empty());
    service.repair_again(layout);
    assert!(
        wait_for(&|| fake.guided.lock().unwrap().len() == 6),
        "{:?}",
        fake.guided.lock().unwrap()
    );
}

#[tokio::test]
async fn a_bot_gets_the_default_skills_once_and_keeps_what_was_switched_on_since() {
    let fake = std::sync::Arc::new(Fake::new());
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    repair(fake.as_ref(), &layout).await.unwrap();
    assert!(skills::Given::load(&home.root).has("kai"));
    // a team file switches arxiv back on for kai; the app then sees kai as new (made elsewhere) and prepares it fresh
    fake.config_set(
        &home.bot("kai"),
        "skills.disabled",
        r#"["apple-notes","imessage"]"#,
    )
    .await
    .unwrap();
    let service = std::sync::Arc::new(engine::Service::with_engine(fake.clone()));
    let done = service.prepare(&layout, "kai", true).await.unwrap();
    assert!(done.skills_off.is_empty() && !done.skills_given, "{done:?}");
    assert_eq!(
        fake.get(&home.bot("kai"), "skills.disabled"),
        Some(json!(["apple-notes", "imessage"]))
    );
    // a bot made now gets them, once, and is remembered
    let bot = home.bot("sol");
    std::fs::create_dir_all(bot.join("skills/research/arxiv")).unwrap();
    std::fs::write(
        bot.join("skills/research/arxiv/SKILL.md"),
        "---\nname: arxiv\n---\n",
    )
    .unwrap();
    std::fs::write(
        bot.join("skills/.bundled_manifest"),
        "arxiv:1f2a\ngrounded-citations:9f8d\n",
    )
    .unwrap();
    std::fs::write(bot.join("config.yaml"), "").unwrap();
    fake.seed(
        &bot,
        json!({"model": {"provider": SUB, "default": "sonnet"}}),
    );
    let done = service.prepare(&layout, "sol", true).await.unwrap();
    assert_eq!(done.skills_off, vec!["arxiv".to_owned()]);
    assert!(done.skills_given);
    assert!(skills::Given::load(&home.root).has("sol"));
    // a later change (its model) does not touch its skills
    let again = service.prepare(&layout, "sol", false).await.unwrap();
    assert!(again.skills_off.is_empty());
}

#[tokio::test]
async fn a_skill_for_another_os_that_arrives_later_is_switched_off_at_the_next_preparation() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    repair(&fake, &layout).await.unwrap();
    // an engine update brings a new bundled skill made for macOS into moss's home; the bot had its default skills already
    let moss = home.bot("moss");
    std::fs::create_dir_all(moss.join("skills/apple/findmy")).unwrap();
    std::fs::write(
        moss.join("skills/apple/findmy/SKILL.md"),
        "---\nplatforms: [macos]\n---\n",
    )
    .unwrap();
    let mut view = RootView::read(&fake, &home.root).await.unwrap();
    let done = prepare(&fake, &layout, &mut view, "moss", Ask::default())
        .await
        .unwrap();
    assert_eq!(done.skills_off, vec!["findmy".to_owned()]);
    assert!(!done.skills_given, "not asked for the default index again");
    assert_eq!(
        fake.get(&moss, "skills.disabled"),
        Some(json!(["apple-notes", "arxiv", "imessage", "findmy"]))
    );
}

#[tokio::test]
async fn the_paths_a_bots_instructions_name_that_are_gone_are_listed_at_every_start() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    let gone = home.root.join("nowhere/notes.md");
    std::fs::write(
        home.bot("kai").join("SOUL.md"),
        format!("Read {} first.", gone.display()),
    )
    .unwrap();
    let first = repair(&fake, &layout).await.unwrap();
    assert_eq!(
        first.soul_missing.get("kai"),
        Some(&vec![gone.display().to_string()])
    );
    assert!(
        first.bots.iter().all(|b| b.problems.is_empty()),
        "not a problem: the bot still works"
    );
    // a start that prepares nobody still says it
    let next = repair(&fake, &layout).await.unwrap();
    assert!(next.bots.is_empty());
    assert_eq!(next.soul_missing.len(), 1);
}

#[tokio::test]
async fn a_bot_on_a_board_gets_kanban_once_and_keeps_what_the_owner_chose() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    // the Paper Past board, its group with kai and nina, and a card for hex
    *fake.boards.lock().unwrap() = vec![("paper-past".into(), "Paper Past".into())];
    *fake.rooms.lock().unwrap() =
        json!([{"name": "paper past", "members": [{"profile": "kai"}, {"profile": "nina"}]}]);
    fake.assignees
        .lock()
        .unwrap()
        .insert("paper-past".into(), vec!["hex".into()]);
    let done = repair(&fake, &layout).await.unwrap();
    assert!(done.problems.is_empty(), "{:?}", done.problems);
    let kanban = |name: &str| fake.toolsets.lock().unwrap()[name].get("kanban").copied();
    for name in ["kai", "nina", "hex"] {
        assert_eq!(kanban(name), Some(true), "{name}");
    }
    assert_eq!(kanban("moss"), Some(false));
    // the owner switches kanban off for kai; moss is given a card: the next start gives moss kanban and leaves kai's off
    fake.toolsets
        .lock()
        .unwrap()
        .get_mut("kai")
        .unwrap()
        .insert("kanban".into(), false);
    fake.assignees
        .lock()
        .unwrap()
        .get_mut("paper-past")
        .unwrap()
        .push("moss".into());
    let next = repair(&fake, &layout).await.unwrap();
    assert_eq!(
        next.bots
            .iter()
            .map(|b| b.name.as_str())
            .collect::<Vec<_>>(),
        ["moss"]
    );
    assert_eq!(next.bots[0].toolsets_on, vec!["kanban".to_owned()]);
    assert!(next.bots[0].toolsets_off.is_empty());
    assert_eq!(kanban("moss"), Some(true));
    assert_eq!(kanban("kai"), Some(false), "what the owner chose stays");
    let given = toolsets::Given::load(&home.root);
    assert_eq!(given.defaults.len(), 6);
    assert_eq!(
        given.kanban.into_iter().collect::<Vec<_>>(),
        ["hex", "kai", "moss", "nina"]
    );
}

#[tokio::test]
async fn when_the_boards_cannot_be_read_kanban_is_left_as_it_is() {
    let mut fake = Fake::new();
    fake.boards_fail = true;
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    let done = repair(&fake, &layout).await.unwrap();
    assert!(
        done.problems
            .iter()
            .any(|p| p.starts_with("which bots are on a board:")),
        "{:?}",
        done.problems
    );
    let kai = fake.toolsets.lock().unwrap()["kai"].clone();
    assert_eq!(kai.get("kanban"), None, "neither switched on nor off");
    assert_eq!(kai.get("file"), Some(&true));
    // the boards read again, kai is on one: it gets kanban then
    fake.boards_fail = false;
    *fake.boards.lock().unwrap() = vec![("ops".into(), "Ops".into())];
    fake.assignees
        .lock()
        .unwrap()
        .insert("ops".into(), vec!["kai".into()]);
    repair(&fake, &layout).await.unwrap();
    assert_eq!(
        fake.toolsets.lock().unwrap()["kai"].get("kanban"),
        Some(&true)
    );
}

#[tokio::test]
async fn a_project_folder_that_is_not_there_is_a_problem_at_every_start() {
    let fake = Fake::new();
    let home = owners_home(&fake);
    let layout = layout_of(&home, Strategy::here());
    fake.project_problems.lock().unwrap().insert(
        "iris".into(),
        "/home/me/repos/gone is not a folder on this computer".into(),
    );
    let done = repair(&fake, &layout).await.unwrap();
    let iris = done.bots.iter().find(|b| b.name == "iris").unwrap();
    assert_eq!(
        iris.problems,
        vec!["its project folder: /home/me/repos/gone is not a folder on this computer".to_owned()]
    );
    // not marked prepared: the next start says it again, until the folder is fixed
    let next = repair(&fake, &layout).await.unwrap();
    assert_eq!(
        next.bots
            .iter()
            .map(|b| b.name.as_str())
            .collect::<Vec<_>>(),
        ["iris"]
    );
    fake.project_problems.lock().unwrap().clear();
    let fixed = repair(&fake, &layout).await.unwrap();
    assert_eq!(fixed.bots.len(), 1, "looked at once more, and fine");
    assert!(fixed.bots[0].problems.is_empty());
    assert!(repair(&fake, &layout).await.unwrap().bots.is_empty());
}
