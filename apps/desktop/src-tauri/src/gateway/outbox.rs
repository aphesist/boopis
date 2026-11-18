//! The queue between the gateway and one UI connection. Bounded, with a drop policy that never drops a response:
//! past the soft cap, adjacent `message.delta` frames of one session are merged (and counted, so it can be
//! reported); past the hard cap the connection is declared too slow and closed, and the UI reconnects and replays.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;

use tokio::sync::Notify;

/// A queued frame and, for a `message.delta`, what is needed to merge it.
#[derive(Debug)]
struct Queued {
    text: Arc<str>,
    delta_of: Option<String>,
}

/// What `push` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Push {
    /// Queued as it is.
    Queued,
    /// Merged into the delta before it (the queue was past its soft cap).
    Coalesced,
    /// The hard cap was hit: the connection is closed.
    TooSlow,
    /// The queue is closed.
    Closed,
}

#[derive(Debug, Default)]
struct Inner {
    q: VecDeque<Queued>,
    closed: bool,
    too_slow: bool,
    coalesced: u64,
}

/// A bounded frame queue for one consumer.
#[derive(Debug)]
pub struct Outbox {
    inner: Mutex<Inner>,
    ready: Notify,
    soft: usize,
    hard: usize,
}

impl Outbox {
    /// A queue that coalesces past `soft` frames and closes past `hard`.
    #[must_use]
    pub fn new(soft: usize, hard: usize) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            ready: Notify::new(),
            soft,
            hard,
        }
    }

    /// Queue a frame. `delta_session` is the session id when the frame is a `message.delta` (it may be merged).
    pub fn push(&self, text: Arc<str>, delta_session: Option<&str>) -> Push {
        let Ok(mut g) = self.inner.lock() else {
            return Push::Closed;
        };
        if g.closed {
            return Push::Closed;
        }
        if g.q.len() >= self.soft
            && let (Some(sess), Some(last)) = (delta_session, g.q.back_mut())
            && last.delta_of.as_deref() == Some(sess)
            && let Some(merged) = merge_deltas(&last.text, &text)
        {
            last.text = merged.into();
            g.coalesced += 1;
            return Push::Coalesced;
        }
        if g.q.len() >= self.hard {
            g.too_slow = true;
            g.closed = true;
            drop(g);
            self.ready.notify_one();
            return Push::TooSlow;
        }
        g.q.push_back(Queued {
            text,
            delta_of: delta_session.map(str::to_owned),
        });
        drop(g);
        self.ready.notify_one();
        Push::Queued
    }

    /// The next frame; waits when empty. `None` once the queue is closed and drained.
    pub async fn pop(&self) -> Option<Arc<str>> {
        loop {
            let notified = self.ready.notified();
            {
                let mut g = self.inner.lock().ok()?;
                if let Some(q) = g.q.pop_front() {
                    return Some(q.text);
                }
                if g.closed {
                    return None;
                }
            }
            notified.await;
        }
    }

    /// Close the queue. Frames already queued are still delivered.
    pub fn close(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.closed = true;
        }
        self.ready.notify_one();
    }

    /// Whether the queue closed because the consumer was too slow.
    #[must_use]
    pub fn was_too_slow(&self) -> bool {
        self.inner.lock().is_ok_and(|g| g.too_slow)
    }

    /// How many deltas were merged so far.
    #[must_use]
    pub fn coalesced(&self) -> u64 {
        self.inner.lock().map_or(0, |g| g.coalesced)
    }

    /// Frames waiting.
    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.lock().map_or(0, |g| g.q.len())
    }

    /// Whether nothing waits.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Merge two `message.delta` event frames of one session: the first keeps its place and gets both texts, and the
/// second's `seq`. `None` when either does not have the expected shape (then they stay separate).
fn merge_deltas(first: &str, second: &str) -> Option<String> {
    let mut a: serde_json::Value = serde_json::from_str(first).ok()?;
    let b: serde_json::Value = serde_json::from_str(second).ok()?;
    let text_b = text_of(&b)?;
    let joined = format!("{}{text_b}", text_of(&a)?);
    let params = a.get_mut("params")?.as_object_mut()?;
    params
        .get_mut("payload")?
        .as_object_mut()?
        .insert("text".into(), joined.into());
    if let Some(seq) = b.get("params").and_then(|p| p.get("seq")) {
        params.insert("seq".into(), seq.clone());
    }
    serde_json::to_string(&a).ok()
}

fn text_of(frame: &serde_json::Value) -> Option<&str> {
    match frame.get("params")?.get("payload")?.get("text")? {
        serde_json::Value::String(s) => Some(s),
        serde_json::Value::Null => Some(""),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delta(sess: &str, text: &str, seq: u64) -> Arc<str> {
        serde_json::json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":sess,"payload":{"text":text},"seq":seq}}).to_string().into()
    }
    fn response(id: u64) -> Arc<str> {
        serde_json::json!({"jsonrpc":"2.0","id":id,"result":{}})
            .to_string()
            .into()
    }

    #[tokio::test]
    async fn delivers_in_order_below_the_soft_cap() {
        let q = Outbox::new(8, 16);
        for i in 0..5 {
            assert_eq!(
                q.push(delta("s", &i.to_string(), i), Some("s")),
                Push::Queued
            );
        }
        for i in 0..5 {
            let f: serde_json::Value = serde_json::from_str(&q.pop().await.unwrap()).unwrap();
            assert_eq!(f["params"]["payload"]["text"], i.to_string());
        }
        assert_eq!(q.coalesced(), 0);
    }

    #[tokio::test]
    async fn past_the_soft_cap_adjacent_deltas_merge_and_are_counted() {
        let q = Outbox::new(2, 100);
        assert_eq!(q.push(delta("s", "a", 1), Some("s")), Push::Queued);
        assert_eq!(q.push(delta("s", "b", 2), Some("s")), Push::Queued);
        assert_eq!(q.push(delta("s", "c", 3), Some("s")), Push::Coalesced);
        assert_eq!(q.push(delta("s", "d", 4), Some("s")), Push::Coalesced);
        assert_eq!(q.coalesced(), 2);
        assert_eq!(q.len(), 2);
        q.pop().await;
        let merged: serde_json::Value = serde_json::from_str(&q.pop().await.unwrap()).unwrap();
        assert_eq!(
            merged["params"]["payload"]["text"], "bcd",
            "nothing lost, order kept"
        );
        assert_eq!(merged["params"]["seq"], 4);
    }

    #[test]
    fn deltas_of_different_sessions_and_non_deltas_never_merge() {
        let q = Outbox::new(1, 100);
        q.push(delta("a", "x", 1), Some("a"));
        assert_eq!(q.push(delta("b", "y", 2), Some("b")), Push::Queued);
        assert_eq!(
            q.push(response(1), None),
            Push::Queued,
            "a response is never dropped or merged"
        );
        assert_eq!(
            q.push(delta("b", "z", 3), Some("b")),
            Push::Queued,
            "a response sits between: order is kept"
        );
        assert_eq!(q.coalesced(), 0);
        assert_eq!(q.len(), 4);
    }

    #[tokio::test]
    async fn null_text_counts_as_empty() {
        let q = Outbox::new(1, 100);
        let null: Arc<str> = serde_json::json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s","payload":{"text":null},"seq":1}}).to_string().into();
        q.push(null, Some("s"));
        assert_eq!(q.push(delta("s", "hi", 2), Some("s")), Push::Coalesced);
        let f: serde_json::Value = serde_json::from_str(&q.pop().await.unwrap()).unwrap();
        assert_eq!(f["params"]["payload"]["text"], "hi");
    }

    #[tokio::test]
    async fn the_hard_cap_closes_the_connection_but_queued_frames_are_delivered() {
        let q = Outbox::new(1, 3);
        for i in 0..3 {
            assert_eq!(q.push(response(i), None), Push::Queued);
        }
        assert_eq!(q.push(response(9), None), Push::TooSlow);
        assert!(q.was_too_slow());
        assert_eq!(q.push(response(10), None), Push::Closed);
        let mut n = 0;
        while q.pop().await.is_some() {
            n += 1;
        }
        assert_eq!(n, 3);
    }

    #[tokio::test]
    async fn pop_waits_for_a_push_and_ends_on_close() {
        let q = Arc::new(Outbox::new(4, 8));
        let waiter = tokio::spawn({
            let q = q.clone();
            async move { (q.pop().await.is_some(), q.pop().await.is_none()) }
        });
        tokio::task::yield_now().await;
        q.push(response(1), None);
        q.close();
        assert_eq!(waiter.await.unwrap(), (true, true));
    }
}
