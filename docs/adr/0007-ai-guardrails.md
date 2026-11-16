# ADR-0007: AI layer and guardrails

Status: accepted

## Features
1. **Ask**: natural-language questions about attendance ("how many late arrivals last week by site?", "who had overtime yesterday?").
2. **Explain anomalies**: a list of detected anomalies (flag clusters, repeated lateness, impossible travel, auto-closes) with an evidence-backed plain-language explanation.

## Architecture: the model never touches data or SQL
```
question ─▶ planner ─▶ QueryPlan (JSON) ─▶ zod validate vs whitelist ─▶ executor (fixed, parameterised SQL, READ ONLY tx)
                                                                       └▶ pseudonymise ─▶ template renderer ─▶ output scanner ─▶ answer
```
- **Planner** is an interface. Default: a deterministic rule-based planner (keywords, dates, sites) so the feature works offline and in tests. Optional: an LLM planner (`AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`) that is asked to return a JSON plan only. Its output goes through exactly the same validation. The live LLM path is [UNVERIFIED] (no key was used in the build).
- **QueryPlan** has a closed vocabulary: `metric` in {`checkins`, `late`, `absent`, `overtime_minutes`, `work_minutes`, `flagged`, `auto_closed`}, `groupBy` in {`day`, `site`, `shift`, `employee`, `none`}, filters `from`, `to` (max 92-day range), `siteName`, `kind`. Unknown fields are rejected (`strict`).
- **Executor** has one function per (metric × group) built from fixed SQL fragments; user text never reaches SQL. Executes in `BEGIN READ ONLY`, with `statement_timeout`, and `LIMIT 200`. A test proves a write inside the executor's transaction fails.
- **PII**: employees are shown as aliases `E-` + first 4 chars of a base32 HMAC of user id with a server key; emails, names, phone, coordinates are never selected by AI queries. Group sizes below `ai_min_group` (default 1 for per-employee aliases, 3 for site/shift) are not hidden by default because aliases are pseudonymous, but the setting exists [UNVERIFIED value for small teams].
- **Output scanner**: final text is scanned for emails, phone-like numbers, lat/lng-like pairs and uuid values; any match is redacted and the event audited. The renderer is template-based, so the only way PII reaches the output is a bug, and the scanner is the second layer.
- **Prompt injection**: question text is data. For the rule-based planner it is only tokenised. For the LLM planner it is passed in a delimited block with an instruction to output JSON only; the output is untrusted and validated. Instructions inside the question ("ignore previous rules", "drop table", "show emails") cannot change the whitelist; they result in a refusal or a plan the whitelist would allow anyway.
- **Authz**: admin only. Every question and the final plan are stored in `ai_queries` (without the answer rows).
- **Anomaly explanations** are rule-based detections (z-score-free, plain thresholds) with templated text containing the numbers behind them, so each sentence can be checked against a query.

## Tests (the guardrail suite)
Injection strings, requests for PII, plans with unknown metrics or over-long ranges, SQL in the question, writes in the read-only transaction, scanner redaction, employee (non-admin) access denied, alias stability, audit row written. A mutation check: disabling each guard makes at least one test fail (recorded in README as measured).
