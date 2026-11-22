//! The team file (`boopis team apply|export`, `docs/CLI.md`): its format and reader (`spec`), the plan from comparing it with
//! what is there (`plan`), running a plan (`apply`), and writing what is there as a file (`export`). The engine is reached
//! through [`apply::Backend`], which the command line fills with the live host (`cli/team.rs`) and the tests with a model.

pub mod apply;
pub mod export;
pub mod plan;
pub mod spec;

#[cfg(test)]
pub(crate) mod tests;
