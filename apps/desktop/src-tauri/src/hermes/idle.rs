//! "When idle": the one wait for a change that needs the gateway to stop without ending anybody's work. Two things use it:
//! a connector's key, which the gateway reads only when it starts (`connectors::engine`, "restart when idle"), and the
//! update of the engine's code (`setup::update`). Each says what "nothing is working" means for it and what to do then; this
//! is the loop between the two.
//!
//! Only an answer that says nothing is working counts: a look that cannot tell keeps the wait going. The action is made
//! without `--yes`, so the engine itself refuses to stop a gateway that started work since the look, and the wait goes on.

use std::future::Future;
use std::time::Duration;

use crate::error::Result;

/// How a wait ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waited {
    /// The action ran and is done.
    Done,
    /// No moment came, within the limit, when nothing was working.
    GaveUp,
}

/// Every `every`, ask `idle`; when it says nothing is working, run `act`. `act` answers `Ok(true)` when it is done,
/// `Ok(false)` when work started since the look (the engine would not stop), so the wait goes on, and `Err` to end the wait.
/// Gives up after `longest`.
///
/// # Errors
/// What `act` failed with.
pub async fn when_idle<I, IF, A, AF>(
    every: Duration,
    longest: Duration,
    mut idle: I,
    mut act: A,
) -> Result<Waited>
where
    I: FnMut() -> IF,
    IF: Future<Output = bool>,
    A: FnMut() -> AF,
    AF: Future<Output = Result<bool>>,
{
    let give_up = tokio::time::Instant::now() + longest;
    loop {
        if tokio::time::Instant::now() >= give_up {
            return Ok(Waited::GaveUp);
        }
        tokio::time::sleep(every).await;
        if !idle().await {
            continue;
        }
        if act().await? {
            return Ok(Waited::Done);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use std::sync::Mutex;

    #[tokio::test]
    async fn it_acts_only_on_an_idle_answer_and_waits_again_when_work_started_since() {
        let looks = Mutex::new(vec![false, true, true]);
        let acts = Mutex::new(vec![Ok(false), Ok(true)]);
        let seen = Mutex::new(Vec::new());
        let done = when_idle(
            Duration::from_millis(1),
            Duration::from_secs(5),
            || {
                let idle = looks.lock().unwrap().remove(0);
                seen.lock().unwrap().push(format!("look {idle}"));
                async move { idle }
            },
            || {
                let answer = acts.lock().unwrap().remove(0);
                seen.lock().unwrap().push("act".to_owned());
                async move { answer }
            },
        )
        .await
        .unwrap();
        assert_eq!(done, Waited::Done);
        assert_eq!(
            *seen.lock().unwrap(),
            ["look false", "look true", "act", "look true", "act"]
        );
    }

    #[tokio::test]
    async fn it_gives_up_after_the_limit_and_ends_on_a_failed_action() {
        let gave_up = when_idle(
            Duration::from_millis(1),
            Duration::from_millis(10),
            || async { false },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        assert_eq!(gave_up, Waited::GaveUp);
        let failed = when_idle(
            Duration::from_millis(1),
            Duration::from_secs(5),
            || async { true },
            || async { Err(Error::Unavailable("it broke".into())) },
        )
        .await;
        assert!(failed.unwrap_err().to_string().contains("it broke"));
    }
}
