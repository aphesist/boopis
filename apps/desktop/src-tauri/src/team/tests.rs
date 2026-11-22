use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;

use super::apply::{Backend, apply};
use super::export::export;
use super::plan::*;
use super::spec::*;
use crate::error::{Error, Result};

pub(crate) const EXAMPLE_DIR: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../../docs/team-example");

fn example() -> Team {
    let dir = Path::new(EXAMPLE_DIR);
    let text = std::fs::read_to_string(dir.join("paper-past.yaml")).unwrap();
    Team::parse(&text, dir).unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn the_papers_past_example_is_a_valid_team() {
    let t = example();
    assert_eq!(t.bots.len(), 6);
    assert_eq!(t.rooms["paper past"].members.len(), 6);
    assert_eq!(t.rooms["paper past"].lead.as_deref(), Some("kai"));
    assert!(t.cron[0].paused);
    // the soul files are read into text
    assert!(
        t.bots["kai"]
            .soul_text
            .as_ref()
            .unwrap()
            .starts_with("You are Kai")
    );
    assert!(t.bots["kai"].soul.is_none());
    assert_eq!(t.bots["iris"].skills, ["papercraft"]);
}

#[test]
fn the_shapes_are_the_apps() {
    let ts = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../ui/src/components/look.ts"
    ))
    .unwrap();
    let line = ts
        .lines()
        .find(|l| l.starts_with("export const SHAPES"))
        .unwrap();
    let listed: Vec<&str> = line.split('\'').skip(1).step_by(2).collect();
    assert_eq!(listed, SHAPES);
}

fn parse(text: &str) -> std::result::Result<Team, SpecError> {
    Team::parse(text, Path::new("/nonexistent"))
}

#[test]
fn every_mistake_is_found_and_says_where() {
    let e = parse(
        "version: 2\nbots:\n  Kai: {look: {shape: blob, color: red}}\n  nina: {connectors: [{name: a}, {name: a, command: x, url: 'https://x'}]}\nrooms:\n  r: {members: [kai], lead: zed, max_rounds: 0}\nboards:\n  Bad_Slug: {workdir: relative/path}\ncron:\n  - {bot: nina, name: j, schedule: '', room: r, deliver: local}\n",
    )
    .unwrap_err()
    .to_string();
    for want in [
        "version: this build reads version 1",
        "bots.Kai: not a bot's name",
        "bots.Kai.look.shape: \"blob\" is not a shape",
        "bots.Kai.look.color: \"red\"",
        "bots.nina.connectors[0]: give a command or a url",
        "bots.nina.connectors[1].name: \"a\" is listed twice",
        "bots.nina.connectors[1]: give a command or a url, not both",
        "rooms.r.members: 2 to 6 bots, not 1",
        "rooms.r.lead: zed is not one of",
        "rooms.r.max_rounds",
        "boards.Bad_Slug: a slug",
        "boards.Bad_Slug.workdir",
        "cron[0].schedule: empty",
        "cron[0].prompt",
        "cron[0]: give a room or a deliver target, not both",
    ] {
        assert!(e.contains(want), "missing {want:?} in:\n{e}");
    }
}

#[test]
fn a_typo_in_a_key_is_an_error_not_ignored() {
    let e = parse("version: 1\nbots:\n  kai: {rol: x}\n")
        .unwrap_err()
        .to_string();
    assert!(e.contains("rol"), "{e}");
    assert!(parse("version: 1\nbotz: {}\n").is_err());
    assert!(parse("not: [a, team").is_err());
}

#[test]
fn files_stay_inside_the_team_files_folder() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("kai.md"), "I am Kai").unwrap();
    let ok = Team::parse("version: 1\nbots:\n  kai: {soul: kai.md}\n", d.path()).unwrap();
    assert_eq!(ok.soul_of("kai"), Some("I am Kai"));
    for bad in ["/etc/passwd", "../x", "missing.md"] {
        let e = Team::parse(
            &format!("version: 1\nbots:\n  kai: {{soul: {bad}}}\n"),
            d.path(),
        )
        .unwrap_err()
        .to_string();
        assert!(e.contains("bots.kai.soul"), "{e}");
    }
    let both = Team::parse(
        "version: 1\nbots:\n  kai: {soul: kai.md, soul_text: x}\n",
        d.path(),
    )
    .unwrap_err()
    .to_string();
    assert!(both.contains("not both"), "{both}");
}

/// An engine in memory: `run` changes it the way the live one would, so a second plan over it shows idempotency.
pub(crate) struct Model {
    pub(crate) now: Mutex<Current>,
    pub(crate) ran: Mutex<Vec<String>>,
    pub(crate) fail_bot: Option<String>,
    pub(crate) installed: Vec<String>,
}

impl Model {
    pub(crate) fn new(now: Current) -> Self {
        Self {
            now: Mutex::new(now),
            ran: Mutex::new(Vec::new()),
            fail_bot: None,
            installed: vec!["papercraft".into()],
        }
    }
    pub(crate) fn read_turns(&self, bot: &str) -> Option<u32> {
        self.now
            .lock()
            .unwrap()
            .bots
            .get(bot)
            .and_then(|b| b.max_turns)
    }
    pub(crate) fn ran(&self) -> Vec<String> {
        self.ran.lock().unwrap().clone()
    }
}

pub(crate) fn base() -> Current {
    Current {
        default_provider: "claude-sub".into(),
        baseline_skills: Some(vec!["web".into(), "files".into()]),
        ..Current::default()
    }
}

#[async_trait]
impl Backend for Model {
    async fn read(&self) -> Result<Current> {
        Ok(self.now.lock().unwrap().clone())
    }
    #[allow(clippy::too_many_lines)]
    async fn run(&self, op: &Op) -> Result<()> {
        self.ran.lock().unwrap().push(
            format!("{op:?}")
                .split([' ', '{'])
                .next()
                .unwrap()
                .to_owned(),
        );
        let mut n = self.now.lock().unwrap();
        let provider = n.default_provider.clone();
        match op {
            Op::CreateBot { name, bot } => {
                if self.fail_bot.as_deref() == Some(name) {
                    return Err(Error::Unavailable("Check 'hermes model'".into()));
                }
                let (p, m) = bot
                    .model
                    .as_deref()
                    .map_or((provider.clone(), String::new()), |m| {
                        m.split_once('/')
                            .map_or((provider.clone(), m.to_owned()), |(p, m)| {
                                (p.to_owned(), m.to_owned())
                            })
                    });
                let mut skills: Vec<(String, bool)> = ["web", "files"]
                    .iter()
                    .map(|s| ((*s).to_owned(), true))
                    .collect();
                skills.extend(
                    self.installed
                        .iter()
                        .filter(|s| bot.skills.contains(s))
                        .map(|s| (s.clone(), true)),
                );
                n.bots.insert(
                    name.clone(),
                    BotNow {
                        role: bot.role.clone().unwrap_or_default(),
                        soul: bot.soul_text.clone().unwrap_or_default(),
                        provider: p,
                        model: m,
                        look: bot.look.clone(),
                        governed: bot.governed == Some(true),
                        max_turns: bot.max_turns,
                        skills,
                        connectors: Vec::new(),
                    },
                );
            }
            Op::UpdateBot {
                name,
                role,
                soul,
                model,
                look,
                governed,
                max_turns,
            } => {
                let b = n.bots.get_mut(name).unwrap();
                if let Some(r) = role {
                    b.role.clone_from(r);
                }
                if let Some(s) = soul {
                    b.soul.clone_from(s);
                }
                if let Some(m) = model {
                    b.model.clone_from(m);
                }
                if let Some(l) = look {
                    b.look = Some(l.clone());
                }
                if let Some(g) = governed {
                    b.governed = *g;
                }
                if let Some(c) = max_turns {
                    b.max_turns = c.kept();
                }
            }
            Op::EnableSkills { bot, skills } => {
                for s in &mut n.bots.get_mut(bot).unwrap().skills {
                    if skills.contains(&s.0) {
                        s.1 = true;
                    }
                }
            }
            Op::AddConnector { bot, connector } => {
                n.bots.get_mut(bot).unwrap().connectors.push(ConnectorNow {
                    name: connector.name.clone(),
                    command: connector.command.clone(),
                    args: connector.args.clone(),
                    url: connector.url.clone(),
                    env: connector.env.keys().cloned().collect(),
                });
            }
            Op::RemoveConnector { bot, name } => n
                .bots
                .get_mut(bot)
                .unwrap()
                .connectors
                .retain(|c| &c.name != name),
            Op::CreateRoom {
                name,
                id,
                members,
                lead,
                purpose,
                max_rounds,
            } => n.rooms.push(RoomNow {
                id: id.clone(),
                name: name.clone(),
                members: members.clone(),
                lead: lead.clone().unwrap_or_default(),
                purpose: purpose.clone().unwrap_or_default(),
                max_rounds: *max_rounds,
            }),
            Op::SetRoomContext { id, lead, purpose } => {
                let r = n.rooms.iter_mut().find(|r| &r.id == id).unwrap();
                r.lead.clone_from(lead);
                r.purpose.clone_from(purpose);
            }
            Op::SetMaxRounds { id, max_rounds } => {
                n.rooms.iter_mut().find(|r| &r.id == id).unwrap().max_rounds = *max_rounds;
            }
            Op::CreateBoard {
                slug,
                name,
                workdir,
            } => {
                n.boards.insert(
                    slug.clone(),
                    BoardNow {
                        name: name.clone().unwrap_or_default(),
                        workdir: workdir.clone(),
                    },
                );
            }
            Op::UpdateBoard {
                slug,
                name,
                workdir,
            } => {
                let b = n.boards.get_mut(slug).unwrap();
                if let Some(x) = name {
                    b.name.clone_from(x);
                }
                if let Some(w) = workdir {
                    b.workdir = Some(w.clone());
                }
            }
            Op::AddJob { bot, job, deliver } => {
                let id = format!("job{}", n.jobs.values().map(Vec::len).sum::<usize>() + 1);
                n.jobs.entry(bot.clone()).or_default().push(JobNow {
                    id,
                    name: job.name.clone(),
                    schedule: job.schedule.clone(),
                    prompt: job.prompt.clone().unwrap_or_default(),
                    prompt_whole: true,
                    deliver: deliver.clone().unwrap_or_else(|| "local".into()),
                    paused: false,
                });
            }
            Op::RemoveJob { bot, id } => n.jobs.get_mut(bot).unwrap().retain(|j| &j.id != id),
            Op::SetJobPaused { bot, name, paused } => {
                n.jobs
                    .get_mut(bot)
                    .unwrap()
                    .iter_mut()
                    .find(|j| &j.name == name)
                    .unwrap()
                    .paused = *paused;
            }
            Op::ArchiveBot { name } => {
                n.bots.remove(name);
            }
            Op::DisbandRoom { id } => n.rooms.retain(|r| &r.id != id),
            Op::ArchiveBoard { slug } => {
                n.boards.remove(slug);
            }
        }
        Ok(())
    }
    async fn missing_skills(&self, _: &str, wanted: &[String]) -> Result<Vec<String>> {
        Ok(wanted
            .iter()
            .filter(|w| !self.installed.contains(w))
            .cloned()
            .collect())
    }
}

async fn apply_to(model: &Model, team: &Team, prune: bool) -> super::apply::Report {
    let now = model.read().await.unwrap();
    let plan = plan(team, &now, prune);
    let wanted: BTreeMap<String, Vec<String>> = team
        .bots
        .iter()
        .map(|(n, b)| (n.clone(), b.skills.clone()))
        .collect();
    apply(model, &plan, &wanted).await.unwrap()
}

#[tokio::test]
async fn the_example_applies_in_order_and_a_second_apply_changes_nothing() {
    let team = example();
    let model = Model::new(base());
    let first = plan(&team, &model.read().await.unwrap(), false);
    assert!(first.problems.is_empty(), "{:?}", first.problems);
    // bots, their connectors, rooms, boards, jobs: in that order
    let kinds: Vec<&str> = first
        .actions
        .iter()
        .map(|a| a.target.split(' ').next().unwrap())
        .collect();
    let last_bot = kinds.iter().rposition(|k| *k == "bot").unwrap();
    let first_room = kinds.iter().position(|k| *k == "room").unwrap();
    let first_board = kinds.iter().position(|k| *k == "board").unwrap();
    let first_job = kinds.iter().position(|k| *k == "job").unwrap();
    assert!(
        last_bot < first_room && first_room < first_board && first_board < first_job,
        "{kinds:?}"
    );
    let report = apply_to(&model, &team, false).await;
    assert!(report.all_ok(), "{report:?}");
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    let now = model.read().await.unwrap();
    assert_eq!(now.bots.len(), 6);
    assert_eq!(now.bots["kai"].connectors.len(), 1);
    assert_eq!(now.rooms[0].id, "g-paper-past-");
    assert_eq!(now.jobs["kai"][0].deliver, "room:g-paper-past-@kai");
    assert!(now.jobs["kai"][0].paused);
    // idempotent
    let again = plan(&team, &now, false);
    assert!(again.is_empty(), "{:?}", again.actions);
    assert!(again.problems.is_empty());
}

#[tokio::test]
async fn only_what_differs_is_changed_and_nothing_is_removed_without_prune() {
    let team = example();
    let model = Model::new(base());
    apply_to(&model, &team, false).await;
    {
        let mut n = model.now.lock().unwrap();
        n.bots.get_mut("kai").unwrap().role = "something else".into();
        n.bots
            .get_mut("hex")
            .unwrap()
            .skills
            .iter_mut()
            .find(|s| s.0 == "papercraft")
            .unwrap()
            .1 = false;
        n.rooms[0].lead = String::new();
        n.rooms[0].max_rounds = Some(3);
        n.boards.get_mut("paper-past").unwrap().workdir = Some("~/elsewhere".into());
        n.jobs.get_mut("kai").unwrap()[0].schedule = "0 10 * * *".into();
        // things that are not in the file
        n.bots.insert("extra".into(), BotNow::default());
        n.rooms.push(RoomNow {
            id: "g-old".into(),
            name: "old".into(),
            ..RoomNow::default()
        });
        n.boards.insert("old".into(), BoardNow::default());
        n.jobs.entry("kai".into()).or_default().push(JobNow {
            id: "j9".into(),
            name: "other".into(),
            ..JobNow::default()
        });
    }
    let now = model.read().await.unwrap();
    let p = plan(&team, &now, false);
    let targets: Vec<String> = p
        .actions
        .iter()
        .map(|a| format!("{} {} {}", a.mark, a.target, a.what))
        .collect();
    assert_eq!(p.actions.len(), 8, "{targets:#?}");
    assert!(
        p.actions.iter().all(|a| a.mark != '-'),
        "nothing is removed without --prune"
    );
    assert!(
        targets
            .iter()
            .any(|t| t.contains("bot kai") && t.contains("role"))
    );
    assert!(targets.iter().any(|t| t.contains("skill papercraft")));
    assert!(
        targets
            .iter()
            .any(|t| t.contains("room paper past") && t.contains("lead"))
    );
    assert!(targets.iter().any(|t| t.contains("max rounds 30")));
    assert!(
        targets
            .iter()
            .any(|t| t.contains("board paper-past") && t.contains("folder"))
    );
    assert!(
        targets
            .iter()
            .any(|t| t.contains("job daily episode of kai") && t.contains("new id"))
    );
    // with --prune the strays go: bots and boards are archived, the room disbanded, the job removed
    let pruned = plan(&team, &now, true);
    let marks: Vec<&Op> = pruned
        .actions
        .iter()
        .filter(|a| a.mark == '-')
        .map(|a| &a.op)
        .collect();
    assert_eq!(marks.len(), 4, "{marks:?}");
    assert!(
        marks
            .iter()
            .any(|o| matches!(o, Op::ArchiveBot { name } if name == "extra"))
    );
    assert!(
        marks
            .iter()
            .any(|o| matches!(o, Op::DisbandRoom { id } if id == "g-old"))
    );
    assert!(
        marks
            .iter()
            .any(|o| matches!(o, Op::ArchiveBoard { slug } if slug == "old"))
    );
    assert!(
        marks
            .iter()
            .any(|o| matches!(o, Op::RemoveJob { id, .. } if id == "j9"))
    );
    let report = apply_to(&model, &team, true).await;
    assert!(report.all_ok(), "{report:?}");
    assert!(plan(&team, &model.read().await.unwrap(), true).is_empty());
}

#[tokio::test]
async fn a_frozen_room_is_a_note_and_an_unknown_name_is_a_problem() {
    let mut team = example();
    let model = Model::new(base());
    apply_to(&model, &team, false).await;
    team.rooms.get_mut("paper past").unwrap().members = vec!["kai".into(), "nina".into()];
    let p = plan(&team, &model.read().await.unwrap(), false);
    assert!(p.is_empty());
    assert!(
        p.notes
            .iter()
            .any(|n| n.contains("cannot be changed once it is made")),
        "{:?}",
        p.notes
    );
    team.rooms.get_mut("paper past").unwrap().members = vec!["kai".into(), "ghost".into()];
    team.cron[0].room = Some("nowhere".into());
    let p = plan(&team, &model.read().await.unwrap(), false);
    assert!(
        p.problems.iter().any(|x| x.contains("ghost is not a bot")),
        "{:?}",
        p.problems
    );
    assert!(
        p.problems
            .iter()
            .any(|x| x.contains("\"nowhere\" is not in the file")),
        "{:?}",
        p.problems
    );
    // a plan with problems is not applied
    let wanted = BTreeMap::new();
    assert!(apply(&model, &p, &wanted).await.is_err());
}

#[tokio::test]
async fn a_skill_that_is_not_installed_is_said_and_a_failed_bot_skips_what_needs_it() {
    let team = example();
    let mut model = Model::new(base());
    model.installed.clear();
    let report = apply_to(&model, &team, false).await;
    assert!(
        report
            .warnings
            .iter()
            .any(|w| w.contains("bot iris") && w.contains("papercraft")),
        "{:?}",
        report.warnings
    );
    // an existing bot without the skill is a problem in the plan
    let p = plan(&team, &model.read().await.unwrap(), false);
    assert!(
        p.problems
            .iter()
            .any(|x| x.contains("papercraft") && x.contains("not installed")),
        "{:?}",
        p.problems
    );

    let mut model = Model::new(base());
    model.fail_bot = Some("kai".into());
    let report = apply_to(&model, &team, false).await;
    assert!(!report.all_ok());
    let failed = report.done.iter().find(|d| d.result == "failed").unwrap();
    assert_eq!(failed.target, "bot kai");
    // the engine's own words are not shown
    assert!(
        !failed
            .error
            .as_ref()
            .unwrap()
            .to_ascii_lowercase()
            .contains("hermes"),
        "{failed:?}"
    );
    let skipped: Vec<&str> = report
        .done
        .iter()
        .filter(|d| d.result == "skipped")
        .map(|d| d.target.as_str())
        .collect();
    assert!(skipped.contains(&"bot kai"), "{skipped:?}"); // its connector
    assert!(
        skipped.iter().any(|t| t.starts_with("room")),
        "the room that seats kai: {skipped:?}"
    );
    assert!(skipped.iter().any(|t| t.starts_with("job")), "{skipped:?}");
    // the others were made
    assert_eq!(model.read().await.unwrap().bots.len(), 5);
}

#[tokio::test]
async fn export_then_plan_is_empty_and_the_file_reads_back() {
    let team = example();
    let model = Model::new(base());
    apply_to(&model, &team, false).await;
    let now = model.read().await.unwrap();
    let exported = export(&now);
    assert!(exported.warnings.is_empty());
    let yaml = exported.team.to_yaml().unwrap();
    assert!(yaml.starts_with("# A boopis team"));
    let back =
        Team::parse(&yaml, Path::new("/nonexistent")).unwrap_or_else(|e| panic!("{e}\n{yaml}"));
    assert_eq!(back, exported.team);
    let p = plan(&back, &now, true);
    assert!(p.is_empty(), "{:?}", p.actions);
    // what it says
    assert_eq!(
        back.bots["iris"].skills,
        ["papercraft"],
        "a skill every bot has is not written, one only this bot has is"
    );
    assert!(back.bots["kai"].skills.is_empty());
    assert_eq!(
        back.bots["kai"].model.as_deref(),
        Some("opus"),
        "the root's provider is not spelled out"
    );
    assert_eq!(back.cron[0].room.as_deref(), Some("paper past"));
    assert_eq!(back.cron[0].post_as, None);
    assert!(back.cron[0].paused);
    assert_eq!(
        back.rooms["paper past"].id.as_deref(),
        Some("g-paper-past-")
    );
    assert!(
        !yaml.contains("env"),
        "a server's variables are never written"
    );
}

#[test]
fn export_names_a_truncated_prompt_and_keeps_foreign_targets_as_written() {
    let mut now = base();
    now.bots.insert("kai".into(), BotNow::default());
    now.jobs.insert(
        "kai".into(),
        vec![
            JobNow {
                id: "1".into(),
                name: "a".into(),
                schedule: "0 9 * * *".into(),
                prompt: "start...".into(),
                prompt_whole: false,
                deliver: "telegram:123".into(),
                paused: false,
            },
            JobNow {
                id: "2".into(),
                name: "b".into(),
                schedule: "every 2h".into(),
                prompt: "x".into(),
                prompt_whole: true,
                deliver: "room:g-gone@kai".into(),
                paused: false,
            },
        ],
    );
    let e = export(&now);
    assert_eq!(e.warnings.len(), 1);
    assert!(e.warnings[0].contains("start of its prompt only"));
    assert_eq!(e.team.cron[0].deliver.as_deref(), Some("telegram:123"));
    assert_eq!(e.team.cron[1].deliver.as_deref(), Some("room:g-gone@kai"));
    assert!(e.team.cron[1].room.is_none());
}

#[test]
fn a_models_provider_prefix_counts_as_the_same_model() {
    let mut now = base();
    now.bots.insert(
        "kai".into(),
        BotNow {
            provider: "p".into(),
            model: "opus".into(),
            ..BotNow::default()
        },
    );
    let mut team = Team {
        version: 1,
        ..Team::default()
    };
    team.bots.insert(
        "kai".into(),
        Bot {
            model: Some("p/opus".into()),
            ..Bot::default()
        },
    );
    assert!(plan(&team, &now, false).is_empty());
    team.bots.get_mut("kai").unwrap().model = Some("opus".into());
    assert!(plan(&team, &now, false).is_empty());
    team.bots.get_mut("kai").unwrap().model = Some("haiku".into());
    assert_eq!(plan(&team, &now, false).actions.len(), 1);
}

#[test]
fn a_delivery_target_is_written_the_way_the_engine_reads_it() {
    let ids: BTreeMap<String, String> =
        [("paper past".to_owned(), "g-paper-past-".to_owned())].into();
    let job = Cron {
        bot: "kai".into(),
        name: "x".into(),
        schedule: "s".into(),
        room: Some("paper past".into()),
        ..Cron::default()
    };
    assert_eq!(
        deliver_for(&job, &ids).as_deref(),
        Some("room:g-paper-past-@kai")
    );
    let job = Cron {
        post_as: Some("nina".into()),
        ..job
    };
    assert_eq!(
        deliver_for(&job, &ids).as_deref(),
        Some("room:g-paper-past-@nina")
    );
    let job = Cron {
        room: None,
        post_as: None,
        deliver: Some("local".into()),
        ..job
    };
    assert_eq!(deliver_for(&job, &ids).as_deref(), Some("local"));
}

#[test]
fn a_bots_cap_on_turns_is_checked_planned_applied_and_exported() {
    // the file's mistakes
    let e = parse("version: 1\nbots:\n  kai: {max_turns: 0}\n  nina: {max_turns: 5000}\n")
        .unwrap_err()
        .to_string();
    assert!(e.contains("bots.kai.max_turns: 1 to 1000"), "{e}");
    assert!(e.contains("bots.nina.max_turns: 1 to 1000"), "{e}");
    let team = parse("version: 1\nbots:\n  kai: {max_turns: 30}\n").unwrap();
    // a new bot is made with it
    let now = base();
    let p = plan(&team, &now, false);
    assert_eq!(p.actions[0].what, "new, max turns 30");
    // an existing one is changed only when the number differs, and only when the file says one
    let mut now = base();
    now.bots.insert("kai".into(), BotNow::default());
    let p = plan(&team, &now, false);
    assert_eq!(p.actions.len(), 1);
    assert_eq!(p.actions[0].what, "max turns");
    now.bots.get_mut("kai").unwrap().max_turns = Some(30);
    assert!(plan(&team, &now, false).is_empty());
    let silent = parse("version: 1\nbots:\n  kai: {}\n").unwrap();
    assert!(plan(&silent, &now, false).is_empty());
}

#[tokio::test]
async fn a_cap_on_turns_applies_once_and_exports_back_to_an_empty_plan() {
    let team = parse("version: 1\nbots:\n  kai: {max_turns: 30}\n  nina: {}\n").unwrap();
    let model = Model::new(base());
    let p = plan(&team, &model.read().await.unwrap(), false);
    let report = apply(&model, &p, &BTreeMap::new()).await.unwrap();
    assert!(report.all_ok());
    let now = model.read().await.unwrap();
    assert_eq!(now.bots["kai"].max_turns, Some(30));
    assert_eq!(now.bots["nina"].max_turns, None);
    assert!(plan(&team, &now, false).is_empty());
    // the export writes it, and only for the bot that keeps one
    let e = export(&now);
    assert_eq!(e.team.bots["kai"].max_turns, Some(30));
    assert_eq!(e.team.bots["nina"].max_turns, None);
    assert!(plan(&e.team, &now, false).is_empty());
    // changed in the file, it is changed once
    let more = parse("version: 1\nbots:\n  kai: {max_turns: 12}\n").unwrap();
    let p = plan(&more, &now, false);
    apply(&model, &p, &BTreeMap::new()).await.unwrap();
    assert_eq!(model.read().await.unwrap().bots["kai"].max_turns, Some(12));
}
