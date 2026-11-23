//! The plan: what `team apply` would do, found by comparing a team file with what is there now. Pure (no engine, no files),
//! so it is tested as a table. A second plan over a team that was just applied is empty: that is what idempotent means here.

use std::collections::BTreeMap;

use serde::Serialize;

use super::spec::{Bot, Connector, Cron, Look, Team};
use crate::bots::limit::Cap;

/// A bot as it is now.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BotNow {
    /// Its description.
    pub role: String,
    /// Its instructions.
    pub soul: String,
    /// Its model pin: provider, and the model.
    pub provider: String,
    /// See `provider`.
    pub model: String,
    /// Its orb, when its record has one.
    pub look: Option<Look>,
    /// Its Governed switch.
    pub governed: bool,
    /// Its cap on turns for `boopis run --bot`, when it keeps one.
    pub max_turns: Option<u32>,
    /// Its skills, `(name, enabled)`.
    pub skills: Vec<(String, bool)>,
    /// Its MCP servers by name, with their program and arguments.
    pub connectors: Vec<ConnectorNow>,
    /// Its toolsets, `(name, enabled)`, as the engine lists them for it.
    pub toolsets: Vec<(String, bool)>,
}

/// An MCP server as it is now.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConnectorNow {
    /// Its name.
    pub name: String,
    /// Its program, when it is a local one.
    pub command: Option<String>,
    /// Its arguments.
    pub args: Vec<String>,
    /// Its address, when it is a remote one.
    pub url: Option<String>,
    /// The names of its environment variables.
    pub env: Vec<String>,
}

/// A room as it is now.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RoomNow {
    /// Its id.
    pub id: String,
    /// Its name.
    pub name: String,
    /// Its members.
    pub members: Vec<String>,
    /// Its lead (empty when it routes to everyone).
    pub lead: String,
    /// Its purpose.
    pub purpose: String,
    /// boopis's cap on rounds for it.
    pub max_rounds: Option<u32>,
}

/// A board as it is now.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BoardNow {
    /// Its name.
    pub name: String,
    /// Its default working folder.
    pub workdir: Option<String>,
}

/// A scheduled job as it is now.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct JobNow {
    /// Its id (the engine's).
    pub id: String,
    /// Its name.
    pub name: String,
    /// Its schedule as the engine shows it.
    pub schedule: String,
    /// Its prompt: the whole text, or only the start the engine lists when the whole could not be read.
    pub prompt: String,
    /// `prompt` is the whole text.
    pub prompt_whole: bool,
    /// Where its result goes.
    pub deliver: String,
    /// Paused.
    pub paused: bool,
}

/// Everything the plan compares with.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Current {
    /// The bots, by name (archived ones are not here).
    pub bots: BTreeMap<String, BotNow>,
    /// The rooms.
    pub rooms: Vec<RoomNow>,
    /// The boards, by slug.
    pub boards: BTreeMap<String, BoardNow>,
    /// The jobs of each bot, by bot.
    pub jobs: BTreeMap<String, Vec<JobNow>>,
    /// The skills of the default profile (the ones every bot starts with), when they could be read.
    pub baseline_skills: Option<Vec<String>>,
    /// The provider the root's model uses: a model named without a provider means this one.
    pub default_provider: String,
}

/// What a team file says of a new bot's toolsets, done once it exists. Its toolsets are the file's
/// list: the role's defaults it is made with that the list does not name are switched off again.
fn new_bot_settings(name: &str, want: &Bot) -> Vec<Action> {
    let mut out = Vec::new();
    if let Some(list) = &want.toolsets {
        let d = crate::bots::toolsets::defaults();
        let on: Vec<String> = sorted(list.iter().cloned());
        let off = sorted(
            d.on.iter()
                .chain(&d.on_a_board)
                .filter(|t| !list.contains(t))
                .cloned(),
        );
        out.push(settings_action(
            name,
            Some(name),
            Op::SetToolsets {
                bot: name.to_owned(),
                on,
                off,
            },
            "toolsets",
        ));
    }
    out
}

/// What a team file says of an existing bot's toolsets, where it differs from what is there.
fn bot_settings(name: &str, want: &Bot, have: &BotNow) -> Vec<Action> {
    let mut out = Vec::new();
    if let Some(list) = &want.toolsets {
        let enabled: Vec<&String> = have
            .toolsets
            .iter()
            .filter(|(_, on)| *on)
            .map(|(n, _)| n)
            .collect();
        let on = sorted(list.iter().filter(|t| !enabled.contains(t)).cloned());
        let off = sorted(
            enabled
                .iter()
                .filter(|t| !list.contains(**t))
                .map(|t| (*t).clone()),
        );
        if !on.is_empty() || !off.is_empty() {
            let what = [("on", &on), ("off", &off)]
                .iter()
                .filter(|(_, l)| !l.is_empty())
                .map(|(w, l)| format!("switch {w} toolset {}", l.join(", ")))
                .collect::<Vec<_>>()
                .join("; ");
            out.push(settings_action(
                name,
                None,
                Op::SetToolsets {
                    bot: name.to_owned(),
                    on,
                    off,
                },
                &what,
            ));
        }
    }
    out
}

fn settings_action(name: &str, needs: Option<&str>, op: Op, what: &str) -> Action {
    Action {
        mark: '~',
        target: format!("bot {name}"),
        what: what.to_owned(),
        needs: needs.map(str::to_owned),
        op,
    }
}

fn sorted(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut v: Vec<String> = items.into_iter().collect();
    v.sort();
    v.dedup();
    v
}

/// One thing to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    /// Make a bot.
    CreateBot {
        /// Its name.
        name: String,
        /// What it is given.
        bot: Bot,
    },
    /// Change a bot's role, instructions, model, look or Governed switch.
    UpdateBot {
        /// Its name.
        name: String,
        /// The role, when it changes.
        role: Option<String>,
        /// The instructions, when they change.
        soul: Option<String>,
        /// The model, when it changes.
        model: Option<String>,
        /// The look, when it changes.
        look: Option<Look>,
        /// The Governed switch, when it changes.
        governed: Option<bool>,
        /// The cap on turns for `boopis run --bot`, when it changes (a number, or the default again).
        max_turns: Option<Cap>,
    },
    /// Switch skills on.
    EnableSkills {
        /// The bot.
        bot: String,
        /// The skills.
        skills: Vec<String>,
    },
    /// Switch a bot's toolsets on and off (the same for its chats, workers and room turns).
    SetToolsets {
        /// The bot.
        bot: String,
        /// Switched on.
        on: Vec<String>,
        /// Switched off.
        off: Vec<String>,
    },
    /// Add an MCP server to a bot.
    AddConnector {
        /// The bot.
        bot: String,
        /// The server.
        connector: Connector,
    },
    /// Make a room.
    CreateRoom {
        /// Its name.
        name: String,
        /// The id it is made with.
        id: String,
        /// Its members.
        members: Vec<String>,
        /// Its lead.
        lead: Option<String>,
        /// Its purpose.
        purpose: Option<String>,
        /// boopis's cap on rounds.
        max_rounds: Option<u32>,
    },
    /// Change a room's lead or purpose.
    SetRoomContext {
        /// The room's id.
        id: String,
        /// The lead (empty: route to everyone).
        lead: String,
        /// The purpose.
        purpose: String,
    },
    /// Keep (or forget, with `None`) boopis's cap on rounds for a room.
    SetMaxRounds {
        /// The room's id.
        id: String,
        /// The cap.
        max_rounds: Option<u32>,
    },
    /// Make a board.
    CreateBoard {
        /// Its slug.
        slug: String,
        /// Its name.
        name: Option<String>,
        /// Its folder.
        workdir: Option<String>,
    },
    /// Change a board's name or folder.
    UpdateBoard {
        /// Its slug.
        slug: String,
        /// The name, when it changes.
        name: Option<String>,
        /// The folder, when it changes.
        workdir: Option<String>,
    },
    /// Add a job to a bot.
    AddJob {
        /// The bot.
        bot: String,
        /// The job.
        job: Cron,
        /// The delivery target, written for the engine.
        deliver: Option<String>,
    },
    /// Remove a job (to add its new form, or because it is not in the file).
    RemoveJob {
        /// The bot.
        bot: String,
        /// The job's id.
        id: String,
    },
    /// Pause or resume a job.
    SetJobPaused {
        /// The bot.
        bot: String,
        /// The job's name (found again by name, because a replaced job has a new id).
        name: String,
        /// Paused.
        paused: bool,
    },
    /// Remove an MCP server from a bot (only with `--prune`).
    RemoveConnector {
        /// The bot.
        bot: String,
        /// The server.
        name: String,
    },
    /// Archive a bot (only with `--prune`; it can be restored).
    ArchiveBot {
        /// The bot.
        name: String,
    },
    /// Disband a room (only with `--prune`; permanent).
    DisbandRoom {
        /// The room's id.
        id: String,
    },
    /// Archive a board (only with `--prune`).
    ArchiveBoard {
        /// Its slug.
        slug: String,
    },
}

/// One line of the plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Action {
    /// `+` makes, `~` changes, `-` removes.
    pub mark: char,
    /// What it is about (`bot kai`, `room paper past`).
    pub target: String,
    /// What changes, in words.
    pub what: String,
    /// The bot it needs to exist, when it is about one that is made in the same plan.
    #[serde(skip)]
    pub needs: Option<String>,
    /// The thing to do.
    pub op: Op,
}

/// The plan.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct Plan {
    /// What to do, in the order to do it.
    pub actions: Vec<Action>,
    /// What cannot be done, and why: the plan is not applied while there are any.
    pub problems: Vec<String>,
    /// What the file asks for that `apply` leaves alone, and why.
    pub notes: Vec<String>,
}

impl Plan {
    /// Nothing to do.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.actions.is_empty()
    }
}

/// The file's room for the job, as the engine writes a delivery target.
#[must_use]
pub fn deliver_for(job: &Cron, rooms: &BTreeMap<String, String>) -> Option<String> {
    match (&job.room, &job.deliver) {
        (Some(r), _) => rooms
            .get(r)
            .map(|id| format!("room:{id}@{}", job.post_as.as_deref().unwrap_or(&job.bot))),
        (None, d) => d.clone(),
    }
}

fn same_model(want: &str, provider: &str, model: &str) -> bool {
    let want = want.trim();
    want == model || want == format!("{provider}/{model}")
}

fn find_room<'a>(now: &'a Current, name: &str, id: Option<&str>) -> Option<&'a RoomNow> {
    id.and_then(|i| now.rooms.iter().find(|r| r.id == i))
        .or_else(|| {
            now.rooms
                .iter()
                .find(|r| r.name.trim().eq_ignore_ascii_case(name.trim()))
        })
}

/// Compare `team` with `now`. With `prune`, what is there and not in the file is removed (bots and boards archived, rooms
/// disbanded, jobs and servers removed); without it nothing is ever removed.
#[must_use]
#[allow(clippy::too_many_lines)] // one pass per kind of thing, in the order they are applied
pub fn plan(team: &Team, now: &Current, prune: bool) -> Plan {
    let mut out = Plan::default();
    let known = |bot: &str| team.bots.contains_key(bot) || now.bots.contains_key(bot);

    // The bots.
    for (name, want) in &team.bots {
        let tgt = format!("bot {name}");
        let Some(have) = now.bots.get(name) else {
            let what = {
                let mut w = vec!["new".to_owned()];
                if let Some(m) = &want.model {
                    w.push(format!("model {m}"));
                }
                if want.governed == Some(true) {
                    w.push("governed".to_owned());
                }
                if let Some(n) = want.max_turns {
                    w.push(format!("max turns {n}"));
                }
                w.join(", ")
            };
            out.actions.push(Action {
                mark: '+',
                target: tgt.clone(),
                what,
                needs: None,
                op: Op::CreateBot {
                    name: name.clone(),
                    bot: want.clone(),
                },
            });
            for c in &want.connectors {
                out.actions.push(Action {
                    mark: '+',
                    target: tgt.clone(),
                    what: format!("connector {}", c.name),
                    needs: Some(name.clone()),
                    op: Op::AddConnector {
                        bot: name.clone(),
                        connector: c.clone(),
                    },
                });
            }
            out.actions.extend(new_bot_settings(name, want));
            if !want.skills.is_empty() {
                // Skills are checked once the bot exists: a new bot starts with the bundled ones.
                out.notes.push(format!("bot {name}: its skills ({}) are checked after it is made; one that is not installed is reported then", want.skills.join(", ")));
            }
            continue;
        };
        let mut what = Vec::new();
        let role = want
            .role
            .as_ref()
            .map(|r| r.trim().to_owned())
            .filter(|r| *r != have.role.trim());
        if role.is_some() {
            what.push("role");
        }
        let soul = want
            .soul_text
            .as_ref()
            .map(|s| s.trim().to_owned())
            .filter(|s| *s != have.soul.trim());
        if soul.is_some() {
            what.push("instructions");
        }
        let model = want
            .model
            .as_ref()
            .filter(|m| !same_model(m, &have.provider, &have.model))
            .cloned();
        if model.is_some() {
            what.push("model");
        }
        let look = want
            .look
            .as_ref()
            .filter(|l| have.look.as_ref() != Some(*l))
            .cloned();
        if look.is_some() {
            what.push("look");
        }
        let governed = want.governed.filter(|g| *g != have.governed);
        if governed.is_some() {
            what.push("governed switch");
        }
        let max_turns = want
            .max_turns
            .filter(|n| have.max_turns != Some(*n))
            .map(Cap::Turns);
        if max_turns.is_some() {
            what.push("max turns");
        }
        if !what.is_empty() {
            out.actions.push(Action {
                mark: '~',
                target: tgt.clone(),
                what: what.join(", "),
                needs: None,
                op: Op::UpdateBot {
                    name: name.clone(),
                    role,
                    soul,
                    model,
                    look,
                    governed,
                    max_turns,
                },
            });
        }
        out.actions.extend(bot_settings(name, want, have));
        let mut off = Vec::new();
        for s in &want.skills {
            match have.skills.iter().find(|(n, _)| n == s) {
                None => out.problems.push(format!("bot {name}: the skill {s:?} is not installed for it. Install it from the store, then apply again")),
                Some((_, false)) => off.push(s.clone()),
                Some((_, true)) => {}
            }
        }
        if !off.is_empty() {
            out.actions.push(Action {
                mark: '~',
                target: tgt.clone(),
                what: format!("switch on skill {}", off.join(", ")),
                needs: None,
                op: Op::EnableSkills {
                    bot: name.clone(),
                    skills: off,
                },
            });
        }
        for c in &want.connectors {
            match have.connectors.iter().find(|h| h.name == c.name) {
                None => out.actions.push(Action {
                    mark: '+',
                    target: tgt.clone(),
                    what: format!("connector {}", c.name),
                    needs: None,
                    op: Op::AddConnector {
                        bot: name.clone(),
                        connector: c.clone(),
                    },
                }),
                Some(h) => {
                    let differs = h.command != c.command
                        || h.url != c.url
                        || (c.command.is_some() && h.args != c.args);
                    if differs {
                        out.notes.push(format!("bot {name}: the connector {} is there with another command; it is left as it is (change it in Settings > Connectors)", c.name));
                    }
                }
            }
        }
        if prune {
            for h in &have.connectors {
                if !want.connectors.iter().any(|c| c.name == h.name) {
                    out.actions.push(Action {
                        mark: '-',
                        target: tgt.clone(),
                        what: format!("connector {}", h.name),
                        needs: None,
                        op: Op::RemoveConnector {
                            bot: name.clone(),
                            name: h.name.clone(),
                        },
                    });
                }
            }
        }
    }

    // The rooms.
    let mut room_ids: BTreeMap<String, String> = BTreeMap::new();
    for (name, want) in &team.rooms {
        let tgt = format!("room {name}");
        for m in &want.members {
            if !known(m) {
                out.problems.push(format!(
                    "room {name}: {m} is not a bot in the file or on this computer"
                ));
            }
        }
        let lead = want.lead.clone().unwrap_or_default();
        let purpose = want.purpose.clone().unwrap_or_default();
        match find_room(now, name, want.id.as_deref()) {
            None => {
                let id = want
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("g-{}", crate::rooms::slug(name)));
                room_ids.insert(name.clone(), id.clone());
                let needs = want
                    .members
                    .iter()
                    .find(|m| !now.bots.contains_key(*m))
                    .cloned();
                out.actions.push(Action {
                    mark: '+',
                    target: tgt,
                    what: format!(
                        "{} bots{}",
                        want.members.len(),
                        if lead.is_empty() {
                            String::new()
                        } else {
                            format!(", lead {lead}")
                        }
                    ),
                    needs,
                    op: Op::CreateRoom {
                        name: name.clone(),
                        id,
                        members: want.members.clone(),
                        lead: want.lead.clone(),
                        purpose: want.purpose.clone(),
                        max_rounds: want.max_rounds,
                    },
                });
            }
            Some(have) => {
                room_ids.insert(name.clone(), have.id.clone());
                if !same_set(&have.members, &want.members) {
                    out.notes.push(format!("room {name}: its members are {} and the file says {}. A room's members cannot be changed once it is made; make a room with another name to have them", have.members.join(", "), want.members.join(", ")));
                }
                let lead_differs = want.lead.is_some() && lead != have.lead;
                let purpose_differs =
                    want.purpose.is_some() && purpose.trim() != have.purpose.trim();
                if lead_differs || purpose_differs {
                    let mut w = Vec::new();
                    if lead_differs {
                        w.push("lead");
                    }
                    if purpose_differs {
                        w.push("purpose");
                    }
                    out.actions.push(Action {
                        mark: '~',
                        target: tgt.clone(),
                        what: w.join(", "),
                        needs: None,
                        op: Op::SetRoomContext {
                            id: have.id.clone(),
                            lead: if want.lead.is_some() {
                                lead
                            } else {
                                have.lead.clone()
                            },
                            purpose: if want.purpose.is_some() {
                                purpose
                            } else {
                                have.purpose.clone()
                            },
                        },
                    });
                }
                if want.max_rounds.is_some() && want.max_rounds != have.max_rounds {
                    out.actions.push(Action {
                        mark: '~',
                        target: tgt,
                        what: format!("max rounds {}", want.max_rounds.unwrap_or(0)),
                        needs: None,
                        op: Op::SetMaxRounds {
                            id: have.id.clone(),
                            max_rounds: want.max_rounds,
                        },
                    });
                }
            }
        }
    }

    // The boards.
    for (slug, want) in &team.boards {
        let tgt = format!("board {slug}");
        match now.boards.get(slug) {
            None => out.actions.push(Action {
                mark: '+',
                target: tgt,
                what: want.workdir.clone().unwrap_or_else(|| "new".to_owned()),
                needs: None,
                op: Op::CreateBoard {
                    slug: slug.clone(),
                    name: want.name.clone(),
                    workdir: want.workdir.clone(),
                },
            }),
            Some(have) => {
                let name = want.name.clone().filter(|n| *n != have.name);
                let workdir = want
                    .workdir
                    .clone()
                    .filter(|w| have.workdir.as_deref() != Some(w.as_str()));
                if name.is_some() || workdir.is_some() {
                    let what = [
                        name.as_ref().map(|_| "name"),
                        workdir.as_ref().map(|_| "folder"),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(", ");
                    out.actions.push(Action {
                        mark: '~',
                        target: tgt,
                        what,
                        needs: None,
                        op: Op::UpdateBoard {
                            slug: slug.clone(),
                            name,
                            workdir,
                        },
                    });
                }
            }
        }
    }

    // The jobs.
    for job in &team.cron {
        let tgt = format!("job {} of {}", job.name, job.bot);
        if !known(&job.bot) {
            out.problems.push(format!(
                "{tgt}: {} is not a bot in the file or on this computer",
                job.bot
            ));
            continue;
        }
        if let Some(r) = &job.room
            && !room_ids.contains_key(r)
        {
            if let Some(h) = find_room(now, r, None) {
                room_ids.insert(r.clone(), h.id.clone());
            } else {
                out.problems.push(format!(
                    "{tgt}: the room {r:?} is not in the file or on this computer"
                ));
                continue;
            }
        }
        let deliver = deliver_for(job, &room_ids);
        let needs = (!now.bots.contains_key(&job.bot)).then(|| job.bot.clone());
        let have = now
            .jobs
            .get(&job.bot)
            .and_then(|j| j.iter().find(|j| j.name.trim() == job.name.trim()));
        let prompt = job.prompt.clone().unwrap_or_default();
        match have {
            None => {
                out.actions.push(Action {
                    mark: '+',
                    target: tgt.clone(),
                    what: job.schedule.clone(),
                    needs: needs.clone(),
                    op: Op::AddJob {
                        bot: job.bot.clone(),
                        job: job.clone(),
                        deliver,
                    },
                });
                if job.paused {
                    out.actions.push(Action {
                        mark: '+',
                        target: tgt,
                        what: "paused".to_owned(),
                        needs,
                        op: Op::SetJobPaused {
                            bot: job.bot.clone(),
                            name: job.name.clone(),
                            paused: true,
                        },
                    });
                }
            }
            Some(h) => {
                let prompt_differs = if h.prompt_whole {
                    h.prompt.trim() != prompt.trim()
                } else {
                    !prompt
                        .trim()
                        .starts_with(h.prompt.trim().trim_end_matches("..."))
                };
                let deliver_differs = deliver.as_ref().is_some_and(|d| *d != h.deliver);
                let schedule_differs = h.schedule.trim() != job.schedule.trim();
                if prompt_differs || deliver_differs || schedule_differs {
                    let what = [
                        schedule_differs.then_some("schedule"),
                        prompt_differs.then_some("prompt"),
                        deliver_differs.then_some("delivery"),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(", ");
                    out.actions.push(Action {
                        mark: '~',
                        target: tgt.clone(),
                        what: format!("{what} (the job is made again, so it gets a new id)"),
                        needs: None,
                        op: Op::RemoveJob {
                            bot: job.bot.clone(),
                            id: h.id.clone(),
                        },
                    });
                    out.actions.push(Action {
                        mark: '~',
                        target: tgt.clone(),
                        what: job.schedule.clone(),
                        needs: None,
                        op: Op::AddJob {
                            bot: job.bot.clone(),
                            job: job.clone(),
                            deliver,
                        },
                    });
                    if job.paused {
                        out.actions.push(Action {
                            mark: '~',
                            target: tgt,
                            what: "paused".to_owned(),
                            needs: None,
                            op: Op::SetJobPaused {
                                bot: job.bot.clone(),
                                name: job.name.clone(),
                                paused: true,
                            },
                        });
                    }
                } else if h.paused != job.paused {
                    out.actions.push(Action {
                        mark: '~',
                        target: tgt,
                        what: if job.paused { "pause" } else { "resume" }.to_owned(),
                        needs: None,
                        op: Op::SetJobPaused {
                            bot: job.bot.clone(),
                            name: job.name.clone(),
                            paused: job.paused,
                        },
                    });
                }
            }
        }
    }

    if prune {
        for (bot, jobs) in &now.jobs {
            if !team.bots.contains_key(bot) {
                continue;
            }
            for j in jobs {
                if !team
                    .cron
                    .iter()
                    .any(|c| c.bot == *bot && c.name.trim() == j.name.trim())
                {
                    out.actions.push(Action {
                        mark: '-',
                        target: format!("job {} of {bot}", j.name),
                        what: "not in the file".to_owned(),
                        needs: None,
                        op: Op::RemoveJob {
                            bot: bot.clone(),
                            id: j.id.clone(),
                        },
                    });
                }
            }
        }
        for r in &now.rooms {
            let wanted = team.rooms.iter().any(|(n, w)| {
                w.id.as_deref() == Some(r.id.as_str())
                    || n.trim().eq_ignore_ascii_case(r.name.trim())
            });
            if !wanted {
                out.actions.push(Action {
                    mark: '-',
                    target: format!("room {}", r.name),
                    what: "disband (permanent)".to_owned(),
                    needs: None,
                    op: Op::DisbandRoom { id: r.id.clone() },
                });
            }
        }
        for slug in now.boards.keys() {
            if slug != "default" && !team.boards.contains_key(slug) {
                out.actions.push(Action {
                    mark: '-',
                    target: format!("board {slug}"),
                    what: "archive".to_owned(),
                    needs: None,
                    op: Op::ArchiveBoard { slug: slug.clone() },
                });
            }
        }
        for name in now.bots.keys() {
            if !team.bots.contains_key(name) {
                out.actions.push(Action {
                    mark: '-',
                    target: format!("bot {name}"),
                    what: "archive (it can be restored)".to_owned(),
                    needs: None,
                    op: Op::ArchiveBot { name: name.clone() },
                });
            }
        }
    }
    out
}

fn same_set(a: &[String], b: &[String]) -> bool {
    let mut a = a.to_vec();
    let mut b = b.to_vec();
    a.sort();
    b.sort();
    a == b
}
