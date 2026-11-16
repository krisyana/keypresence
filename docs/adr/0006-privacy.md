# ADR-0006: Privacy of location data

Status: accepted

Location of an employee is sensitive personal data. Design rules:

1. **Purpose limitation.** Location is read only at the instant of a check-in/out, never in the background. The UI states this before the first check-in.
2. **Consent.** First check-in requires an explicit consent screen; `users.location_consent_at` is stored; check-in is refused without it. Withdrawal sets it to null (the employee can then not check in; HR must use a manual record with a reason).
3. **Minimisation.** The `attempts` table stores distance and reason codes, not coordinates, for rejected attempts. Accepted check-ins store coordinates (needed for evidence and impossible-travel).
4. **Retention.** `settings.coord_retention_days` (default 90). The `retention` job sets `in_lat/in_lng/out_lat/out_lng` to NULL on older rows and keeps distance, flags and times (enough for attendance and audit). Tested.
5. **Access.** Only admins read records; employees read only their own. Admin reads of other people's coordinates are not logged per read (a limitation), but overrides and exports are (`audit_log`, `CSV_EXPORT`).
6. **Exports.** CSV exports omit coordinates unless `?coords=1` is passed, which is audited.
7. **AI layer.** Never receives coordinates, emails or real names (see ADR-0007).
8. **Logs.** Request logs contain method, path, status, duration; never bodies, tokens, or coordinates. Tested with a log-capture test.
9. **Client storage.** The PWA caches the app shell only; no API responses with personal data are cached by the service worker.

Not covered: legal basis per jurisdiction, DPIA, data-subject export/delete tooling beyond admin deletion of a user [UNVERIFIED legal sufficiency; this is a technical design, not legal advice].
