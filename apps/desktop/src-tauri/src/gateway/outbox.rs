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
    batched: u64,
    peak: usize,
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
        g.peak = g.peak.max(g.q.len());
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

    /// The next frames, at most `max_frames` of them and about `max_bytes` (a single larger frame still goes alone);
    /// waits when empty. Adjacent `message.delta` frames of one session are merged on the way (text concatenated, the
    /// later `seq` kept), so a consumer that fell behind gets one frame per run of text instead of one per chunk.
    /// `None` once the queue is closed and drained.
    pub async fn pop_batch(&self, max_frames: usize, max_bytes: usize) -> Option<Vec<Arc<str>>> {
        loop {
            let notified = self.ready.notified();
            {
                let mut g = self.inner.lock().ok()?;
                if !g.q.is_empty() {
                    let mut out: Vec<Queued> = Vec::new();
                    let mut bytes = 0usize;
                    let mut merged = 0u64;
                    while let Some(next) = g.q.front() {
                        if let (Some(last), Some(sess)) = (out.last_mut(), next.delta_of.as_deref())
                            && last.delta_of.as_deref() == Some(sess)
                            && let Some(joined) = merge_runs(&last.text, &next.text)
                        {
                            bytes = bytes + joined.len() - last.text.len();
                            last.text = joined.into();
                            merged += 1;
                            g.q.pop_front();
                            continue;
                        }
                        if out.len() >= max_frames
                            || (!out.is_empty() && bytes + next.text.len() > max_bytes)
                        {
                            break;
                        }
                        bytes += next.text.len();
                        if let Some(q) = g.q.pop_front() {
                            out.push(q);
                        }
                    }
                    g.batched += merged;
                    return Some(out.into_iter().map(|q| q.text).collect());
                }
                if g.closed {
                    return None;
                }
            }
            notified.await;
        }
    }

    /// How many deltas were merged into a run while a batch was assembled (not an overflow).
    #[must_use]
    pub fn batched(&self) -> u64 {
        self.inner.lock().map_or(0, |g| g.batched)
    }

    /// The most frames this queue has held at once.
    #[must_use]
    pub fn peak(&self) -> usize {
        self.inner.lock().map_or(0, |g| g.peak)
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

/// Merge two deltas of one session only when nothing but the text would differ: both carry text (a `null` text is a
/// segment boundary the reader needs), neither carries a `rendered` form, and they belong to the same turn and segment.
/// Used for every batch, where the soft cap's looser `merge_deltas` is only for a queue that overflowed.
fn merge_runs(first: &str, second: &str) -> Option<String> {
    let a: serde_json::Value = serde_json::from_str(first).ok()?;
    let b: serde_json::Value = serde_json::from_str(second).ok()?;
    let (pa, pb) = (
        a.get("params")?.get("payload")?,
        b.get("params")?.get("payload")?,
    );
    let same = |k: &str| pa.get(k) == pb.get(k);
    if !pa.get("text")?.is_string()
        || !pb.get("text")?.is_string()
        || pa.get("rendered").is_some()
        || pb.get("rendered").is_some()
        || !same("turn_id")
        || !same("segment")
    {
        return None;
    }
    merge_deltas(first, second)
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

    #[tokio::test]
    async fn a_batch_merges_runs_of_text_and_keeps_everything_else_in_order() {
        let q = Outbox::new(100, 200);
        q.push(delta("s", "a", 1), Some("s"));
        q.push(delta("s", "b", 2), Some("s"));
        q.push(response(7), None);
        q.push(delta("s", "c", 3), Some("s"));
        q.push(delta("t", "x", 1), Some("t"));
        q.push(delta("t", "y", 2), Some("t"));
        let null: Arc<str> = serde_json::json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"t","payload":{"text":null},"seq":3}}).to_string().into();
        q.push(null, Some("t"));
        q.push(delta("t", "z", 4), Some("t"));
        assert_eq!(q.peak(), 8);
        let got: Vec<serde_json::Value> = q
            .pop_batch(64, 1 << 20)
            .await
            .unwrap()
            .iter()
            .map(|t| serde_json::from_str(t).unwrap())
            .collect();
        let texts: Vec<serde_json::Value> = got
            .iter()
            .map(|f| f["params"]["payload"]["text"].clone())
            .collect();
        assert_eq!(
            texts,
            [
                serde_json::json!("ab"),
                serde_json::Value::Null,
                serde_json::json!("c"),
                serde_json::json!("xy"),
                serde_json::Value::Null,
                serde_json::json!("z")
            ]
        );
        assert_eq!(
            got[0]["params"]["seq"], 2,
            "the merged frame carries the later seq"
        );
        assert_eq!(got[1]["id"], 7, "a response keeps its place");
        assert_eq!(q.batched(), 2);
        assert_eq!(q.coalesced(), 0, "merging a run is not an overflow");
        assert!(q.is_empty());
    }

    #[tokio::test]
    async fn a_batch_is_bounded_by_frames_and_bytes_but_never_empty() {
        let q = Outbox::new(100, 200);
        for i in 0..10 {
            q.push(response(i), None);
        }
        assert_eq!(q.pop_batch(4, 1 << 20).await.unwrap().len(), 4);
        assert_eq!(
            q.pop_batch(64, 1).await.unwrap().len(),
            1,
            "one frame past the byte bound still goes"
        );
        assert_eq!(q.pop_batch(64, 1 << 20).await.unwrap().len(), 5);
        q.close();
        assert!(q.pop_batch(64, 1 << 20).await.is_none());
    }

    #[tokio::test]
    async fn deltas_of_another_turn_or_with_a_rendered_form_stay_apart() {
        let q = Outbox::new(100, 200);
        let mk = |text: &str, turn: &str, rendered: bool| -> Arc<str> {
            let mut p = serde_json::json!({"text": text, "turn_id": turn});
            if rendered {
                p["rendered"] = serde_json::json!("<b>x</b>");
            }
            serde_json::json!({"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s","payload":p}}).to_string().into()
        };
        q.push(mk("a", "1", false), Some("s"));
        q.push(mk("b", "2", false), Some("s"));
        q.push(mk("c", "2", true), Some("s"));
        assert_eq!(q.pop_batch(64, 1 << 20).await.unwrap().len(), 3);
    }
}
