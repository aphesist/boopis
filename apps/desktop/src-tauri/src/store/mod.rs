//! The store (ADR-0038, `docs/STORE.md`): one place to find, review, install, update and remove everything installable.
//!
//! This module holds the day-0 contract only: [`types`] are the shapes of `apps/shared/data/store.schema.json`. The catalogue,
//! sources, cache, staging and plan (workstream A) join it without changing those shapes; nothing here fetches or installs.

pub mod types;
