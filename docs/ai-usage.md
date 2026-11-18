# How AI was used to build KeyPresence, and where it was checked by hand

This repo was built in one Claude Code session (model: Claude Sonnet 5.5) acting as lead, plus three subagents. The goal was to be honest about the split, not to claim the AI did everything.

## Workflow

| Phase | Done by | Human-style check applied |
| --- | --- | --- |
| Research and requirements (`docs/requirements.md`) | Lead agent | Every non-goal states why; open questions each carry a working answer that the code then implements (or the doc was edited to match). |
| ADRs 0001-0007 | Lead agent | After the code existed, ADR text was re-read against the code. Two mismatches were found and fixed (ADR-0005 repeated-coordinates rule, ADR-0007 `ai_min_group` setting that does not exist). |
| Schema, domain rules, API, jobs, AI layer | Lead agent, test-first for the pure rules | Automated tests (189 when the backend was finished, 269 now). Several tests were wrong, not the code, and were corrected after reading the failure (see below). |
| Employee screens | Subagent 1 (brief: exact files owned, API read from source, accessibility rules) | Lead reviewed its notes, applied one suggestion (`maxAccuracyM` in the rejection payload), ran the pages in Playwright, and looked at screenshots. |
| Admin CMS screens | Subagent 2 (same style of brief) | Same, plus a layout fix (admin tab bar hid four pages on phones) and a chart caption fix found from screenshots. |
| End-to-end and accessibility tests | Lead agent | The e2e test drives the real UI and API. The axe scan found no serious or critical issues on 13 pages in both themes. |
| Independent review | Subagent 3, read-only, instructed to report only verified findings | Findings are in `docs/STATUS.md` with what was done about each. |

## Things the AI got wrong and tests or checks caught
- PGlite returned `date` columns as JS `Date`, serialised as `2026-11-16T00:00:00.000Z` instead of `2026-11-16`. Caught by an API test; fixed by passing parsers per query.
- Several job tests assumed the wrong UTC time for a Jakarta shift end, and one forgot that sessions expire after 12 h when the test clock jumps. The code was right in those cases, the tests were corrected.
- The AI question screen did not refuse "approve all pending corrections". Caught by a guardrail test; the pattern list was extended. The real guards (plan whitelist, read-only transaction) were never bypassed.

## Guardrail verification by mutation
`scripts/mutation-check.sh` disables 14 guards one at a time (read-only transaction, strict plan schema, alias mapping, output scanner, plan validation, range limit, admin-only AI route, geofence check, QR signature check, QR day check, unique-open handling, consent check, CSV formula guard, session-token hashing) and runs the suite. Result of the last run: **14 of 14 caught** (every mutation made at least one test fail).

## What was not checked by a human
- No person has reviewed the UI on a physical phone or with a real camera and GPS.
- The optional LLM planner (`AI_PROVIDER=anthropic`) was never run against the live API.
- Legal sufficiency of the privacy design was not reviewed.
