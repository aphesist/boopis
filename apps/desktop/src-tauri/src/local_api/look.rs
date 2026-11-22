//! The look a bot has until it is given one (`lookFor` of `ui/src/data/looks.ts`): the same name draws the same bot on
//! every machine and in every client. The UI and this file both read `apps/shared/data/look-vectors.json`, so they cannot
//! drift.

use serde::{Deserialize, Serialize};

/// A bot's look: a body shape and a colour. The eyes follow the bot's state and are never part of a look.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Look {
    /// One of orb2's body shapes.
    pub shape: String,
    /// A `#rrggbb` colour.
    pub color: String,
}

/// The colours of the new-bot picker.
const SWATCHES: [&str; 12] = [
    "#efece6", "#a6a6ab", "#1c1c24", "#c4834a", "#f23b5a", "#f5a337", "#2fd26a", "#4fc9a8",
    "#3b82f6", "#6d5cf0", "#9b5cf6", "#f472b6",
];

/// The shapes orb2 draws.
const SHAPES: [&str; 15] = [
    "circle", "squircle", "soft", "wide", "tall", "bean", "drop", "ghost", "triangle", "hexagon",
    "diamond", "cloud", "clover", "flower", "star",
];

/// FNV-1a over the UTF-16 units of a name, as the UI computes it.
fn hash(text: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for unit in text.encode_utf16() {
        h ^= u32::from(unit);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// The look a name has until it is given one.
#[must_use]
pub fn look_for(name: &str) -> Look {
    let h = hash(name);
    Look {
        color: SWATCHES[(h as usize) % SWATCHES.len()].to_owned(),
        shape: SHAPES[((h >> 8) as usize) % SHAPES.len()].to_owned(),
    }
}

/// A look the teammate's own record holds, over the default: a field it lacks (or holds as something else) is the default's.
#[must_use]
pub fn resolve(name: &str, record: Option<&serde_json::Value>) -> Look {
    let base = look_for(name);
    let own = record.and_then(|r| r.get("look"));
    let text = |key: &str| {
        own.and_then(|l| l.get(key))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    Look {
        shape: text("shape").map_or(base.shape, str::to_owned),
        color: text("color").map_or(base.color, str::to_owned),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTORS: &str = include_str!("../../../../shared/data/look-vectors.json");

    #[test]
    fn the_default_look_is_the_uis_for_every_vector() {
        let v: serde_json::Value = serde_json::from_str(VECTORS).unwrap();
        let rows = v["vectors"].as_array().unwrap();
        assert!(rows.len() >= 10, "the vectors are the contract");
        for row in rows {
            let name = row["name"].as_str().unwrap();
            let got = look_for(name);
            assert_eq!(got.shape, row["shape"].as_str().unwrap(), "{name}");
            assert_eq!(got.color, row["color"].as_str().unwrap(), "{name}");
        }
    }

    #[test]
    fn a_record_overrides_only_what_it_holds() {
        let record = serde_json::json!({"look": {"shape": "hexagon", "color": ""}});
        let got = resolve("kai", Some(&record));
        assert_eq!(got.shape, "hexagon");
        assert_eq!(
            got.color,
            look_for("kai").color,
            "an empty colour is the default's"
        );
        assert_eq!(resolve("kai", None), look_for("kai"));
        let junk = serde_json::json!({"look": {"shape": 3}});
        assert_eq!(resolve("kai", Some(&junk)), look_for("kai"));
    }
}
