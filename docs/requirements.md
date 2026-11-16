# KeyPresence — research and requirements

Status: draft 1 (written before any code). Decisions that came out of it are in [`adr/`](adr/).

## 1. Context

The first KeyPresence was a company attendance, event and task app (React, Redux, Express, PostgreSQL).
This is a clean redesign, not a port; no old code was reused. The redesign has one idea that the
original did not: **check-in/out is a generic, location-verified event**. "Work attendance" is just
the first *kind* of event. The same signed-QR + geofence flow also covers visitors, events, rooms or
assets, and tasks.

What I looked at before designing (public descriptions only, no source):

| Source | What it informed |
| --- | --- |
| Old KeyPresence public description | Scope baseline: attendance + events + tasks. |
| Browser Geolocation API (`GeolocationCoordinates.accuracy`, secure-context rule) | Accuracy is a 95% confidence radius in metres; it works only on HTTPS or `localhost`; a page cannot read a "mock location" flag. This drives ADR-0005. |
| Common QR-attendance weaknesses (screenshot sharing, static codes) | Daily-rotating signed QR plus a location check, so a photographed QR is useless away from the site or the next day. ADR-0004. |
| Indonesian data-protection law (UU PDP 27/2022) and GDPR principles | Location is personal data. Consent, minimisation, retention, purpose limitation. ADR-0006. (Principles only, this is not legal advice.) |

## 2. Personas

| Persona | Needs |
| --- | --- |
| **Sari, employee** (phone, patchy signal) | Check in with two taps, see whether it was accepted and why not, ask for a correction without chasing anyone. |
| **Budi, HR admin** (laptop) | Define sites and shifts once, print the day's QR, see who is late/absent/flagged, approve corrections, export CSV, and trust that the numbers are right. |
| **Rina, site manager / receptionist** | Show or print the QR at a site, rotate it if it leaks. Same admin console in v1, scoped roles are a non-goal. |
| **Dewi, visitor or event guest** (v1: a logged-in guest account) | Check in and out of a visit or event with the same flow. |
| **Auditor / owner** | Evidence of who overrode what, and that location data is not kept forever. |

## 3. User stories (in scope for v1)

Employee
- E1. Sign in; install the app to the home screen.
- E2. Scan a site QR (camera, or open the QR link) and check **in**; my position is read at that moment.
- E3. See immediate, specific feedback: accepted, accepted-but-flagged, or rejected with a reason (outside the fence by N m, accuracy too low, QR expired).
- E4. Check **out** the same way; see worked time, late and overtime minutes.
- E5. Choose the kind of event (attendance, visitor, event, asset, task) and optional reference (room name, task id).
- E6. See my history, and request a correction (missed check-out, wrong time) with a reason.
- E7. Read notifications (reminders, auto-close, correction decisions).
- E8. Give or withdraw location consent; see how long my data is kept.

Admin
- A1. CRUD employees (role, active, shift).
- A2. CRUD sites with geofence (lat, lng, radius), accuracy threshold, enforcement mode (reject / flag / off).
- A3. Show today's QR for a site (large, printable) and rotate it manually.
- A4. CRUD shifts (start, end, grace, work days, overtime threshold, auto-close delay).
- A5. Browse and filter records (date, site, user, kind, flagged); open a record and see the signals that were evaluated.
- A6. Review flagged records (accept with note); create an override check-in/out for an employee with a mandatory reason.
- A7. Approve or reject corrections; every decision is audited.
- A8. Edit settings (timezone, impossible-travel speed, retention, spoofing action, QR grace).
- A9. See an audit log of overrides, rotations, settings and approvals.
- A10. Export records as CSV (formula-injection safe).
- A11. Ask questions about attendance in plain language and get explanations of anomalies (read-only, pseudonymised).

System / automation
- S1. Late, overtime and absence detection from the shift rules.
- S2. Auto-close forgotten check-outs at shift end plus a delay, flagged as auto-closed.
- S3. Reminders: "you have not checked in", "you are still checked in".
- S4. Daily summary, weekly summary.
- S5. Retention job that strips precise coordinates after N days.
- S6. All jobs idempotent and runnable on a schedule or by CLI.

## 4. Scope

In: single organisation, one timezone setting, email+password auth with server sessions, two roles
(admin, employee), PWA (installable, offline shell), PostgreSQL, in-app notifications, CSV export,
rule-based AI planner with an optional LLM planner.

## 5. Non-goals (v1) and why

| Non-goal | Why |
| --- | --- |
| Multi-tenant SaaS | Doubles the auth and data-isolation surface; a portfolio-sized project should do one thing deeply. |
| Payroll, leave management | Absence is reported as "no check-in on a work day"; approved leave is not modelled, so absence counts are an upper bound. Documented limitation. |
| Face / biometric verification | Heavy privacy cost, and not needed for the stated threat model. |
| Native apps, background location, push notifications | A PWA cannot track in the background, and continuous tracking would violate minimisation. In-app notifications only. |
| Defeating a determined spoofer | Not possible from a browser. We raise the cost and leave evidence. ADR-0005 states exactly what is and is not detected. |
| Fine-grained roles (site manager scope) | Later. The `role` column is an enum so it can grow. |
| Map tiles / geocoding | Needs an external service and sends coordinates to it. Sites are entered as lat/lng, with a "use my current position" helper. |

## 6. Quality bars

- Every business rule that decides *accept / flag / reject* is a pure function with table-driven tests.
- Concurrency: two simultaneous check-ins for the same user and kind cannot both open a record (unique partial index, tested).
- Timezone: all "late / absent / day" logic uses the organisation timezone, tested across a DST-free zone and a zone with offset 30 min (`Asia/Kolkata` fixture) to catch hour-only maths.
- The AI layer cannot write, cannot see PII, and its guardrails have failing-when-removed tests.
- Accessible UI: keyboard operable, labelled controls, 4.5:1 contrast checked in both themes, `prefers-reduced-motion` respected.

## 7. Open questions (and the working answer)

| # | Question | Working answer |
| --- | --- | --- |
| Q1 | Should check-out also require the QR? | Yes. Otherwise a user can check out from home. Same signed token, same geofence. |
| Q2 | What if GPS is poor indoors? | Per-site `max_accuracy_m` plus enforcement `flag` so HR can choose "record but review" for such sites. |
| Q3 | Can a visitor kind be used by employees only? | v1: every kind needs a logged-in account. Anonymous visitor check-in is a later feature (needs rate limiting and a different privacy basis). |
| Q4 | Does the QR rotate at midnight local time? | Yes, in the organisation timezone, with a configurable grace (default 10 min) so a code shown at 23:58 still works at 00:03. |
| Q5 | Is the AI allowed to see names? | No. Employees appear as stable aliases (`E-7K2Q`). Admins see each employee's alias in the employees table, so they can map an answer back to a person themselves; the AI never does. |
| Q6 | What about employees in different timezones? | One timezone per organisation in v1. [UNVERIFIED] behaviour for sites in other zones. |
