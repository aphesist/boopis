pub mod frontmatter;
pub mod loader;

pub use hypotaxis_contracts::*;

pub use frontmatter::{parse_frontmatter, parse_glob_value, parse_yaml_fields, Frontmatter};
pub use loader::{discover_compat_assets, load_project_assets};

pub fn compat_ready() -> bool {
    true
}
