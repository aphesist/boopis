//! RFC 3339 UTC timestamps with milliseconds and `Z`, without a date-time dependency.

use std::time::{SystemTime, UNIX_EPOCH};

/// Formats a time as `YYYY-MM-DDTHH:MM:SS.mmmZ`. Times before 1970 clamp to the epoch.
#[must_use]
pub fn rfc3339(t: SystemTime) -> String {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let millis = d.subsec_millis();
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    let (y, m, day) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// The current time, formatted by [`rfc3339`].
#[must_use]
pub fn now_rfc3339() -> String {
    rfc3339(SystemTime::now())
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn epoch() {
        assert_eq!(rfc3339(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn known_instants() {
        // 2026-11-18T12:34:56.789Z
        let t = UNIX_EPOCH + Duration::new(1_795_005_296, 789_000_000);
        assert_eq!(rfc3339(t), "2026-11-18T12:34:56.789Z");
        // Leap day.
        let t = UNIX_EPOCH + Duration::from_hours(474_768);
        assert_eq!(rfc3339(t), "2024-02-29T00:00:00.000Z");
    }
}
