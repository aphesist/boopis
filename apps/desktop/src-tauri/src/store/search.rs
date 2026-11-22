//! Local search and paging over the cached catalogue (`docs/STORE.md` 5.3). No query leaves the machine. Every word of the query
//! must match somewhere in the item (its title, name, publisher, summary, tags or kind); the score says where. Ties go to the
//! higher tier, then the item's place in boopis's own list (ordered by a cited popularity signal, most popular first; an item of
//! another source has none and comes after), then the title, so the order is stable. With no query, the same order without
//! the score: the most popular of boopis's own list first.

use super::types::{StoreFilter, StoreItem, Tier};

fn tier_rank(t: Tier) -> u8 {
    match t {
        Tier::Recommended => 0,
        Tier::Verified => 1,
        Tier::NotReviewed => 2,
    }
}

/// Whether `item` passes `filter` (`installed` is decided by the caller, which knows what is installed).
#[must_use]
pub fn passes(item: &StoreItem, filter: &StoreFilter) -> bool {
    filter.kind.is_none_or(|k| k == item.kind)
        && filter.tier.is_none_or(|t| t == item.tier)
        && filter.source.as_deref().is_none_or(|s| s == item.source)
        && (filter.hide_unpinned != Some(true) || item.pinned.is_some())
}

/// The score of `item` for the words of `query` (lowercase), `None` when a word matches nothing.
#[must_use]
pub fn score(item: &StoreItem, words: &[String]) -> Option<u32> {
    let title = item.title.to_lowercase();
    let id = item.id.to_lowercase();
    let publisher = item.publisher.to_lowercase();
    let summary = item.summary.to_lowercase();
    let kind = serde_json::to_value(item.kind)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();
    let tags: Vec<String> = item
        .tags
        .iter()
        .flatten()
        .map(|t| t.to_lowercase())
        .collect();
    let mut total = 0;
    for w in words {
        let mut s = 0;
        if title == *w {
            s += 100;
        } else if title.starts_with(w.as_str()) {
            s += 60;
        } else if title.contains(w.as_str()) {
            s += 40;
        }
        if id.contains(w.as_str()) {
            s += 30;
        }
        if publisher.contains(w.as_str()) {
            s += 15;
        }
        if tags.iter().any(|t| t.contains(w.as_str())) {
            s += 10;
        }
        if kind.contains(w.as_str()) {
            s += 5;
        }
        if summary.contains(w.as_str()) {
            s += 5;
        }
        if s == 0 {
            return None;
        }
        total += s;
    }
    Some(total)
}

/// The query's words: lowercase, split on anything that is not a letter or digit, at most eight.
#[must_use]
pub fn words(query: &str) -> Vec<String> {
    query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(8)
        .map(str::to_owned)
        .collect()
}

/// Rank `items` for `query`: relevance first, then the tier, then `place` (an item's place in boopis's popularity order, lower is
/// more popular), then the title. An empty query keeps every item in the same order without relevance.
#[must_use]
pub fn rank<'a>(
    items: impl Iterator<Item = &'a StoreItem>,
    query: &str,
    place: &dyn Fn(&StoreItem) -> Option<usize>,
) -> Vec<&'a StoreItem> {
    let w = words(query);
    let mut scored: Vec<(u32, &StoreItem)> = items
        .filter_map(|i| {
            if w.is_empty() {
                Some((0, i))
            } else {
                score(i, &w).map(|s| (s, i))
            }
        })
        .collect();
    let at = |i: &StoreItem| place(i).unwrap_or(usize::MAX);
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(tier_rank(a.1.tier).cmp(&tier_rank(b.1.tier)))
            .then(at(a.1).cmp(&at(b.1)))
            .then(a.1.title.to_lowercase().cmp(&b.1.title.to_lowercase()))
            .then(a.1.id.cmp(&b.1.id))
    });
    scored.into_iter().map(|(_, i)| i).collect()
}

/// A page: `cursor` is the offset (decimal text), `limit` is clamped to 1..=100. Returns the slice and the next cursor.
#[must_use]
pub fn page<T: Clone>(
    all: &[T],
    cursor: Option<&str>,
    limit: Option<u32>,
) -> (Vec<T>, Option<String>) {
    let start = cursor
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0)
        .min(all.len());
    let n = usize::try_from(limit.unwrap_or(30).clamp(1, 100)).unwrap_or(30);
    let end = (start + n).min(all.len());
    (
        all[start..end].to_vec(),
        (end < all.len()).then(|| end.to_string()),
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::store::types::{Bundle, ItemKind};

    fn none(_: &StoreItem) -> Option<usize> {
        None
    }

    fn items() -> Vec<StoreItem> {
        serde_json::from_str::<Bundle>(include_str!("../../../../shared/data/store.fixtures.json"))
            .unwrap()
            .items
            .unwrap()
    }

    #[test]
    fn a_word_must_match_and_the_title_beats_the_summary() {
        let all = items();
        let hit = rank(all.iter(), "metrics", &none);
        assert_eq!(hit[0].id, "engine-plugins:example-metrics");
        assert!(rank(all.iter(), "zzzzqqq", &none).is_empty());
        let both = rank(all.iter(), "sql review", &none);
        assert_eq!(both[0].id, "skills-hub:example-org/sql-review");
        assert!(
            rank(all.iter(), "sql zzzz", &none).is_empty(),
            "every word must match"
        );
    }

    #[test]
    fn an_empty_query_orders_by_tier_then_title() {
        let all = items();
        let r = rank(all.iter(), "  ", &none);
        assert_eq!(r.len(), all.len());
        assert!(
            r.windows(2)
                .all(|w| tier_rank(w[0].tier) <= tier_rank(w[1].tier))
        );
    }

    #[test]
    fn the_most_popular_lead_without_a_query_and_relevance_leads_within_one() {
        let mut all = items();
        // three items of boopis's own list, placed by popularity: "zeta" is the most popular, "alpha" the least
        for (n, (id, title)) in [
            ("boopis:zeta", "Zeta"),
            ("boopis:mid", "Mid"),
            ("boopis:alpha", "Alpha web"),
        ]
        .into_iter()
        .enumerate()
        {
            let mut i = all[0].clone();
            i.id = id.into();
            i.title = title.into();
            i.summary = format!("The {n} most popular, for the web.");
            i.tier = Tier::Recommended;
            all.push(i);
        }
        let order = ["boopis:zeta", "boopis:mid", "boopis:alpha"];
        let place = |i: &StoreItem| order.iter().position(|o| *o == i.id);
        let r = rank(all.iter(), "", &place);
        let mine: Vec<&str> = r
            .iter()
            .map(|i| i.id.as_str())
            .filter(|id| order.contains(id))
            .collect();
        assert_eq!(mine, order, "popularity, not the alphabet");
        assert!(
            r.iter().position(|i| i.id == "boopis:alpha").unwrap()
                < r.iter().position(|i| i.tier != Tier::Recommended).unwrap(),
            "boopis's own list leads the rest"
        );
        // within a search, the better match wins over popularity
        let s = rank(all.iter(), "alpha", &place);
        assert_eq!(s[0].id, "boopis:alpha");
        // and among equal matches, popularity decides
        let s = rank(all.iter(), "web", &place);
        let mine: Vec<&str> = s
            .iter()
            .map(|i| i.id.as_str())
            .filter(|id| order.contains(id))
            .collect();
        assert_eq!(
            mine[0], "boopis:alpha",
            "a title match beats a summary match"
        );
        assert_eq!(&mine[1..], ["boopis:zeta", "boopis:mid"]);
    }

    #[test]
    fn filters_narrow_by_kind_tier_source_and_pin() {
        let all = items();
        let f = |f: StoreFilter| all.iter().filter(|i| passes(i, &f)).count();
        assert_eq!(f(StoreFilter::default()), all.len());
        assert_eq!(
            f(StoreFilter {
                kind: Some(ItemKind::Skill),
                ..StoreFilter::default()
            }),
            4
        );
        assert_eq!(
            f(StoreFilter {
                tier: Some(Tier::Recommended),
                ..StoreFilter::default()
            }),
            2
        );
        assert_eq!(
            f(StoreFilter {
                source: Some("github".into()),
                ..StoreFilter::default()
            }),
            2
        );
        assert_eq!(
            f(StoreFilter {
                hide_unpinned: Some(true),
                ..StoreFilter::default()
            }),
            all.len() - 1
        );
    }

    #[test]
    fn pages_walk_the_list_and_stop() {
        let v: Vec<u32> = (0..7).collect();
        let (a, next) = page(&v, None, Some(3));
        assert_eq!((a, next.as_deref()), (vec![0, 1, 2], Some("3")));
        let (b, next) = page(&v, next.as_deref(), Some(3));
        assert_eq!((b, next.as_deref()), (vec![3, 4, 5], Some("6")));
        let (c, next) = page(&v, Some("6"), Some(3));
        assert_eq!((c, next), (vec![6], None));
        assert!(page(&v, Some("99"), Some(3)).0.is_empty());
        assert_eq!(
            page(&v, Some("junk"), Some(0)).0.len(),
            1,
            "a limit of 0 is clamped to 1"
        );
    }
}
