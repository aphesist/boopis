//! A room's log for clients (B26): read as lines (`rooms/lines.rs`, the words `boopis groups log` prints), followed for the
//! feed (`room.line`, `room.state`, and the reply, mention and error notifications with the room and the member's words,
//! B22), and a bot's or a room's turn stopped. Every engine question goes through [`Engine`]; nothing here is the engine's
//! own object passed on.

use serde_json::{Value, json};

use super::audit::Line as AuditLine;
use super::engine::Engine;
use super::model::{LineFrom, RoomLine, RoomLog, now_ms};
use super::service::{ApiError, Caller, Service, failed, text};
use crate::rooms::lines::{self, Speaker};
use crate::rooms::{self, Room, Rpc as _, mentions};

fn audit(by: &Caller, profile: &str, session: &str, action: &str, outcome: &str) -> AuditLine {
    AuditLine {
        at: now_ms(),
        profile: profile.to_owned(),
        session_id: session.to_owned(),
        prompt_id: String::new(),
        choice: action.to_owned(),
        outcome: outcome.to_owned(),
        surface: by.surface.to_owned(),
    }
}

impl<E: Engine> Service<E> {
    /// One event of a room's log as the contract's line, or `None` when it is not a line.
    fn room_line(&self, room: &Room, e: &rooms::Event) -> Option<(RoomLine, Option<String>)> {
        let l = lines::line(room, e)?;
        let (from, member) = match &l.from {
            Speaker::User => (LineFrom::User, None),
            Speaker::Member(id) => (LineFrom::Member, Some(id.clone())),
            Speaker::Boopis => (LineFrom::Boopis, l.about.clone()),
        };
        let seat = member
            .as_deref()
            .and_then(|id| room.members.iter().find(|m| m.id == id));
        let handles: Vec<&str> = room.members.iter().map(|m| m.handle.as_str()).collect();
        let mentions_you = from == LineFrom::Member && mentions::addresses_user(&l.text, &handles);
        let (words, truncated) = self.feed.line_text(&l.text);
        #[allow(clippy::cast_possible_truncation)] // seconds since 1970, as milliseconds
        let at = (l.at * 1000.0) as i64;
        let profile = seat.map(|m| m.profile.clone());
        Some((
            RoomLine {
                seq: l.seq,
                id: l.id,
                at,
                kind: l.kind,
                from,
                name: seat.map_or_else(String::new, |m| m.name.clone()),
                member,
                text: words,
                truncated,
                mentions_you,
            },
            profile,
        ))
    }

    /// A room's log as lines: the newest `limit` events (or those after `after`), who is at work, and what the room holds.
    ///
    /// # Errors
    /// A refusal in words (no such room), or the engine's failure.
    pub async fn room_log(
        &self,
        room_id: &str,
        after: Option<u64>,
        limit: usize,
    ) -> std::result::Result<RoomLog, ApiError> {
        let room = self.room(room_id).await?;
        let last_event_id = self.feed.last_id();
        let rpc = self.rpc();
        let state = rooms::state(&rpc, room_id)
            .await
            .map_err(|e| failed("read the room", &e))?;
        let limit = limit.clamp(1, 200);
        let since = if let Some(a) = after {
            a
        } else {
            let tail = rpc
                .call(
                    "groups.log",
                    json!({"room_id": room_id, "since_seq": 0, "limit": 1}),
                )
                .await
                .map_err(|e| failed("read the room", &e))?;
            let latest = tail.get("latest_seq").and_then(Value::as_u64).unwrap_or(0);
            latest.saturating_sub(u64::try_from(limit).unwrap_or(u64::MAX))
        };
        let page = rpc
            .call(
                "groups.log",
                json!({"room_id": room_id, "since_seq": since, "limit": limit}),
            )
            .await
            .map_err(|e| failed("read the room", &e))?;
        let events: Vec<rooms::Event> = page
            .get("events")
            .and_then(Value::as_array)
            .map(|rows| rows.iter().map(rooms::Event::from_value).collect())
            .unwrap_or_default();
        let latest_seq = page
            .get("latest_seq")
            .and_then(Value::as_u64)
            .or_else(|| events.last().map(|e| e.seq))
            .unwrap_or(since);
        Ok(RoomLog {
            room_id: room.id.clone(),
            name: room.name.clone(),
            lines: events
                .iter()
                .filter_map(|e| self.room_line(&room, e).map(|(l, _)| l))
                .collect(),
            latest_seq,
            more: page.get("has_more").and_then(Value::as_bool) == Some(true),
            working: if state.working {
                state.at_work
            } else {
                Vec::new()
            },
            held: self.room_held(room_id).await,
            last_event_id,
        })
    }

    /// Read what is new in each room's log for the feed: `room.line` events, the reply, mention and error notifications,
    /// and `room.state`. A room seen for the first time starts at its end: its history is no news.
    pub(super) async fn follow_rooms(&self) {
        let rpc = self.rpc();
        let Ok(all) = rooms::list(&rpc, false).await else {
            return;
        };
        let mut cursors = self.room_cursors.lock().await;
        for room in all.iter().filter(|r| !r.disbanded) {
            let Some(latest) = room.latest_seq else {
                continue;
            };
            let Some(&from) = cursors.get(&room.id) else {
                cursors.insert(room.id.clone(), latest);
                continue;
            };
            if latest <= from {
                continue;
            }
            let Ok(events) = rooms::log_since(&rpc, &room.id, from).await else {
                continue;
            };
            let mut at = from;
            for e in &events {
                at = at.max(e.seq);
                if let Some((line, profile)) = self.room_line(room, e) {
                    self.feed
                        .on_room_line(&room.id, &room.name, line, profile.as_deref());
                }
            }
            cursors.insert(room.id.clone(), at);
            if let Ok(state) = rooms::state(&rpc, &room.id).await {
                let working = if state.working {
                    state.at_work
                } else {
                    Vec::new()
                };
                self.feed.on_room_state(&room.id, &working);
            }
        }
        cursors.retain(|id, _| all.iter().any(|r| &r.id == id));
    }

    /// Stop the work running or queued in a room (`groups.stop`). Its held messages go out once it is free.
    ///
    /// # Errors
    /// A refusal in words (no such room), or the engine's failure.
    pub async fn room_stop(
        &self,
        room_id: &str,
        by: &Caller,
    ) -> std::result::Result<Value, ApiError> {
        self.room(room_id).await?;
        let res = self
            .rpc()
            .call(
                "groups.stop",
                json!({"room_id": room_id, "cancel_id": rooms::new_event_id("stop")}),
            )
            .await;
        let outcome = if res.is_ok() { "delivered" } else { "failed" };
        self.feed
            .record(&audit(by, "", room_id, "stop_room", outcome));
        let res = res.map_err(|e| failed("stop the group", &e))?;
        Ok(json!({
            "stopped": true,
            "cancelled": res.get("cancelled").and_then(Value::as_u64).unwrap_or(0),
            "held": self.room_held(room_id).await,
        }))
    }

    /// Stop a bot's running turn (`session.interrupt` on its own link): every live session of the bot that is not idle, or
    /// only `session` (a live or stored id) when it is given.
    ///
    /// # Errors
    /// `404 no_such_bot`, `409 not_running` when nothing of it runs on the engine here, or the engine's failure.
    pub async fn bot_stop(
        &self,
        profile: &str,
        session: Option<&str>,
        by: &Caller,
    ) -> std::result::Result<Value, ApiError> {
        if !self.knows_bot(profile).await {
            return Err(ApiError::new(
                404,
                "no_such_bot",
                "There is no bot with that name.",
            ));
        }
        let list = self
            .engine
            .request(profile, "session.active_list", json!({}))
            .await
            .map_err(|e| failed("read the bot's sessions", &e))?;
        let running: Vec<String> = list
            .get("sessions")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter(|r| !matches!(text(r, "status").as_str(), "idle" | ""))
                    .filter(|r| {
                        session.is_none_or(|s| text(r, "id") == s || text(r, "session_key") == s)
                    })
                    .map(|r| text(r, "id"))
                    .filter(|id| !id.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if running.is_empty() {
            let worker = self.worker_of(profile).is_some();
            return Err(ApiError::new(
                409,
                "not_running",
                if worker {
                    "Its turn runs as a kanban worker, which the engine runs outside its sessions: it cannot be stopped from here."
                } else {
                    "That bot has no running turn to stop."
                },
            ));
        }
        let mut stopped = Vec::new();
        for sid in running {
            let res = self
                .engine
                .request(profile, "session.interrupt", json!({"session_id": sid}))
                .await;
            let outcome = if res.is_ok() { "delivered" } else { "failed" };
            self.feed.record(&audit(by, profile, &sid, "stop", outcome));
            if res.is_ok() {
                stopped.push(sid);
            }
        }
        if stopped.is_empty() {
            return Err(ApiError::new(
                502,
                "engine_unavailable",
                "boopis could not stop the turn: its engine did not answer. Try again in a moment.",
            ));
        }
        self.poll_profile_now(profile).await;
        Ok(json!({"stopped": stopped}))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use serde_json::{Value, json};

    use super::*;
    use crate::config::{ApiLimits, RoomLimits};
    use crate::error::Error;
    use crate::local_api::audit::Audit;
    use crate::local_api::engine::scripted::Scripted;
    use crate::local_api::feed::Feed;
    use crate::local_api::model::{Event, NoteKind, Source};
    use crate::rooms::hold;

    type Log = std::sync::Arc<Mutex<Vec<Value>>>;

    fn ev(seq: u32, kind: &str, payload: &Value) -> Value {
        json!({"seq": seq, "event_id": format!("e{seq}"), "kind": kind, "actor": {"id": "x"}, "payload": payload, "created_at": 1000.0 + f64::from(seq)})
    }

    /// A root link with one room, `paper past` (kai, nina), whose log the test writes, and bots with sessions.
    fn engine(log: Log) -> Scripted {
        Scripted::new(move |profile, method, params| {
            let room = json!({"room_id": "g-paper", "name": "paper past", "latest_seq": log.lock().unwrap().len(), "members": [
                {"member_id": "kai", "profile": "kai", "handle": "kai", "display_name": "Kai"},
                {"member_id": "nina", "profile": "nina", "handle": "nina", "display_name": "Nina"}]});
            match method {
                "profiles.list" => Ok(json!({"profiles": [
                    {"name": "default", "model": "opus", "provider": "p"},
                    {"name": "kai", "model": "opus", "provider": "p", "display_name": "Kai"},
                    {"name": "nina", "model": "opus", "provider": "p", "display_name": "Nina"}]})),
                "plugin.boopis.bots.read" => Ok(json!({"bots": []})),
                "groups.list" => Ok(json!({"rooms": [room]})),
                "groups.log" => {
                    let since = params["since_seq"].as_u64().unwrap_or(0);
                    let all = log.lock().unwrap().clone();
                    let limit = usize::try_from(params["limit"].as_u64().unwrap_or(200)).unwrap();
                    let events: Vec<Value> = all
                        .iter()
                        .filter(|e| e["seq"].as_u64().unwrap() > since)
                        .take(limit)
                        .cloned()
                        .collect();
                    Ok(json!({"events": events, "latest_seq": all.len(), "has_more": false}))
                }
                "groups.state" => Ok(
                    json!({"room": room, "driver_status": {"working": true, "blocked": false,
                    "pending_actions": [], "member_activity": [{"member_id": "nina", "status": "running"}]}}),
                ),
                "groups.stop" => Ok(json!({"cancelled": 2})),
                "session.active_list" if profile == "kai" => Ok(json!({"sessions": [
                    {"id": "live-k", "status": "working", "session_key": "stored-k", "title": "Group: g-paper", "preview": ""},
                    {"id": "idle-k", "status": "idle", "session_key": "stored-i", "title": "", "preview": ""}]})),
                "session.active_list" => Ok(json!({"sessions": []})),
                "session.interrupt" => Ok(json!({"ok": true})),
                _ => Err(Error::Unavailable(format!("unscripted {method}"))),
            }
        })
    }

    fn service(log: &Log) -> (Arc<Service<Scripted>>, Arc<Scripted>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let feed = Feed::new(Audit::under(dir.path()), ApiLimits::default());
        let engine = Arc::new(engine(log.clone()));
        let s = Service::new(
            feed,
            engine.clone(),
            ApiLimits::default(),
            hold::Store::under(dir.path()),
            RoomLimits::default(),
        );
        (s, engine, dir)
    }

    fn drain(
        rx: &mut tokio::sync::broadcast::Receiver<Arc<crate::local_api::model::Stamped>>,
    ) -> Vec<Event> {
        let mut out = Vec::new();
        while let Ok(e) = rx.try_recv() {
            out.push(e.event.clone());
        }
        out
    }

    #[tokio::test]
    async fn a_rooms_log_reads_as_lines_with_the_cancelled_turn_and_the_owners_mention() {
        let log: Log = std::sync::Arc::default();
        {
            let mut l = log.lock().unwrap();
            l.push(ev(
                1,
                "message.user",
                &json!({"thread_id": "main", "text": "open every source"}),
            ));
            l.push(ev(
                2,
                "turn.cancelled",
                &json!({"member_id": "kai", "reason": "superseded_by_newer_user_event"}),
            ));
            l.push(ev(3, "message.member", &json!({"member_id": "nina", "text": "@user which one do I cut? password: hunter22secret"})));
            l.push(ev(4, "turn.settled", &json!({"member_id": "nina"})));
        }
        let (s, _e, _d) = service(&log);
        let read = s.room_log("g-paper", None, 50).await.unwrap();
        assert_eq!(
            read.lines.iter().map(|l| l.seq).collect::<Vec<_>>(),
            [1, 2, 3],
            "bookkeeping is not a line"
        );
        assert_eq!(
            (read.lines[1].from, read.lines[1].member.as_deref()),
            (LineFrom::Boopis, Some("kai"))
        );
        assert!(read.lines[1].text.starts_with("Kai's turn was stopped"));
        let nina = &read.lines[2];
        assert_eq!(
            (nina.from, nina.name.as_str(), nina.mentions_you),
            (LineFrom::Member, "Nina", true)
        );
        assert!(
            !nina.text.contains("hunter22secret"),
            "scrubbed: {}",
            nina.text
        );
        assert_eq!(
            (read.latest_seq, read.working.clone()),
            (4, vec!["nina".to_owned()])
        );
        let after = s.room_log("g-paper", Some(2), 50).await.unwrap();
        assert_eq!(after.lines.iter().map(|l| l.seq).collect::<Vec<_>>(), [3]);
        assert_eq!(
            s.room_log("g-nope", None, 5).await.unwrap_err().code,
            "no_such_room"
        );
    }

    #[tokio::test]
    async fn following_rooms_tells_new_lines_with_the_reply_words_the_room_and_a_loud_mention() {
        let log: Log = std::sync::Arc::default();
        log.lock().unwrap().push(ev(
            1,
            "message.member",
            &json!({"member_id": "kai", "text": "old news"}),
        ));
        let (s, _e, _d) = service(&log);
        let mut rx = s.feed().subscribe(None).rx;
        s.follow_rooms().await;
        assert!(
            drain(&mut rx).is_empty(),
            "a room seen for the first time starts at its end"
        );
        {
            let mut l = log.lock().unwrap();
            l.push(ev(
                2,
                "message.member",
                &json!({"member_id": "kai", "text": "Table posted."}),
            ));
            l.push(ev(
                3,
                "message.member",
                &json!({"member_id": "nina", "text": "@user should I apply the two blockers?"}),
            ));
            l.push(ev(4, "turn.failed", &json!({"member_id": "nina", "error": "Unknown provider 'x'", "reason_code": "missing_config"})));
        }
        s.refresh_roster().await;
        s.follow_rooms().await;
        let events = drain(&mut rx);
        let notes: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                Event::Notification(n) => Some(n.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(notes.len(), 3, "{notes:?}");
        assert_eq!(
            (notes[0].kind, notes[0].body.as_str()),
            (NoteKind::Reply, "Table posted."),
            "B22: the words"
        );
        assert_eq!(
            notes[0].room_id.as_deref(),
            Some("g-paper"),
            "B22: the room"
        );
        assert_eq!(
            (notes[0].source, notes[0].title.as_str()),
            (Source::Room, "Kai replied in paper past")
        );
        assert_eq!(
            (notes[1].kind, notes[1].urgent, notes[1].profile.as_str()),
            (NoteKind::Mention, true, "nina")
        );
        assert_eq!(notes[1].title, "Nina mentioned you in paper past");
        // B41: the mention carries the room, the message's place and id, and its words
        assert_eq!(
            (
                notes[1].room_id.as_deref(),
                notes[1].seq,
                notes[1].message_id.as_deref()
            ),
            (Some("g-paper"), Some(3), Some("e3"))
        );
        assert_eq!(notes[1].body, "@user should I apply the two blockers?");
        assert_eq!(notes[2].kind, NoteKind::Error);
        assert!(
            notes[2].body.starts_with("Nina can't reach its model."),
            "{}",
            notes[2].body
        );
        let lines = events
            .iter()
            .filter(|e| matches!(e, Event::RoomLine(_)))
            .count();
        assert_eq!(lines, 3);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, Event::RoomState(st) if st.working == ["nina"]))
        );
        s.follow_rooms().await;
        assert!(
            drain(&mut rx)
                .iter()
                .all(|e| !matches!(e, Event::RoomLine(_))),
            "nothing told twice"
        );
    }

    #[tokio::test]
    async fn two_messages_of_one_member_in_a_row_are_two_notifications() {
        let log: Log = std::sync::Arc::default();
        log.lock().unwrap().push(ev(
            1,
            "message.member",
            &json!({"member_id": "kai", "text": "old news"}),
        ));
        let (s, _e, _d) = service(&log);
        let mut rx = s.feed().subscribe(None).rx;
        s.follow_rooms().await;
        drain(&mut rx);
        {
            let mut l = log.lock().unwrap();
            l.push(ev(
                2,
                "message.member",
                &json!({"member_id": "kai", "text": "Table posted."}),
            ));
            l.push(ev(
                3,
                "message.member",
                &json!({"member_id": "kai", "text": "And the sources."}),
            ));
        }
        s.refresh_roster().await;
        s.follow_rooms().await;
        let notes: Vec<_> = drain(&mut rx)
            .into_iter()
            .filter_map(|e| match e {
                Event::Notification(n) => Some(n),
                _ => None,
            })
            .collect();
        assert_eq!(
            notes
                .iter()
                .map(|n| (n.seq, n.message_id.as_deref(), n.body.as_str()))
                .collect::<Vec<_>>(),
            [
                (Some(2), Some("e2"), "Table posted."),
                (Some(3), Some("e3"), "And the sources.")
            ],
            "kai's second message within seconds is its own news"
        );
    }

    #[tokio::test]
    async fn a_room_member_session_is_told_by_the_engines_own_title_and_summarised_by_its_room() {
        let log: Log = std::sync::Arc::default();
        let (s, _e, _d) = service(&log);
        s.refresh_roster().await;
        s.poll_once().await;
        let kai = s
            .feed()
            .presence()
            .into_iter()
            .find(|p| p.profile == "kai")
            .unwrap();
        assert_eq!(
            kai.source,
            Some(Source::Room),
            "B25: `Group: <room id>` is the engine's own name for it"
        );
        assert_eq!(kai.summary.as_deref(), Some("In paper past"));
        assert_eq!(kai.steps, None, "a poll cannot count steps");
        let nina = s
            .feed()
            .presence()
            .into_iter()
            .find(|p| p.profile == "nina")
            .unwrap();
        assert_eq!(nina.source, None, "idle has no source");
    }

    #[tokio::test]
    async fn stopping_a_bot_or_a_room_reaches_the_engine_and_is_recorded() {
        let log: Log = std::sync::Arc::default();
        let (s, e, dir) = service(&log);
        s.refresh_roster().await;
        let by = Caller::through("endpoint");
        let out = s.bot_stop("kai", None, &by).await.unwrap();
        assert_eq!(
            out["stopped"],
            json!(["live-k"]),
            "only the running session"
        );
        assert_eq!(
            e.of("session.interrupt")[0].0,
            "kai",
            "on the bot's own link"
        );
        let by_stored = s.bot_stop("kai", Some("stored-k"), &by).await.unwrap();
        assert_eq!(by_stored["stopped"], json!(["live-k"]));
        assert_eq!(
            s.bot_stop("nina", None, &by).await.unwrap_err().code,
            "not_running"
        );
        assert_eq!(
            s.bot_stop("nobody", None, &by).await.unwrap_err().code,
            "no_such_bot"
        );
        let room = s.room_stop("g-paper", &by).await.unwrap();
        assert_eq!(room["cancelled"], 2);
        let audit = std::fs::read_to_string(Audit::under(dir.path()).path()).unwrap();
        assert!(
            audit.contains("\"choice\":\"stop\"") && audit.contains("\"choice\":\"stop_room\""),
            "{audit}"
        );
        assert!(audit.contains("\"surface\":\"endpoint\""));
    }
}
