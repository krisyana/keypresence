# ADR-0001: Stack

Status: accepted

## Decision
TypeScript end to end, one package, three source folders:

| Layer | Choice |
| --- | --- |
| API | Hono on Node (`@hono/node-server`), zod validation |
| DB | PostgreSQL, hand-written SQL migrations, thin `Db` interface (`query`, `tx`) |
| DB for zero-setup and tests | PGlite (Postgres compiled to WASM) behind the same interface |
| Web | Vite + React + React Router, hand-written CSS with design tokens, hand-written service worker |
| Tests | Vitest (unit, API integration, AI guardrails), Playwright (end-to-end demo flow) |
| CI | GitHub Actions: typecheck, unit/integration on PGlite and on a real Postgres service, build, e2e |

## Why
- **Hono** is small, typed, and testable without a network (`app.request()`), so API tests are fast and need no port.
- **No ORM.** The interesting logic is a few queries with locking and partial unique indexes. SQL stays readable and reviewable; the `Db` interface is 3 methods. Trade-off: no generated types, so row types are declared by hand next to each query module.
- **PGlite plus real Postgres behind one interface.** `npm run dev` works with no Docker and no installed Postgres (data in `.data/`), `DATABASE_URL` switches to real Postgres, `docker-compose.yml` provides one. The same test suite runs against both (`TEST_DATABASE_URL`). Risk: PGlite is not identical to Postgres, which is why the suite also runs against real Postgres in CI and locally.
- **Vite SPA, not Next.js.** The product is an authenticated app, nothing needs SSR or SEO, and a plain SPA makes the PWA/service-worker story simpler. API and static files are served by one Node process in production.
- **No UI library.** About 15 components; the design tokens and light/dark theme are small enough to own, and it keeps the bundle measurable.

## Rejected
- Cloudflare Workers + D1/Hyperdrive: free and fast, but moves the database away from Postgres semantics (partial unique indexes, `SELECT ... FOR UPDATE`) that the design relies on. Deployment is left as a documented later step.
- NestJS: more structure than this size needs.
- Next.js route handlers: couples the API to the web build and makes jobs/CLI awkward.

## Consequences
Jobs run in-process on an interval and from a CLI (`npm run jobs:run`); a multi-instance deployment must run them from one place (documented).
