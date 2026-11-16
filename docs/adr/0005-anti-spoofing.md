# ADR-0005: Location enforcement and anti-spoofing limits

Status: accepted

## What a browser can and cannot know
`navigator.geolocation` returns `latitude`, `longitude`, `accuracy` (metres, 95% radius), optional `altitude`, `speed`, and the fix `timestamp`. It does **not** return whether the position is mocked. A user with a mock-location app, a rooted device or a browser extension can supply any value. No server-side check can prove a location is real. This ADR therefore defines **raising the cost of cheating and keeping evidence**, not prevention.

## Rules (all implemented as one pure function, `evaluateLocation`)
Inputs: site (lat, lng, radius, max accuracy, enforcement), the fix, the user's previous accepted event, server `now`, settings.

| Signal | Condition | Default outcome |
| --- | --- | --- |
| `INVALID_COORDS` | NaN, out of range, or exactly (0,0) | reject |
| `LOW_ACCURACY` | `accuracy` missing, or `> site.max_accuracy_m` | reject if enforcement = reject, else flag |
| `OUTSIDE_FENCE` | haversine distance > `radius_m` | reject if enforcement = reject, else flag; `off` ignores |
| `STALE_FIX` | fix timestamp older than 30 s or more than 5 s in the future (vs server) | reject (a replayed old fix) |
| `SPOOF_SIGNAL` | accuracy under 1 m (including exactly 0); latitude and longitude both rounded to 3 decimals or fewer (typical of a hand-typed fake position); client-reported mock hint (`isMock` from a wrapper app). A "same coordinates as last time" rule was considered and dropped: desktop browsers with IP/Wi-Fi positioning legitimately repeat coordinates and it would flag them daily | flag, or reject when setting `spoofing_action = reject` |
| `IMPOSSIBLE_TRAVEL` | speed implied between the previous accepted event and this one > `impossible_speed_kmh` (default 200) and the gap < 12 h | flag, or reject per `spoofing_action` |
| `QR_*` | token problems (see ADR-0004) | reject |

Distance is compared to the radius directly and accuracy is a separate gate. We deliberately do **not** accept "distance minus accuracy <= radius", because that rewards bad GPS: a phone reporting ±2 km would pass anywhere nearby.

## Admin override
An admin can create or edit a check-in for an employee only with a written reason. It is stored with `ADMIN_OVERRIDE` flag, `override_by`, `override_reason`, and an audit-log entry. Overrides are visible in the record list and in the AI anomaly summary.

## What is explicitly NOT detected
Mock location apps that report plausible accuracy and move believably; VPN or Wi-Fi-based position when the device legitimately reports it; a colleague scanning for you while standing in the fence with your session; GPS jamming. The README lists these under limitations. A native wrapper that supplies `isMock` (Android `Location.isMock`) is supported by the API field but untested [UNVERIFIED].

## Testing
Table-driven tests for each row, boundary tests exactly at the radius and at the accuracy threshold, and property-style tests that haversine is symmetric and that distance of a point to itself is 0.
