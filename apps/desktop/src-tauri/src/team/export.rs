//! `team export`: what is there, written as a team file. The same file read back and planned against the same machine is an
//! empty plan. Nothing secret is in it: a server's environment values are not listed by the engine and are not written.

use std::collections::BTreeMap;

use super::plan::{Current, JobNow};
use super::spec::{Board, Bot, Connector, Cron, Room, Team, VERSION};

/// The model as the file names it: bare when it is the root's provider's, `provider/model` otherwise.
fn model_label(now: &Current, provider: &str, model: &str) -> Option<String> {
    if model.is_empty() {
        return None;
    }
    Some(if provider.is_empty() || provider == now.default_provider {
        model.to_owned()
    } else {
        format!("{provider}/{model}")
    })
}

/// A team written out, and what could not be written whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exported {
    /// The team.
    pub team: Team,
    /// What is missing from it, and why.
    pub warnings: Vec<String>,
}

/// Write `now` as a team.
#[must_use]
pub fn export(now: &Current) -> Exported {
    let mut warnings = Vec::new();
    let mut team = Team {
        version: VERSION,
        ..Team::default()
    };
    for (name, b) in &now.bots {
        let skills: Vec<String> = match &now.baseline_skills {
            // what a new bot would not have on: every skill but the bundled ones the bots' default index keeps (ADR-0047)
            Some(base) => b
                .skills
                .iter()
                .filter(|(n, on)| *on && !crate::bots::skills::a_new_bot_has(n, base))
                .map(|(n, _)| n.clone())
                .collect(),
            None => Vec::new(),
        };
        team.bots.insert(
            name.clone(),
            Bot {
                role: Some(b.role.clone()).filter(|r| !r.trim().is_empty()),
                soul: None,
                soul_text: Some(b.soul.clone()).filter(|s| !s.trim().is_empty()),
                model: model_label(now, &b.provider, &b.model),
                look: b.look.clone(),
                skills,
                connectors: b
                    .connectors
                    .iter()
                    .map(|c| Connector {
                        name: c.name.clone(),
                        command: c.command.clone(),
                        args: c.args.clone(),
                        env: BTreeMap::new(),
                        url: c.url.clone(),
                    })
                    .collect(),
                governed: Some(b.governed),
                max_turns: b.max_turns,
                // every toolset it has on, so an apply elsewhere gives it exactly these (ADR-0048)
                toolsets: Some(
                    b.toolsets
                        .iter()
                        .filter(|(_, on)| *on)
                        .map(|(n, _)| n.clone())
                        .collect(),
                )
                .filter(|t: &Vec<String>| !t.is_empty()),
                project: b.project.clone(),
            },
        );
    }
    let mut names: BTreeMap<String, String> = BTreeMap::new(); // room id -> the name it has in the file
    for r in &now.rooms {
        let mut key = r.name.trim().to_owned();
        let mut n = 2;
        while team.rooms.contains_key(&key) {
            key = format!("{} ({n})", r.name.trim());
            n += 1;
        }
        names.insert(r.id.clone(), key.clone());
        team.rooms.insert(
            key,
            Room {
                id: Some(r.id.clone()),
                members: r.members.clone(),
                lead: Some(r.lead.clone()).filter(|l| !l.is_empty()),
                purpose: Some(r.purpose.clone()).filter(|p| !p.trim().is_empty()),
                purpose_file: None,
                max_rounds: r.max_rounds,
            },
        );
    }
    for (slug, b) in &now.boards {
        if slug == "default" && b.workdir.is_none() {
            continue;
        }
        team.boards.insert(
            slug.clone(),
            Board {
                name: Some(b.name.clone()).filter(|n| !n.is_empty()),
                workdir: b.workdir.clone(),
            },
        );
    }
    for (bot, jobs) in &now.jobs {
        for j in jobs {
            if !j.prompt_whole {
                warnings.push(format!(
                    "the job {} of {bot} is written with the start of its prompt only: the whole text could not be read",
                    j.name
                ));
            }
            team.cron.push(cron_of(bot, j, &names));
        }
    }
    Exported { team, warnings }
}

fn cron_of(bot: &str, j: &JobNow, names: &BTreeMap<String, String>) -> Cron {
    let mut c = Cron {
        bot: bot.to_owned(),
        name: j.name.clone(),
        schedule: j.schedule.clone(),
        prompt: Some(j.prompt.clone()),
        paused: j.paused,
        ..Cron::default()
    };
    // `room:<id>@<bot>` for a room of this file is written as the room's name; anything else stays as the engine wrote it.
    let parsed = j
        .deliver
        .strip_prefix("room:")
        .and_then(|r| r.rsplit_once('@'));
    match parsed {
        Some((id, who)) if names.contains_key(id) => {
            c.room = names.get(id).cloned();
            if who != bot {
                c.post_as = Some(who.to_owned());
            }
        }
        _ if j.deliver.is_empty() || j.deliver == "local" => {}
        _ => c.deliver = Some(j.deliver.clone()),
    }
    c
}
