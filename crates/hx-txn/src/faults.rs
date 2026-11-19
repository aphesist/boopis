//! Fault injection for crash and failure tests.
//!
//! Every durable step of a transaction calls [`Faults::tick`]. In production builds `tick` is a
//! no-op. With the `dev-fixtures` feature a test can make the k-th step fail (the transaction
//! must restore) or "crash" (the transaction stops dead, as if the process was killed, and
//! `recover` must clean up).

use crate::error::Result;

/// The fault plan for one transaction. Production code always passes [`Faults::none`].
#[cfg(not(feature = "dev-fixtures"))]
#[derive(Debug, Default, Clone, Copy)]
pub struct Faults;

#[cfg(not(feature = "dev-fixtures"))]
impl Faults {
    /// No faults.
    #[must_use]
    pub fn none() -> Self {
        Self
    }

    /// Marks one durable step. Never fails here.
    ///
    /// # Errors
    /// Never, without `dev-fixtures`.
    #[allow(clippy::unused_self)] // Same signature as the fault-injecting build.
    pub fn tick(&self) -> Result<()> {
        Ok(())
    }

    /// Marks one step of a restore. Never fails here.
    ///
    /// # Errors
    /// Never, without `dev-fixtures`.
    #[allow(clippy::unused_self)] // Same signature as the fault-injecting build.
    pub fn restore_tick(&self) -> Result<()> {
        Ok(())
    }
}

/// Something a test does to the workspace at a step, as an attacker racing the transaction would.
#[cfg(feature = "dev-fixtures")]
type Interference = Box<dyn Fn() + Send + Sync>;

/// The fault plan for one transaction.
#[cfg(feature = "dev-fixtures")]
#[derive(Default)]
pub struct Faults {
    fail_at: Option<usize>,
    crash_at: Option<usize>,
    fail_restore_at: Option<usize>,
    interfere_at: Option<(usize, Interference)>,
    ticks: std::sync::atomic::AtomicUsize,
    restore_ticks: std::sync::atomic::AtomicUsize,
}

#[cfg(feature = "dev-fixtures")]
impl std::fmt::Debug for Faults {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Faults")
            .field("fail_at", &self.fail_at)
            .field("crash_at", &self.crash_at)
            .field("fail_restore_at", &self.fail_restore_at)
            .field("interfere_at", &self.interfere_at.as_ref().map(|(k, _)| k))
            .finish_non_exhaustive()
    }
}

#[cfg(feature = "dev-fixtures")]
impl Faults {
    /// No faults.
    #[must_use]
    pub fn none() -> Self {
        Self::default()
    }

    /// The `k`-th step (0-based) fails with an I/O error.
    #[must_use]
    pub fn fail_at(k: usize) -> Self {
        Self {
            fail_at: Some(k),
            ..Self::default()
        }
    }

    /// The `k`-th step (0-based) stops the transaction without any cleanup.
    #[must_use]
    pub fn crash_at(k: usize) -> Self {
        Self {
            crash_at: Some(k),
            ..Self::default()
        }
    }

    /// The `k`-th step of restore (0-based) fails with an I/O error.
    #[must_use]
    pub fn fail_restore_at(mut self, k: usize) -> Self {
        self.fail_restore_at = Some(k);
        self
    }

    /// Adds a step failure to an existing plan.
    #[must_use]
    pub fn and_fail_at(mut self, k: usize) -> Self {
        self.fail_at = Some(k);
        self
    }

    /// Runs `act` when step `k` (0-based) is reached, before the step itself: a test swaps a
    /// directory for a symlink between the checks and the writes.
    #[must_use]
    pub fn interfere_at(mut self, k: usize, act: impl Fn() + Send + Sync + 'static) -> Self {
        self.interfere_at = Some((k, Box::new(act)));
        self
    }

    /// How many steps ran so far.
    #[must_use]
    pub fn steps(&self) -> usize {
        self.ticks.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Marks one durable step.
    ///
    /// # Errors
    /// The injected failure or crash.
    pub fn tick(&self) -> Result<()> {
        let n = self.ticks.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if let Some((k, act)) = &self.interfere_at
            && *k == n
        {
            act();
        }
        if self.crash_at == Some(n) {
            return Err(crate::error::Error::InjectedCrash);
        }
        if self.fail_at == Some(n) {
            return Err(crate::error::Error::io(
                "injected failure",
                std::io::Error::other(format!("step {n}")),
            ));
        }
        Ok(())
    }

    /// Marks one step of a restore.
    ///
    /// # Errors
    /// The injected failure.
    pub fn restore_tick(&self) -> Result<()> {
        let n = self
            .restore_ticks
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.fail_restore_at == Some(n) {
            return Err(crate::error::Error::io(
                "injected restore failure",
                std::io::Error::other(format!("step {n}")),
            ));
        }
        Ok(())
    }
}
