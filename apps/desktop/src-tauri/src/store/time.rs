//! Time as the store writes it: RFC 3339 in UTC, seconds, `Z`. No time crate: the civil-date arithmetic is Howard Hinnant's, and
//! the tests pin it against known dates.

use std::time::{SystemTime, UNIX_EPOCH};

/// Seconds since the Unix epoch now.
#[must_use]
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// `secs` as `YYYY-MM-DDTHH:MM:SSZ`.
#[must_use]
pub fn rfc3339(secs: u64) -> String {
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Now, as RFC 3339.
#[must_use]
pub fn now() -> String {
    rfc3339(now_secs())
}

/// The zone of an RFC 3339 timestamp's tail (after the seconds and any fraction), in seconds east of UTC: `Z` is 0,
/// `+HH:MM` and `-HH:MM` are what Python's `isoformat()` writes (the engine's cron times). `None` for no zone or another
/// shape: a time without a zone is not a time anyone can place.
fn zone(tail: &str) -> Option<i64> {
    let tail = tail
        .strip_prefix('.')
        .map_or(tail, |f| f.trim_start_matches(|c: char| c.is_ascii_digit()));
    if tail == "Z" {
        return Some(0);
    }
    let b = tail.as_bytes();
    if b.len() != 6 || b[3] != b':' || !matches!(b[0], b'+' | b'-') {
        return None;
    }
    let (hh, mm) = (
        tail.get(1..3)?.parse::<i64>().ok()?,
        tail.get(4..6)?.parse::<i64>().ok()?,
    );
    if hh > 23 || mm > 59 {
        return None;
    }
    let east = hh * 3600 + mm * 60;
    Some(if b[0] == b'-' { -east } else { east })
}

/// Seconds since the epoch of a `YYYY-MM-DDTHH:MM:SS` timestamp ending in `Z` or a `±HH:MM` offset (fractions are
/// ignored); `None` for anything else.
#[must_use]
pub fn parse(t: &str) -> Option<u64> {
    let b = t.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let east = zone(t.get(19..)?)?;
    let n = |r: std::ops::Range<usize>| t.get(r)?.parse::<i64>().ok();
    let (y, m, d, hh, mm, ss) = (
        n(0..4)?,
        n(5..7)?,
        n(8..10)?,
        n(11..13)?,
        n(14..16)?,
        n(17..19)?,
    );
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + hh * 3600 + mm * 60 + ss - east).ok()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn known_dates_round_trip() {
        for (secs, text) in [
            (0, "1970-01-01T00:00:00Z"),
            (951_782_400, "2000-02-29T00:00:00Z"),
            (1_795_253_400, "2026-11-21T09:30:00Z"),
            (4_102_444_799, "2099-12-31T23:59:59Z"),
        ] {
            assert_eq!(rfc3339(secs), text);
            assert_eq!(parse(text), Some(secs));
        }
        assert_eq!(parse("2026-11-21T09:30:00.123456Z"), Some(1_795_253_400));
        // the engine's cron times: Python's isoformat(), with the zone as an offset
        assert_eq!(
            parse("2026-11-21T10:30:00.123456+01:00"),
            Some(1_795_253_400)
        );
        assert_eq!(parse("2026-11-21T04:00:00-05:30"), Some(1_795_253_400));
        assert_eq!(
            parse("2026-11-21T09:30:00"),
            None,
            "no zone: not a time to place"
        );
        assert_eq!(parse("2026-11-21T09:30:00+1:00"), None);
        assert_eq!(parse("yesterday"), None);
        assert_eq!(parse("2026-13-21T09:30:00Z"), None);
        assert!(parse(&now()).unwrap().abs_diff(now_secs()) <= 1);
    }
}
