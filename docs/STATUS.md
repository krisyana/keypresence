# Status: verified vs not

## Verified (commands in README "Measured")
- `npm run typecheck`: clean.
- `npm test`: 220 tests pass on PGlite. `npm run test:pg`: same suite passes on PostgreSQL 17.11.
- `npm run test:e2e`: demo flow (admin creates site and geofence, shows QR; employee accepted inside the fence, rejected outside; check-out; admin sees records, summary, AI answer, CSV), dark/mobile layout, axe scan of 13 pages in light and dark (no serious/critical).
- `bash scripts/mutation-check.sh`: 14/14 guard mutations caught.
- Concurrency (one open record under 8 simultaneous check-ins) passes on real PostgreSQL.

## Independent review (read-only subagent) and what was done
Fixed, each with a test:
- Login limiter trusted `X-Forwarded-For` blindly and grew without bound: proxy header now only used with `TRUST_PROXY=1`, added a per-email limit, stale keys pruned.
- A second check-in the same day was counted late again: lateness is now only for the first arrival of the day.
- CSV export prefixed negative numbers with `'`: guard now applies to text only.
- Absences were never removed after a late check-in or approved correction: now removed; an admin visitor override no longer clears an attendance absence.
- QR tokens appeared in request logs: `/s/*` paths are redacted.

Accepted or open (not fixed):
- Retention covers coordinates, attempts and sessions only. `subject_ref`, notifications, audit details, correction reasons, AI question text and summaries are kept indefinitely, and there is no delete-user route. ADR-0006 over-promises here.
- The final daily summary of yesterday is written once after midnight; a record auto-closed or corrected later is not reflected in the stored snapshot (live summaries are correct).
- No `statement_timeout` on AI queries (ADR-0007 mentions one); only READ ONLY and LIMIT 200.
- The optional LLM planner sends the raw admin question text to an external API, so the "never receives names" claim only holds for the rule-based planner.
- The fence-attempts anomaly groups by UTC date, not local day.
- `zonedToUtc` is not exact inside a DST gap or overlap (default zone has no DST; Asia/Kolkata and New York are covered by tests for ordinary days).
- `/checkins/*` has no throttle; failed QR attempts each write an `attempts` row.
- Retention runs last in the job tick, so an exception in an earlier step would skip it that tick.

## Not verified
- Real phone: camera scanning, GPS accuracy, installing the PWA, QR print layout.
- Live LLM planner (`AI_PROVIDER=anthropic`).
- First GitHub Actions run (config written, never executed).
- Legal sufficiency of the privacy design.
- Multi-instance deployment behaviour (limiter and scheduler are per process).
