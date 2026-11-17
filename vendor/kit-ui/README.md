# @kit/ui (vendored build)

Built output of `packages/ui` from https://github.com/krisyana/web-platform-kit, version 0.3.0, commit 16b011f. MIT licensed.
Vendored because the kit is not published to a registry. Update by rebuilding the kit (`pnpm --filter @kit/ui build`) and copying `dist/` here.
KeyPresence uses `Button` and `Dialog`, and maps the kit's `--kit-*` tokens onto its own palette in `src/web/theme.css`.
