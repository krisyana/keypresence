# ADR-0003: Data model

Status: accepted

## Core idea
A **check-in** row is a generic event: `(user, site, kind, optional subject_ref)` with an in-leg and an out-leg. Attendance is `kind = 'attendance'`; `visitor`, `event`, `asset`, `task` use the same table, the same QR and the same geofence. Kind-specific rules (lateness, overtime, absence) apply to `attendance` only and are computed from the user's shift.

## Tables (see `migrations/001_init.sql`)
`users`, `sessions`, `sites`, `shifts`, `checkins`, `attempts`, `corrections`, `absences`, `notifications`, `daily_summaries`, `settings`, `audit_log`, `ai_queries`, `job_runs`.

Key decisions:
- **`checkins.status` is `open` or `closed`** and a **partial unique index** `(user_id, kind, coalesce(subject_ref,'')) where status = 'open'` makes a double open check-in impossible even under concurrent requests. The API converts the unique violation to a 409. Tested.
- **`attempts`** records every check-in/out try, accepted or rejected, with reason codes and distance, *without* raw coordinates unless the attempt was accepted. This is what impossible-travel looks at and what lets HR see "Sari tried 3 times outside the fence".
- **Flags** are a `text[]` of stable codes (`OUTSIDE_FENCE`, `LOW_ACCURACY`, `IMPOSSIBLE_TRAVEL`, `SPOOF_SIGNAL`, `AUTO_CLOSED`, `ADMIN_OVERRIDE`, ...), plus `review_status` (`none | pending | reviewed`) so HR has a queue.
- **Day and times**: instants are `timestamptz`; the local business day is stored as `day date` computed in the organisation timezone at write time, so reports never re-derive it with a different timezone.
- **Late / overtime / work minutes** are stored on the closed row (derived columns) so reports are plain SQL and historic rows keep the value computed under the shift rules of that time.
- **Corrections** never edit history in place: an approved correction updates the row *and* writes an `audit_log` entry with before/after.
- **Settings** are key/value JSONB validated by a zod schema on write; unknown keys are rejected.
- **UUID v4 primary keys** (`gen_random_uuid()`, available in PG13+ and PGlite).
- Coordinates are `double precision`; geofence maths is haversine in TypeScript (no PostGIS). For a 5-500 m fence, haversine error is far below GPS error.

## Rejected
PostGIS: correct but heavier to run (breaks the zero-setup path) and unnecessary at this precision. One table per event kind: duplicates every report.
