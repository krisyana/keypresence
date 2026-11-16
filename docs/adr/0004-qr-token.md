# ADR-0004: Site QR token

Status: accepted

## Requirements
One QR per site, valid for one local day, forgeable by nobody without the server secret, rotatable on demand, and useless without being physically at the site (location check still runs).

## Design
```
payload = "kp1." + siteId + "." + localDay + "." + epoch          # e.g. kp1.<uuid>.2026-11-16.3
sig     = base64url( HMAC-SHA256( key = HMAC(MASTER_SECRET, site.qr_secret), payload ) )  truncated to 16 bytes
token   = base64url(payload) + "." + sig
QR      = APP_URL + "/s/" + token
```
- `localDay` is the date in the organisation timezone. A token is valid when its day is today, **or yesterday within `qr_grace_minutes` after local midnight** (default 10) so a code shown at 23:58 still scans at 00:03.
- `epoch` is `sites.qr_epoch`. **Manual rotation** increments the epoch and replaces `sites.qr_secret` with fresh random bytes, which invalidates every earlier token of that site immediately, including today's.
- Two-level key: the per-site secret means leaking one site's tokens or secret never helps against another site. `MASTER_SECRET` never leaves the server (env var, `.env.example` has a placeholder; the server refuses to start in production with the placeholder).
- Verification is constant-time (`timingSafeEqual`), parses before computing, and returns one of `ok | malformed | bad_signature | expired | rotated | unknown_site`. The API does not tell the client *why* a signature failed beyond the coarse code (no oracle for the secret).
- The token is **not** a credential for a person. It proves "someone scanned the code of site X today". Identity comes from the session, presence from the location check.

## Why not JWT
No claims beyond three fields are needed, and a JWT library adds algorithm-confusion surface (`alg: none`). The format above is 3 fields and one fixed algorithm. It is JWT-shaped on purpose and documented as such.

## Why not a rotating TOTP-style short code
A QR printed on paper cannot change every 30 s. Daily rotation is the strongest option that fits a printed/poster workflow; a screen at reception could show a shorter-lived code later (the verifier takes the day from the token, so this is an extension, not a rewrite).

## Known limits
A photographed QR works for the rest of the day for anyone **who is also inside the geofence**. That is the accepted residual risk; the location checks and the audit trail are the second factor.

## Note from review
Because rotation also replaces the per-site secret, an old token fails the signature check and is reported as `bad_signature`; the separate `rotated` code (epoch mismatch with a valid signature) is defence in depth and effectively unreachable. Either way the scan is rejected.
