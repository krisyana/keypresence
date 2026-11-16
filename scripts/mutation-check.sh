#!/usr/bin/env bash
# Disables each AI/privacy/security guard in turn and confirms the test suite notices. Restores files afterwards.
# Usage: bash scripts/mutation-check.sh   (requires a clean git tree for the touched files)
set -u
cd "$(dirname "$0")/.."
run() { # name file sed-expression
  local name="$1" file="$2" expr="$3"
  cp "$file" "$file.bak"
  sed -i '' -E "$expr" "$file"
  if cmp -s "$file" "$file.bak"; then echo "NOT APPLIED  $name"; mv "$file.bak" "$file"; return; fi
  if npx vitest run >/dev/null 2>&1; then echo "SURVIVED     $name"; else echo "CAUGHT       $name"; fi
  mv "$file.bak" "$file"
}
run "executor not READ ONLY"            src/server/ai/index.ts    "s/await tx.exec\('SET TRANSACTION READ ONLY'\);//"
run "plan schema not strict"            src/server/ai/guard.ts    "s/\.strict\(\)//"
run "no alias for employees"            src/server/ai/index.ts    "s/plan.groupBy === 'employee' \? aliasFor\(masterSecret, r.label\) : r.label/r.label/"
run "output scanner bypassed"           src/server/ai/index.ts    "s/const scanned = scanOutput\(renderAnswer\(parsed.data, rows\)\);/const scanned = { text: renderAnswer(parsed.data, rows), redactions: 0 };/"
run "no whitelist validation"           src/server/ai/index.ts    "s/const parsed = planSchema.safeParse\(raw\);/const parsed: any = { success: true, data: raw };/"
run "range limit removed"               src/server/ai/guard.ts    "s/MAX_RANGE_DAYS = 92/MAX_RANGE_DAYS = 99999/"
run "AI endpoints not admin-only"       src/server/app.ts         "s/requireRole\(deps.db, deps.clock, 'admin'\)/requireRole(deps.db, deps.clock)/"
run "geofence ignored"                  src/server/domain/geo.ts  "s/if \(distanceM > site.radiusM\) add\('OUTSIDE_FENCE', hard\);//"
run "QR signature not checked"          src/server/domain/qr.ts   "s/if \(given.length !== expected.length \|\| !timingSafeEqual\(given, expected\)\)/if (false)/"
run "QR day not checked"                src/server/domain/qr.ts   "s/return \{ ok: false, code: 'expired' \};/return { ok: true };/"
run "unique open index bypass (no 409)" src/server/domain/checkin.ts "s/if \(isUniqueViolation\(e\)\) throw new ApiError\(409, 'ALREADY_CHECKED_IN', 'You are already checked in for this.'\);//"
run "consent not required"              src/server/domain/checkin.ts "s/if \(!user.location_consent_at\) throw/if (false) throw/"
run "CSV formula guard removed"         src/server/http.ts        "s/if \(\/\^\[=\+\\\\-@\\\\t\\\\r\]\/.test\(s\)\) s = /if (false) s = /"
run "session token stored in clear"     src/server/auth.ts        "s/const sha = \(s: string\) => createHash\('sha256'\).update\(s\).digest\('hex'\);/const sha = (s: string) => s;/"
git status --short | grep -v '^??' || echo "tree restored"
